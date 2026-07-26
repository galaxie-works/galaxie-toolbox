//! Chamadas ao Microsoft Graph: descobrir os sites que o usuario acessa e
//! criar o atalho ("Add shortcut to OneDrive") apontando pra biblioteca do
//! site. Usa o payload validado na migracao: remoteItem.sharepointIds com
//! listItemUniqueId="root" e conflictBehavior=fail (409 = ja existe).

use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::{refresh, TokenStore};


const GRAPH: &str = "https://graph.microsoft.com/v1.0";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteDto {
    pub key: String,
    pub name: String,
    pub status: String, // "connected" | "available"
    pub site_id: String,
    pub web_url: String,
    /// Descricao do site, como configurada no SharePoint. Costuma vir vazia.
    pub description: String,
}

/// Numeros de uma biblioteca. Buscados depois da lista, um site por vez, para
/// a tela aparecer na hora.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteDetalhes {
    /// Endereco da BIBLIOTECA (nao do site). O webUrl que /sites devolve e a
    /// home do site — num site de comunicacao isso cai na pagina inicial, e nao
    /// nos arquivos. Este vem do proprio drive, entao aponta exatamente para a
    /// biblioteca que o atalho conecta.
    pub library_url: Option<String>,
    /// Tamanho recursivo da biblioteca padrao. Exato (vem do proprio drive).
    pub bytes: Option<u64>,
    /// Pastas e arquivos, recursivos. Vem do indice de busca do SharePoint,
    /// entao sao APROXIMADOS: o indice leva minutos para refletir um upload
    /// grande, e o total que a API devolve e estimado.
    pub folders: Option<u64>,
    pub files: Option<u64>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Throttling do Graph (#64): pool de concorrência + retry com Retry-After + jitter
//
// A carga inicial do Bridge dispara pastas + mensagens + 3 contadores + agenda +
// categorias quase juntas; o tenant responde com rajada de 429 (tela vazia). Duas
// defesas, centralizadas aqui e reaproveitadas por todas as chamadas via
// `graph_enviar` (em vez de cada `cr_*` repetir seu próprio laço de retry):
//
//  1. LIMITADOR DE CONCORRÊNCIA: no máximo N requisições Graph em voo ao mesmo
//     tempo na app inteira. Corta a rajada na ORIGEM, antes do primeiro 429. A
//     vaga é tomada só durante o `.send()`; enquanto uma chamada dorme para
//     re-tentar, a vaga volta pro pool e outra progride.
//  2. RETRY COM RETRY-AFTER + JITTER: em 429 respeita o `Retry-After` do servidor
//     como PISO (nunca dorme menos que o pedido, com teto); na ausência, backoff
//     exponencial 2^n. Em ambos soma jitter aleatório para vários workers não
//     re-sincronizarem a rajada. Teto de tentativas por chamada.
// ---------------------------------------------------------------------------

/// Máximo de requisições Graph simultâneas na app inteira. Baixo de propósito: a
/// carga inicial é uma rajada e o tenant estrangula rápido.
const GRAPH_MAX_CONCORRENTES: usize = 4;
/// Teto de tentativas por chamada Graph (inclui a 1ª).
const GRAPH_MAX_TENTATIVAS: u8 = 4;
/// Teto padrão (segundos) para o Retry-After / backoff — evita dormir demais se o
/// servidor pedir um valor absurdo.
const GRAPH_TETO_ESPERA_S: u64 = 10;

struct Limitador {
    vagas: std::sync::Mutex<usize>,
    liberou: std::sync::Condvar,
}

/// Pool global. `Mutex::new`/`Condvar::new` são const desde 1.63, então cabem num
/// `static` sem lazy-init.
static LIMITADOR: Limitador = Limitador {
    vagas: std::sync::Mutex::new(GRAPH_MAX_CONCORRENTES),
    liberou: std::sync::Condvar::new(),
};

/// Vaga do pool com liberação automática (RAII): ao sair de escopo devolve a
/// vaga e acorda quem espera. Assim uma chamada que dorme para re-tentar não
/// segura a vaga.
struct Vaga;
impl Drop for Vaga {
    fn drop(&mut self) {
        // `unwrap_or_else(into_inner)` e não `if let Ok(..)`: se o Mutex for
        // envenenado (panic de outra thread), engolir o erro VAZARIA a vaga para
        // sempre e o pool secaria em deadlock. `adquirir_vaga` já se recupera do
        // envenenamento; a devolução tem de fazer o mesmo.
        let mut n = LIMITADOR.vagas.lock().unwrap_or_else(|e| e.into_inner());
        *n += 1;
        LIMITADOR.liberou.notify_one();
    }
}

/// Bloqueia até haver vaga no pool e a reserva.
fn adquirir_vaga() -> Vaga {
    let mut n = LIMITADOR.vagas.lock().unwrap_or_else(|e| e.into_inner());
    while *n == 0 {
        n = LIMITADOR.liberou.wait(n).unwrap_or_else(|e| e.into_inner());
    }
    *n -= 1;
    Vaga
}

/// Jitter aditivo máximo (ms) somado ao `Retry-After` pedido pelo servidor.
const GRAPH_JITTER_RETRY_AFTER_MS: u64 = 500;

/// A parte da resposta HTTP que o laço de retry precisa enxergar. Existe para o
/// laço (`executar_com_pool`) ser testável sem rede: em produção o impl é o
/// `reqwest::blocking::Response`; no teste, uma resposta forjada.
trait RespostaThrottling {
    fn status_u16(&self) -> u16;
    /// `Retry-After` em segundos (delta-seconds). `None` se ausente ou ilegível.
    fn retry_after_s(&self) -> Option<u64>;
}

impl RespostaThrottling for reqwest::blocking::Response {
    fn status_u16(&self) -> u16 {
        self.status().as_u16()
    }
    fn retry_after_s(&self) -> Option<u64> {
        self.headers()
            .get("Retry-After")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
    }
}

/// Milissegundos a dormir antes de re-tentar um 429 — lógica PURA (sem rede,
/// sem relógio), para ser exercitada em teste. Prioriza o `Retry-After`
/// (segundos → ms) como PISO, com teto; na ausência usa backoff exponencial
/// 2^tentativa s (com teto). Sempre soma jitter para dessincronizar os workers.
fn calc_espera_ms(retry_after_s: Option<u64>, tentativa: u8, teto_s: u64) -> u64 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    match retry_after_s {
        // Respeita o Retry-After como piso + jitter aditivo (0–500ms) só pra
        // espalhar as re-tentativas — nunca dorme MENOS que o servidor pediu
        // (salvo o teto, que é proteção nossa contra pedido absurdo).
        Some(s) => s.min(teto_s) * 1000 + rng.gen_range(0..GRAPH_JITTER_RETRY_AFTER_MS),
        // Sem Retry-After: backoff exponencial com jitter multiplicativo
        // delay*(0.5 + rand*0.5) (fica entre 50% e 100% do backoff).
        None => {
            let base = (1u64 << tentativa.min(6)).min(teto_s.max(1)) * 1000;
            ((base as f64) * (0.5 + rng.gen::<f64>() * 0.5)).round() as u64
        }
    }
}

/// Executa uma chamada Graph sob o pool de concorrência, re-tentando em 429 com
/// Retry-After + jitter (ver bloco acima). `enviar` deve MONTAR e disparar a
/// requisição do zero a cada tentativa (a resposta é consumida). Devolve a última
/// resposta — inclusive um 429 final —, deixando o chamador produzir a mensagem
/// de erro que já usava; só propaga o erro de transporte do reqwest.
fn graph_enviar<F>(
    rotulo: &str,
    teto_s: u64,
    enviar: F,
) -> reqwest::Result<reqwest::blocking::Response>
where
    F: FnMut() -> reqwest::Result<reqwest::blocking::Response>,
{
    executar_com_pool(rotulo, teto_s, enviar)
}

/// O laço de verdade, genérico na resposta (`RespostaThrottling`) e no erro, para
/// ser testável sem rede. `graph_enviar` é só a instanciação com os tipos do
/// reqwest — as assinaturas dos `cr_*` não mudam.
fn executar_com_pool<R, E, F>(rotulo: &str, teto_s: u64, mut enviar: F) -> Result<R, E>
where
    R: RespostaThrottling,
    F: FnMut() -> Result<R, E>,
{
    let mut tentativa: u8 = 0;
    loop {
        // A vaga é segurada só durante o send; o `_vaga` cai no fim deste bloco,
        // ANTES do sleep abaixo — quem dorme esperando re-tentar não ocupa vaga.
        let resp = {
            let _vaga = adquirir_vaga();
            enviar()
        }?;
        if resp.status_u16() != 429 || tentativa + 1 >= GRAPH_MAX_TENTATIVAS {
            return Ok(resp);
        }
        let espera = calc_espera_ms(resp.retry_after_s(), tentativa, teto_s);
        log::warn!(
            "[{rotulo}] 429 (tentativa {}/{}); aguardando {espera}ms",
            tentativa + 1,
            GRAPH_MAX_TENTATIVAS
        );
        std::thread::sleep(std::time::Duration::from_millis(espera));
        tentativa += 1;
    }
}

/// Devolve um access_token valido, renovando via refresh_token se estiver
/// perto de expirar. Atualiza o store.
pub fn access_token(store: &TokenStore) -> Result<String, String> {
    let mut guard = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
    let current = guard.as_ref().ok_or("nao autenticado")?.clone();
    if current.expires_at > now_secs() + 60 {
        return Ok(current.access_token);
    }
    let rt = current
        .refresh_token
        .ok_or("sessao expirada; faca login novamente")?;
    let renewed = refresh(&current.tenant, &rt)?;
    let token = renewed.access_token.clone();
    *guard = Some(renewed);
    Ok(token)
}

/// GUID do site a partir do id composto "hostname,siteGuid,webGuid".
fn site_guid(site_id: &str) -> Option<&str> {
    site_id.split(',').nth(1)
}

/// Sites que o proprio M365 cria e que nao sao biblioteca de trabalho: o grupo
/// de respostas do Viva Engage (vem com um id numerico no fim), o "All Company"
/// do Viva e o site de equipe padrao do tenant. Sao ruido pro usuario final.
///
/// Comparacao por PREFIXO, em minusculas: pega o sufixo numerico do Viva sem
/// depender do travessao no meio do nome. As variantes em portugues e ingles
/// estao aqui porque o produto e multi-tenant e o idioma varia por cliente.
const SITES_OCULTOS: &[&str] = &[
    "group for answers in viva engage",
    "all company",
    "toda a empresa",
    "toda a organiza", // "Organizacao"/"Organização": corta antes do acento
    "site da equipe",
    "team site",
];

fn site_oculto(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    SITES_OCULTOS.iter().any(|p| n.starts_with(p))
}

/// Ultimo segmento de /sites/<KEY> como chave curta.
fn key_from_weburl(web_url: &str) -> String {
    web_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

/// Conjunto de siteGuids que ja tem atalho no OneDrive do usuario.
/// Consulta DELEGADA (/me/drive): diferente do app-only, aqui os remoteItem
/// costumam aparecer. O log mostra o que veio, pra nao ficar no achismo.
fn connected_site_guids(client: &reqwest::blocking::Client, token: &str) -> Vec<String> {
    let url = format!("{GRAPH}/me/drive/root/children?$select=id,name,remoteItem&$top=200");
    let mut out = Vec::new();
    match client.get(&url).bearer_auth(token).send() {
        Ok(resp) => {
            let st = resp.status();
            match resp.json::<serde_json::Value>() {
                Ok(v) => {
                    let itens = v["value"].as_array().map(|a| a.len()).unwrap_or(0);
                    let mut com_remote = 0;
                    if let Some(items) = v["value"].as_array() {
                        for it in items {
                            let nome = it["name"].as_str().unwrap_or("?");
                            if let Some(sid) =
                                it["remoteItem"]["sharepointIds"]["siteId"].as_str()
                            {
                                com_remote += 1;
                                log::info!("[atalho] '{nome}' -> siteId={sid}");
                                out.push(sid.to_string());
                            } else {
                                log::info!("[atalho] '{nome}' (pasta normal)");
                            }
                        }
                    }
                    log::info!(
                        "[atalho] /me/drive/root/children {st}: {itens} itens, {com_remote} atalhos"
                    );
                }
                Err(e) => log::error!("[atalho] json invalido: {e}"),
            }
        }
        Err(e) => log::error!("[atalho] falha na chamada: {e}"),
    }
    out
}

/// DIAGNOSTICO TEMPORARIO: sonda endpoints que talvez exponham os atalhos.
/// O /drive/root/children comprovadamente nao devolve remoteItem.
fn sondar_atalhos(client: &reqwest::blocking::Client, token: &str) {
    let alvos = [
        ("sharedWithMe", format!("{GRAPH}/me/drive/sharedWithMe")),
        ("delta", format!("{GRAPH}/me/drive/root/delta")),
        (
            "children+expand",
            format!("{GRAPH}/me/drive/root/children?$expand=remoteItem&$top=200"),
        ),
    ];
    for (rotulo, url) in alvos {
        match client.get(&url).bearer_auth(token).send() {
            Ok(r) => {
                let st = r.status();
                match r.json::<serde_json::Value>() {
                    Ok(v) => {
                        let arr = v["value"].as_array();
                        let total = arr.map(|a| a.len()).unwrap_or(0);
                        let mut remotos = 0;
                        if let Some(items) = arr {
                            for it in items {
                                if !it["remoteItem"].is_null() {
                                    remotos += 1;
                                    log::info!(
                                        "[sonda:{rotulo}] REMOTO '{}' id={}",
                                        it["name"].as_str().unwrap_or("?"),
                                        it["id"].as_str().unwrap_or("?")
                                    );
                                }
                            }
                        }
                        log::info!("[sonda:{rotulo}] {st}: {total} itens, {remotos} com remoteItem");
                    }
                    Err(e) => log::warn!("[sonda:{rotulo}] json: {e}"),
                }
            }
            Err(e) => log::warn!("[sonda:{rotulo}] erro: {e}"),
        }
    }
}

/// Lista os sites do tenant que o usuario enxerga (delegado), com status.
pub fn list_sites(store: &TokenStore) -> Result<Vec<SiteDto>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    sondar_atalhos(&client, &token);

    let url = format!("{GRAPH}/sites?search=*&$top=200");
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao listar sites: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/sites retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let connected = connected_site_guids(&client, &token);

    let mut sites = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            let web_url = it["webUrl"].as_str().unwrap_or("").to_string();
            // Multi-tenant: o hostname varia por cliente. O /sites?search ja
            // devolve so o que ESTE usuario acessa no tenant dele, entao basta
            // ficar com as site collections (/sites/) e descartar OneDrive
            // pessoal (-my.sharepoint.com) e o root site.
            if !web_url.contains("/sites/") || web_url.contains("-my.sharepoint.com") {
                continue;
            }
            let site_id = it["id"].as_str().unwrap_or("").to_string();
            let name = it["displayName"]
                .as_str()
                .or_else(|| it["name"].as_str())
                .unwrap_or("")
                .to_string();
            if site_oculto(&name) {
                continue;
            }
            // O Graph nao lista atalhos (ver estado.rs), entao o estado vem do
            // registro local; a consulta ao Graph fica como reforco, caso um
            // dia a API passe a devolver.
            let is_connected = site_guid(&site_id)
                .map(|g| connected.iter().any(|c| c == g) || crate::estado::buscar(g).is_some())
                .unwrap_or(false);
            sites.push(SiteDto {
                key: key_from_weburl(&web_url),
                name,
                status: if is_connected { "connected".into() } else { "available".into() },
                site_id,
                description: it["description"].as_str().unwrap_or("").to_string(),
                web_url,
            });
        }
    }
    sites.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(sites)
}

/// Total de itens que o indice de busca do SharePoint conhece para uma consulta
/// KQL. `None` quando a busca falha (indice frio, throttling, sem permissao) —
/// nesse caso a interface simplesmente nao mostra o numero, em vez de mentir.
fn contar_busca(
    client: &reqwest::blocking::Client,
    token: &str,
    kql: &str,
) -> Option<u64> {
    let corpo = serde_json::json!({
        "requests": [{
            "entityTypes": ["driveItem"],
            "query": { "queryString": kql },
            "from": 0,
            "size": 1,
            "fields": ["name"]
        }]
    });
    let resp = client
        .post(format!("{GRAPH}/search/query"))
        .bearer_auth(token)
        .json(&corpo)
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().ok()?;
    v["value"][0]["hitsContainers"][0]["total"].as_u64()
}

/// Tamanho e contagens de uma biblioteca.
///
/// O tamanho sai do proprio drive (exato e barato). Pastas e arquivos nao tem
/// endpoint de contagem no Graph: a unica alternativa seria enumerar item a
/// item (centenas de requisicoes por site), entao vem da busca — aproximadas,
/// como documentado em SiteDetalhes.
pub fn site_details(
    store: &TokenStore,
    site_id: &str,
    web_url: &str,
) -> Result<SiteDetalhes, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let mut det = SiteDetalhes::default();

    let url = format!("{GRAPH}/sites/{site_id}/drive/root?$select=size,webUrl");
    if let Ok(resp) = client.get(&url).bearer_auth(&token).send() {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<serde_json::Value>() {
                det.bytes = v["size"].as_u64();
                det.library_url = v["webUrl"].as_str().map(|s| s.to_string());
            }
        }
    }

    // As aspas do path fazem parte do KQL; sem elas a URL quebra a consulta.
    det.files = contar_busca(&client, &token, &format!("path:\"{web_url}\" AND IsDocument:true"));
    det.folders = contar_busca(&client, &token, &format!("path:\"{web_url}\" AND IsContainer:true"));

    Ok(det)
}

/// Cria o atalho no OneDrive do usuario apontando pra biblioteca padrao do
/// site. `name` e o nome curto/limpo do atalho. 409 (ja existe) = sucesso.
pub fn connect_site(
    store: &TokenStore,
    site_id: &str,
    name: &str,
    web_url: &str,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // sharepointIds da biblioteca padrao (drive root) do site.
    let sp_url = format!("{GRAPH}/sites/{site_id}/drive/root?$select=sharepointIds");
    let resp = client
        .get(&sp_url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao obter sharepointIds: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("sharepointIds retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let sp = &v["sharepointIds"];
    let sid = sp["siteId"].as_str().ok_or("sem siteId")?;
    let wid = sp["webId"].as_str().ok_or("sem webId")?;
    let lid = sp["listId"].as_str().ok_or("sem listId")?;

    let body = serde_json::json!({
        "name": name,
        "remoteItem": {
            "sharepointIds": {
                "siteId": sid,
                "webId": wid,
                "listId": lid,
                "listItemUniqueId": "root",
                "siteUrl": web_url
            }
        },
        "@microsoft.graph.conflictBehavior": "fail"
    });

    let post = client
        .post(format!("{GRAPH}/me/drive/root/children"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .map_err(|e| format!("falha ao criar atalho: {e}"))?;

    let status = post.status();
    if status.is_success() {
        // O OneDrive IGNORA o "name" do POST e deriva "{site} - {biblioteca}"
        // (vira "Comercial - Comercial"). Renomeia pro nome curto: alem de
        // feio, o nome longo come o limite de 400 chars do caminho.
        let criado: serde_json::Value = post.json().unwrap_or(serde_json::Value::Null);
        if let Some(id) = criado["id"].as_str() {
            rename_item(&client, &token, id, name);
            // Guarda o id: e a UNICA forma de saber depois que este site foi
            // conectado e de conseguir remover o atalho (o Graph nao lista).
            crate::estado::marcar(sid, id, name);
        }
        return Ok(());
    }
    if status.as_u16() == 409 {
        // Ja existe. Pode ter ficado com o nome duplicado de uma versao
        // anterior - acha pelo siteId e corrige o nome.
        fix_existing_name(&client, &token, sid, name);
        return Ok(());
    }
    let txt = post.text().unwrap_or_default();
    Err(format!("criar atalho retornou {status}: {txt}"))
}

/// Remove o atalho do OneDrive do usuario. Usa o id guardado na criacao.
pub fn disconnect_site(store: &TokenStore, site_id: &str) -> Result<(), String> {
    let token = access_token(store)?;
    let guid = site_guid(site_id).unwrap_or(site_id);
    let reg = crate::estado::buscar(guid)
        .ok_or("este atalho nao foi criado por aqui - remova pelo OneDrive web")?;

    let client = reqwest::blocking::Client::new();
    let resp = client
        .delete(format!("{GRAPH}/me/drive/items/{}", reg.item_id))
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao remover atalho: {e}"))?;

    let st = resp.status();
    // 404 = ja nao existe (removido por fora): tratamos como sucesso.
    if st.is_success() || st.as_u16() == 404 {
        crate::estado::desmarcar(guid);
        return Ok(());
    }
    let txt = resp.text().unwrap_or_default();
    Err(format!("remover atalho retornou {st}: {txt}"))
}

/// PATCH do nome do item. Best-effort: o atalho ja funciona sem isso.
fn rename_item(client: &reqwest::blocking::Client, token: &str, id: &str, name: &str) {
    let _ = client
        .patch(format!("{GRAPH}/me/drive/items/{id}"))
        .bearer_auth(token)
        .json(&serde_json::json!({ "name": name }))
        .send();
}

/// Procura o atalho ja existente que aponta pro site e ajusta o nome.
fn fix_existing_name(client: &reqwest::blocking::Client, token: &str, site_guid: &str, name: &str) {
    let url = format!("{GRAPH}/me/drive/root/children?$select=id,name,remoteItem&$top=200");
    if let Ok(resp) = client.get(&url).bearer_auth(token).send() {
        if let Ok(v) = resp.json::<serde_json::Value>() {
            if let Some(items) = v["value"].as_array() {
                for it in items {
                    let sid = it["remoteItem"]["sharepointIds"]["siteId"].as_str().unwrap_or("");
                    if sid != site_guid {
                        continue;
                    }
                    let atual = it["name"].as_str().unwrap_or("");
                    if atual != name {
                        if let Some(id) = it["id"].as_str() {
                            rename_item(client, token, id, name);
                        }
                    }
                    break;
                }
            }
        }
    }
}

// ============================================================================
// OneDrive pessoal (aba "My files"): pastas do usuario, uso e tipos de arquivo.
// Tudo delegado (/me/drive), a conta logada no app.
// ============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastaOneDrive {
    pub id: String,
    pub name: String,
    /// Tamanho recursivo da pasta (exato, vem do proprio drive).
    pub bytes: u64,
    pub web_url: String,
    /// Filhos imediatos (nao recursivo) — barato, vem no proprio item.
    pub child_count: u64,
}

/// Pastas de primeiro nivel do OneDrive do usuario, maiores primeiro.
pub fn onedrive_folders(store: &TokenStore) -> Result<Vec<PastaOneDrive>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let mut pastas = Vec::new();
    let mut proxima = Some(format!(
        "{GRAPH}/me/drive/root/children?$select=id,name,size,webUrl,folder&$top=200"
    ));
    while let Some(url) = proxima {
        let resp = client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .map_err(|e| format!("falha ao listar o OneDrive: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("/me/drive/root/children retornou {}", resp.status()));
        }
        let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        if let Some(items) = v["value"].as_array() {
            for it in items {
                // So pastas; arquivos soltos na raiz nao viram card.
                if !it["folder"].is_object() {
                    continue;
                }
                pastas.push(PastaOneDrive {
                    id: it["id"].as_str().unwrap_or("").to_string(),
                    name: it["name"].as_str().unwrap_or("").to_string(),
                    bytes: it["size"].as_u64().unwrap_or(0),
                    web_url: it["webUrl"].as_str().unwrap_or("").to_string(),
                    child_count: it["folder"]["childCount"].as_u64().unwrap_or(0),
                });
            }
        }
        proxima = v["@odata.nextLink"].as_str().map(|s| s.to_string());
    }
    pastas.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    Ok(pastas)
}

/// Contagens (recursivas, APROXIMADAS) de uma pasta do OneDrive — vem do indice
/// de busca, mesma ressalva do SharePoint. bytes ja e conhecido da listagem.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PastaDetalhes {
    pub folders: Option<u64>,
    pub files: Option<u64>,
}

pub fn onedrive_folder_details(
    store: &TokenStore,
    web_url: &str,
) -> Result<PastaDetalhes, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    Ok(PastaDetalhes {
        files: contar_busca(&client, &token, &format!("path:\"{web_url}\" AND IsDocument:true")),
        folders: contar_busca(&client, &token, &format!("path:\"{web_url}\" AND IsContainer:true")),
    })
}

/// Uso do OneDrive: usado e limite (bytes). Exato, vem da quota do drive.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsoOneDrive {
    pub used: u64,
    pub total: u64,
    /// Endereco raiz do drive — usado para escopar a busca de tipos de arquivo.
    pub web_url: String,
}

pub fn onedrive_quota(store: &TokenStore) -> Result<UsoOneDrive, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    let url = format!("{GRAPH}/me/drive/root?$select=webUrl");
    let web_url = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .ok()
        .and_then(|r| r.json::<serde_json::Value>().ok())
        .and_then(|v| v["webUrl"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let url = format!("{GRAPH}/me/drive?$select=quota");
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao ler a quota: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/drive retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(UsoOneDrive {
        used: v["quota"]["used"].as_u64().unwrap_or(0),
        total: v["quota"]["total"].as_u64().unwrap_or(0),
        web_url,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipoArquivo {
    pub tipo: String,
    pub quantidade: u64,
}

/// Tipos de arquivo que a pessoa MAIS tem no OneDrive, por CONTAGEM (via
/// agregacao da busca). O peso por tipo NAO vem daqui: a agregacao do Graph
/// devolve contagem por bucket, nao soma de tamanho — para peso seria preciso
/// enumerar arquivo a arquivo (lento demais para uma tela). Por isso mostramos
/// "quantos", nao "quanto pesam".
pub fn onedrive_tipos(store: &TokenStore, web_url: &str) -> Result<Vec<TipoArquivo>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let kql = if web_url.is_empty() {
        "IsDocument:true".to_string()
    } else {
        format!("path:\"{web_url}\" AND IsDocument:true")
    };
    let corpo = serde_json::json!({
        "requests": [{
            "entityTypes": ["driveItem"],
            "query": { "queryString": kql },
            "from": 0,
            "size": 0,
            "aggregations": [{
                "field": "fileType",
                "size": 8,
                "bucketDefinition": {
                    "sortBy": "count",
                    "isDescending": true,
                    "minimumCount": 1
                }
            }]
        }]
    });
    let resp = client
        .post(format!("{GRAPH}/search/query"))
        .bearer_auth(&token)
        .json(&corpo)
        .send()
        .map_err(|e| format!("falha na agregacao: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/search/query retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut tipos = Vec::new();
    if let Some(buckets) = v["value"][0]["hitsContainers"][0]["aggregations"][0]["buckets"].as_array() {
        for b in buckets {
            let tipo = b["key"].as_str().unwrap_or("").to_string();
            let quantidade = b["count"].as_u64().unwrap_or(0);
            if !tipo.is_empty() {
                tipos.push(TipoArquivo { tipo, quantidade });
            }
        }
    }
    Ok(tipos)
}

// ============================================================================
// Control room (dashboard): visao pessoal do usuario logado. Tudo delegado,
// escopos sem admin consent (Calendars.Read, Mail.Read, Tasks.ReadWrite).
// ============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reuniao {
    pub assunto: String,
    /// Inicio em ISO UTC (o front converte para o horario local).
    pub inicio: String,
    pub fim: String,
    pub local: String,
    pub online: bool,
}

/// Proximas reunioes (janela de 7 dias, ate 6). Calendars.Read.
pub fn cr_reunioes(store: &TokenStore) -> Result<Vec<Reuniao>, String> {
    use chrono::{Duration, Utc};
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let agora = Utc::now();
    let ini = agora.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let fim = (agora + Duration::days(7)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let url = format!(
        "{GRAPH}/me/calendarView?startDateTime={ini}&endDateTime={fim}\
         &$select=subject,start,end,location,isAllDay,onlineMeeting\
         &$orderby=start/dateTime&$top=6"
    );
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        // times em UTC, deterministico para o front converter.
        .header("Prefer", "outlook.timezone=\"UTC\"")
        .send()
        .map_err(|e| format!("falha no calendario: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/calendarView retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut reunioes = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            reunioes.push(Reuniao {
                assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
                inicio: it["start"]["dateTime"].as_str().unwrap_or("").to_string(),
                fim: it["end"]["dateTime"].as_str().unwrap_or("").to_string(),
                local: it["location"]["displayName"].as_str().unwrap_or("").to_string(),
                online: it["onlineMeeting"].is_object(),
            });
        }
    }
    Ok(reunioes)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailRecente {
    pub assunto: String,
    pub de: String,
    pub recebido: String,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaixaEntrada {
    pub nao_lidos: u64,
    pub recentes: Vec<EmailRecente>,
}

/// Nao-lidos da Caixa de Entrada + ultimas mensagens nao lidas. Mail.Read.
pub fn cr_email(store: &TokenStore) -> Result<CaixaEntrada, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let mut cx = CaixaEntrada::default();

    let url = format!("{GRAPH}/me/mailFolders/inbox?$select=unreadItemCount");
    if let Ok(resp) = client.get(&url).bearer_auth(&token).send() {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<serde_json::Value>() {
                cx.nao_lidos = v["unreadItemCount"].as_u64().unwrap_or(0);
            }
        }
    }

    let url = format!(
        "{GRAPH}/me/mailFolders/inbox/messages?$filter=isRead eq false\
         &$select=subject,from,receivedDateTime&$top=5&$orderby=receivedDateTime desc"
    );
    if let Ok(resp) = client.get(&url).bearer_auth(&token).send() {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<serde_json::Value>() {
                if let Some(items) = v["value"].as_array() {
                    for it in items {
                        cx.recentes.push(EmailRecente {
                            assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
                            de: it["from"]["emailAddress"]["name"]
                                .as_str()
                                .or_else(|| it["from"]["emailAddress"]["address"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            recebido: it["receivedDateTime"].as_str().unwrap_or("").to_string(),
                        });
                    }
                }
            }
        }
    }
    Ok(cx)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tarefa {
    pub titulo: String,
    pub lista: String,
}

/// Tarefas pendentes do To Do (todas as listas, ate 8). Tasks.ReadWrite.
pub fn cr_tarefas(store: &TokenStore) -> Result<Vec<Tarefa>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // 1) listas
    let url = format!("{GRAPH}/me/todo/lists?$select=id,displayName&$top=50");
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao ler as listas: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/todo/lists retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let mut tarefas = Vec::new();
    if let Some(listas) = v["value"].as_array() {
        for l in listas {
            if tarefas.len() >= 8 {
                break;
            }
            let id = l["id"].as_str().unwrap_or("");
            let nome = l["displayName"].as_str().unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            // 2) tarefas nao concluidas de cada lista
            let url = format!(
                "{GRAPH}/me/todo/lists/{id}/tasks?$filter=status ne 'completed'\
                 &$select=title&$top=8"
            );
            if let Ok(r) = client.get(&url).bearer_auth(&token).send() {
                if r.status().is_success() {
                    if let Ok(vt) = r.json::<serde_json::Value>() {
                        if let Some(items) = vt["value"].as_array() {
                            for it in items {
                                if tarefas.len() >= 8 {
                                    break;
                                }
                                tarefas.push(Tarefa {
                                    titulo: it["title"].as_str().unwrap_or("").to_string(),
                                    lista: nome.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(tarefas)
}

// ----------------------------------------------------------------------------
// Agenda do dia + inbox do dia (visao "Control room" rica). O front escolhe uma
// data no calendario e manda os limites do dia em ISO UTC; o backend so repassa.
// ----------------------------------------------------------------------------

/// Iniciais de um nome (ate 2 letras) para o fallback do avatar.
fn iniciais(nome: &str) -> String {
    let partes: Vec<&str> = nome.split_whitespace().filter(|p| !p.is_empty()).collect();
    match partes.as_slice() {
        [] => "?".to_string(),
        [um] => um.chars().take(2).collect::<String>().to_uppercase(),
        [primeiro, .., ultimo] => {
            let a = primeiro.chars().next().unwrap_or('?');
            let b = ultimo.chars().next().unwrap_or('?');
            format!("{a}{b}").to_uppercase()
        }
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Participante {
    pub nome: String,
    pub email: String,
    pub iniciais: String,
    /// Foto em data URI. Sempre None por ora (buscar por pessoa custa 1 req cada).
    pub foto: Option<String>,
}

fn participante(no: &serde_json::Value) -> Participante {
    let nome = no["name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| no["address"].as_str())
        .unwrap_or("")
        .to_string();
    Participante {
        iniciais: iniciais(&nome),
        email: no["address"].as_str().unwrap_or("").to_string(),
        nome,
        foto: None,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventoAgenda {
    pub id: String,
    pub assunto: String,
    pub inicio: String, // ISO UTC
    pub fim: String,
    pub local: String,
    pub online: bool,
    pub dia_inteiro: bool,
    /// "meeting" quando tem convidados; "event" caso contrario.
    pub categoria: String,
    pub participantes: Vec<Participante>,
    pub total_participantes: usize,
    pub tem_anexos: bool,
    pub categorias: Vec<String>,
}

/// Eventos do dia escolhido (limites em ISO UTC). Calendars.Read.
pub fn cr_agenda(store: &TokenStore, inicio: &str, fim: &str) -> Result<Vec<EventoAgenda>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!(
        "{GRAPH}/me/calendarView?startDateTime={inicio}&endDateTime={fim}\
         &$select=id,subject,start,end,location,isAllDay,onlineMeeting,attendees,hasAttachments,categories\
         &$orderby=start/dateTime&$top=100"
    );
    // Sob o pool + retry central (#64): respeita Retry-After e usa jitter. O
    // calendarView era a única chamada sem retry — um 429 transitório derrubava
    // a agenda até um F5 no app inteiro (#41).
    let resp = graph_enviar("agenda", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("Prefer", "outlook.timezone=\"UTC\"")
            .send()
    })
    .map_err(|e| format!("falha no calendario: {e}"))?;
    let st = resp.status();
    if !st.is_success() {
        return Err(format!("/me/calendarView retornou {st}"));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut eventos = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            let convidados: Vec<Participante> = it["attendees"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .map(|a| participante(&a["emailAddress"]))
                        .filter(|p| !p.nome.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let total = convidados.len();
            let categorias: Vec<String> = it["categories"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|c| c.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            eventos.push(EventoAgenda {
                id: it["id"].as_str().unwrap_or("").to_string(),
                assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
                inicio: it["start"]["dateTime"].as_str().unwrap_or("").to_string(),
                fim: it["end"]["dateTime"].as_str().unwrap_or("").to_string(),
                local: it["location"]["displayName"].as_str().unwrap_or("").to_string(),
                online: it["onlineMeeting"].is_object() || it["isOnlineMeeting"].as_bool().unwrap_or(false),
                dia_inteiro: it["isAllDay"].as_bool().unwrap_or(false),
                categoria: if total > 0 { "meeting" } else { "event" }.to_string(),
                // mostra ate 5 avatares; o resto vira "+N"
                participantes: convidados.into_iter().take(5).collect(),
                total_participantes: total,
                tem_anexos: it["hasAttachments"].as_bool().unwrap_or(false),
                categorias,
            });
        }
    }
    Ok(eventos)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoriaCor {
    pub nome: String,
    pub cor: String,
}

/// Mapeia um preset de cor do Outlook para o hex correspondente.
fn preset_para_hex(preset: &str) -> &'static str {
    match preset {
        "preset0" => "#D13438",
        "preset1" => "#FF8C00",
        "preset2" => "#986F0B",
        "preset3" => "#EAA300",
        "preset4" => "#498205",
        "preset5" => "#00B7C3",
        "preset6" => "#7A7574",
        "preset7" => "#0078D4",
        "preset8" => "#8764B8",
        "preset9" => "#C239B3",
        "preset10" => "#69797E",
        "preset11" => "#4A5459",
        "preset12" => "#8A8886",
        "preset13" => "#5D5A58",
        "preset14" => "#252423",
        "preset15" => "#A80000",
        "preset16" => "#D83B01",
        "preset17" => "#7A4B00",
        "preset18" => "#C19C00",
        "preset19" => "#0B6A0B",
        "preset20" => "#005E5E",
        "preset21" => "#4C4A00",
        "preset22" => "#004E8C",
        "preset23" => "#5C2E91",
        "preset24" => "#881798",
        // "none" ou desconhecido
        _ => "#8A8886",
    }
}

/// Categorias mestras do usuario com a cor (hex) de cada uma. Calendars.Read / Mail.Read.
pub fn cr_categorias(store: &TokenStore) -> Result<Vec<CategoriaCor>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!("{GRAPH}/me/outlook/masterCategories?$select=displayName,color");
    // Sob o pool + retry central (#64): faz parte da rajada de abertura, então
    // passa pelo limitador e respeita Retry-After/jitter como as demais.
    let resp = graph_enviar("categorias", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler as categorias: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/outlook/masterCategories retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut categorias = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            let nome = it["displayName"].as_str().unwrap_or("").to_string();
            let preset = it["color"].as_str().unwrap_or("none");
            categorias.push(CategoriaCor {
                nome,
                cor: preset_para_hex(preset).to_string(),
            });
        }
    }
    Ok(categorias)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventoDetalhe {
    pub assunto: String,
    pub inicio: String,
    pub fim: String,
    pub local: String,
    pub online: bool,
    pub join_url: Option<String>,
    pub organizador: String,
    pub corpo: String,
    pub corpo_tipo: String, // "html" | "text"
    pub participantes: Vec<Participante>,
    pub web_link: String,
}

/// Detalhe completo de um evento (corpo + todos os convidados). Calendars.Read.
pub fn cr_evento_corpo(store: &TokenStore, id: &str) -> Result<EventoDetalhe, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!(
        "{GRAPH}/me/events/{id}?$select=subject,start,end,location,onlineMeeting,\
         isOnlineMeeting,onlineMeetingUrl,organizer,body,attendees,webLink"
    );
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .header("Prefer", "outlook.timezone=\"UTC\"")
        .send()
        .map_err(|e| format!("falha ao ler o evento: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/events retornou {}", resp.status()));
    }
    let it: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let participantes: Vec<Participante> = it["attendees"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|a| participante(&a["emailAddress"]))
                .filter(|p| !p.nome.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let join_url = it["onlineMeeting"]["joinUrl"]
        .as_str()
        .or_else(|| it["onlineMeetingUrl"].as_str())
        .map(|s| s.to_string());

    Ok(EventoDetalhe {
        assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
        inicio: it["start"]["dateTime"].as_str().unwrap_or("").to_string(),
        fim: it["end"]["dateTime"].as_str().unwrap_or("").to_string(),
        local: it["location"]["displayName"].as_str().unwrap_or("").to_string(),
        online: it["onlineMeeting"].is_object() || it["isOnlineMeeting"].as_bool().unwrap_or(false),
        join_url,
        organizador: it["organizer"]["emailAddress"]["name"].as_str().unwrap_or("").to_string(),
        corpo: it["body"]["content"].as_str().unwrap_or("").to_string(),
        corpo_tipo: it["body"]["contentType"].as_str().unwrap_or("text").to_string(),
        participantes,
        web_link: it["webLink"].as_str().unwrap_or("").to_string(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailItem {
    pub id: String,
    pub assunto: String,
    pub de: String,
    pub de_email: String,
    pub iniciais: String,
    pub recebido: String, // ISO UTC
    pub preview: String,
    pub lido: bool,
    pub tem_anexos: bool,
    pub sinalizado: bool,
}

/// E-mails recebidos no dia escolhido (limites em ISO UTC). Mail.Read.
pub fn cr_inbox_dia(store: &TokenStore, inicio: &str, fim: &str) -> Result<Vec<EmailItem>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!(
        "{GRAPH}/me/mailFolders/inbox/messages\
         ?$filter=receivedDateTime ge {inicio} and receivedDateTime lt {fim}\
         &$select=subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments,flag\
         &$orderby=receivedDateTime desc&$top=50"
    );
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao ler a inbox: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/mailFolders/inbox/messages retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut itens = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            let de = it["from"]["emailAddress"]["name"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or_else(|| it["from"]["emailAddress"]["address"].as_str())
                .unwrap_or("")
                .to_string();
            itens.push(EmailItem {
                id: it["id"].as_str().unwrap_or("").to_string(),
                assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
                iniciais: iniciais(&de),
                de,
                de_email: it["from"]["emailAddress"]["address"].as_str().unwrap_or("").to_string(),
                recebido: it["receivedDateTime"].as_str().unwrap_or("").to_string(),
                preview: it["bodyPreview"].as_str().unwrap_or("").trim().to_string(),
                lido: it["isRead"].as_bool().unwrap_or(true),
                tem_anexos: it["hasAttachments"].as_bool().unwrap_or(false),
                sinalizado: it["flag"]["flagStatus"].as_str() == Some("flagged"),
            });
        }
    }
    Ok(itens)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnexoEmail {
    pub id: String,
    pub nome: String,
    pub tamanho: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDetalhe {
    pub assunto: String,
    pub de: String,
    pub de_email: String,
    pub para: Vec<String>,
    pub cc: Vec<String>,
    pub recebido: String,
    pub corpo: String,
    pub corpo_tipo: String, // "html" | "text"
    pub anexos: Vec<AnexoEmail>,
    pub web_link: String,
}

/// Nomes (ou e-mails) de uma lista de recipients do Graph.
fn nomes_recipients(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    r["emailAddress"]["name"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .or_else(|| r["emailAddress"]["address"].as_str())
                        .unwrap_or("")
                        .to_string()
                })
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Corpo completo de um e-mail + destinatarios e anexos. Mail.Read.
pub fn cr_email_corpo(store: &TokenStore, id: &str) -> Result<EmailDetalhe, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!(
        "{GRAPH}/me/messages/{id}\
         ?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,webLink"
    );
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao ler o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/messages retornou {}", resp.status()));
    }
    let it: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let para = nomes_recipients(&it["toRecipients"]);
    let cc = nomes_recipients(&it["ccRecipients"]);

    // Anexos so quando houver (poupa uma chamada).
    let mut anexos = Vec::new();
    if it["hasAttachments"].as_bool().unwrap_or(false) {
        let au = format!("{GRAPH}/me/messages/{id}/attachments?$select=id,name,size");
        if let Ok(r) = client.get(&au).bearer_auth(&token).send() {
            if r.status().is_success() {
                if let Ok(va) = r.json::<serde_json::Value>() {
                    if let Some(arr) = va["value"].as_array() {
                        for a in arr {
                            anexos.push(AnexoEmail {
                                id: a["id"].as_str().unwrap_or("").to_string(),
                                nome: a["name"].as_str().unwrap_or("arquivo").to_string(),
                                tamanho: a["size"].as_u64().unwrap_or(0),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(EmailDetalhe {
        assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
        de: it["from"]["emailAddress"]["name"].as_str().unwrap_or("").to_string(),
        de_email: it["from"]["emailAddress"]["address"].as_str().unwrap_or("").to_string(),
        para,
        cc,
        recebido: it["receivedDateTime"].as_str().unwrap_or("").to_string(),
        corpo: it["body"]["content"].as_str().unwrap_or("").to_string(),
        corpo_tipo: it["body"]["contentType"].as_str().unwrap_or("text").to_string(),
        anexos,
        web_link: it["webLink"].as_str().unwrap_or("").to_string(),
    })
}

/// Baixa um anexo de um e-mail para a pasta Downloads do usuario e devolve o
/// caminho absoluto do arquivo gravado. Mail.Read.
///
/// O fileAttachment do Graph traz o conteudo em `contentBytes` (base64). Grava
/// em %USERPROFILE%\Downloads, criando a pasta se nao existir, e resolve
/// colisoes de nome anexando " (1)", " (2)", ... antes da extensao.
pub fn cr_baixar_anexo(
    store: &TokenStore,
    message_id: &str,
    attachment_id: &str,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!("{GRAPH}/me/messages/{message_id}/attachments/{attachment_id}");
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao baixar o anexo: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/messages/attachments retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let nome = v["name"].as_str().unwrap_or("anexo").to_string();
    let bytes_str = v["contentBytes"]
        .as_str()
        .ok_or("anexo sem conteudo (nao e um arquivo?)")?;
    let bytes = general_purpose::STANDARD
        .decode(bytes_str)
        .map_err(|e| format!("conteudo do anexo invalido: {e}"))?;

    // Pasta Downloads da conta do Windows; cria se nao existir.
    let perfil = std::env::var("USERPROFILE")
        .map_err(|_| "nao encontrei a pasta do usuario".to_string())?;
    let downloads = std::path::Path::new(&perfil).join("Downloads");
    std::fs::create_dir_all(&downloads)
        .map_err(|e| format!("falha ao criar a pasta Downloads: {e}"))?;

    // Sanitiza o nome: descarta qualquer componente de caminho que venha no
    // nome do anexo (evita escrever fora da pasta Downloads).
    let seguro = std::path::Path::new(&nome)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("anexo")
        .to_string();

    let destino = caminho_livre(&downloads, &seguro);
    std::fs::write(&destino, &bytes)
        .map_err(|e| format!("falha ao gravar o arquivo: {e}"))?;

    Ok(destino.to_string_lossy().to_string())
}

/// Devolve um caminho ainda livre dentro de `dir` para `nome`. Se ja existir,
/// anexa " (1)", " (2)", ... antes da extensao ate achar um nome disponivel.
fn caminho_livre(dir: &std::path::Path, nome: &str) -> std::path::PathBuf {
    let inicial = dir.join(nome);
    if !inicial.exists() {
        return inicial;
    }
    let base = std::path::Path::new(nome);
    let tronco = base
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(nome)
        .to_string();
    let ext = base.extension().and_then(|s| s.to_str());

    let mut n = 1u32;
    loop {
        let candidato = match ext {
            Some(e) => format!("{tronco} ({n}).{e}"),
            None => format!("{tronco} ({n})"),
        };
        let p = dir.join(&candidato);
        if !p.exists() {
            return p;
        }
        n += 1;
    }
}

// ----------------------------------------------------------------------------
// Envio: responder / encaminhar. Fluxo em 3 passos pra preservar o histórico
// citado e enviar o HTML composto pelo editor:
//   1) POST createReply|createReplyAll|createForward  -> rascunho (com a citação)
//   2) PATCH /messages/{rascunho}                      -> prepende o texto novo
//   3) POST  /messages/{rascunho}/send                 -> dispara (202)
// Escopos: Mail.ReadWrite (rascunho) + Mail.Send (envio).
// ----------------------------------------------------------------------------

/// Anexo recebido do front, pronto para virar fileAttachment do Graph.
/// `conteudo_b64` (camelCase `conteudoB64`) é o binário já em base64.
#[derive(serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnexoUp {
    pub nome: String,
    pub tipo: String,
    pub conteudo_b64: String,
}

/// Monta o corpo de um `#microsoft.graph.fileAttachment` a partir de um AnexoUp.
fn anexo_json(a: &AnexoUp) -> serde_json::Value {
    serde_json::json!({
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": a.nome,
        "contentType": if a.tipo.is_empty() { "application/octet-stream" } else { &a.tipo },
        "contentBytes": a.conteudo_b64,
    })
}

/// Cria um rascunho de resposta/encaminhamento, injeta o corpo e envia.
fn compor_e_enviar(
    store: &TokenStore,
    id: &str,
    acao: &str, // "createReply" | "createReplyAll" | "createForward"
    corpo_html: &str,
    para: &[String],
    anexos: &[AnexoUp],
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // 1) rascunho a partir da mensagem original
    let url = format!("{GRAPH}/me/messages/{id}/{acao}");
    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .header("Content-Length", "0")
        .send()
        .map_err(|e| format!("falha ao criar o rascunho: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{acao} retornou {}", resp.status()));
    }
    let rascunho: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let draft_id = rascunho["id"].as_str().ok_or("rascunho sem id")?.to_string();
    // corpo original (com a citação) que o Graph montou — preservamos abaixo
    let citacao = rascunho["body"]["content"].as_str().unwrap_or("");
    let corpo_final = format!("{corpo_html}<br>{citacao}");

    // 2) PATCH: injeta o HTML composto (+ destinatários no encaminhamento)
    let mut patch = serde_json::json!({
        "body": { "contentType": "HTML", "content": corpo_final }
    });
    if !para.is_empty() {
        let dest: Vec<serde_json::Value> = para
            .iter()
            .filter(|e| !e.trim().is_empty())
            .map(|e| serde_json::json!({ "emailAddress": { "address": e.trim() } }))
            .collect();
        patch["toRecipients"] = serde_json::Value::Array(dest);
    }
    let url = format!("{GRAPH}/me/messages/{draft_id}");
    let resp = client
        .patch(&url)
        .bearer_auth(&token)
        .json(&patch)
        .send()
        .map_err(|e| format!("falha ao preencher o rascunho: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("PATCH do rascunho retornou {}", resp.status()));
    }

    // 2.5) anexa os arquivos no rascunho (POST /attachments), um por vez.
    for a in anexos {
        if a.conteudo_b64.trim().is_empty() {
            continue;
        }
        let url = format!("{GRAPH}/me/messages/{draft_id}/attachments");
        let resp = client
            .post(&url)
            .bearer_auth(&token)
            .json(&anexo_json(a))
            .send()
            .map_err(|e| format!("falha ao anexar '{}': {e}", a.nome))?;
        if !resp.status().is_success() {
            return Err(format!(
                "anexar '{}' retornou {}",
                a.nome,
                resp.status()
            ));
        }
    }

    // 3) envia
    let url = format!("{GRAPH}/me/messages/{draft_id}/send");
    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .header("Content-Length", "0")
        .send()
        .map_err(|e| format!("falha ao enviar: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("envio retornou {}", resp.status()));
    }
    Ok(())
}

/// Responde um e-mail (Mail.ReadWrite + Mail.Send). `todos` = responder a todos.
pub fn cr_responder(
    store: &TokenStore,
    id: &str,
    corpo_html: &str,
    todos: bool,
    anexos: Vec<AnexoUp>,
) -> Result<(), String> {
    let acao = if todos { "createReplyAll" } else { "createReply" };
    compor_e_enviar(store, id, acao, corpo_html, &[], &anexos)
}

/// Encaminha um e-mail para os destinatários informados.
pub fn cr_encaminhar(
    store: &TokenStore,
    id: &str,
    corpo_html: &str,
    para: Vec<String>,
    anexos: Vec<AnexoUp>,
) -> Result<(), String> {
    if para.iter().all(|e| e.trim().is_empty()) {
        return Err("informe ao menos um destinatário".into());
    }
    compor_e_enviar(store, id, "createForward", corpo_html, &para, &anexos)
}

/// Sobe um arquivo para a pasta "Bridge Anexos" no OneDrive do usuário e cria um
/// link de compartilhamento (view, escopo da organização). Retorna o webUrl do
/// link, que o front insere no corpo do e-mail. Retry no 429 nos dois passos.
///
/// PUT simples de conteúdo (bom até ~4 MB — anexos de e-mail cabem folgado);
/// arquivos maiores exigiriam upload session, fora do escopo aqui. Files.ReadWrite.
pub fn cr_compartilhar_onedrive(
    store: &TokenStore,
    nome: &str,
    conteudo_b64: &str,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let bytes = general_purpose::STANDARD
        .decode(conteudo_b64.trim())
        .map_err(|e| format!("conteudo do arquivo invalido: {e}"))?;

    // Sanitiza: descarta qualquer componente de caminho no nome (sem traversal)
    // e percent-encoda para caber no addressing por path do Graph.
    let seguro = std::path::Path::new(nome)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("arquivo");
    let nome_enc = urlencoding::encode(seguro);

    // 1) PUT do conteúdo em /Bridge Anexos/{nome} (cria a pasta se preciso).
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let put_url = format!("{GRAPH}/me/drive/root:/Bridge%20Anexos/{nome_enc}:/content");
    let resp = graph_enviar("onedrive:upload", GRAPH_TETO_ESPERA_S, || {
        client
            .put(&put_url)
            .bearer_auth(&token)
            .header("Content-Type", "application/octet-stream")
            .body(bytes.clone())
            .send()
    })
    .map_err(|e| format!("falha no upload: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let txt = resp.text().unwrap_or_default();
        return Err(format!("upload retornou {st}: {txt}"));
    }
    let item: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let item_id = item["id"].as_str().ok_or("item enviado sem id")?;

    // 2) POST /createLink (view, organization) -> devolve o webUrl do link.
    let link_url = format!("{GRAPH}/me/drive/items/{item_id}/createLink");
    let corpo = serde_json::json!({ "type": "view", "scope": "organization" });
    let resp = graph_enviar("onedrive:createLink", GRAPH_TETO_ESPERA_S, || {
        client.post(&link_url).bearer_auth(&token).json(&corpo).send()
    })
    .map_err(|e| format!("falha ao criar o link: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let txt = resp.text().unwrap_or_default();
        return Err(format!("createLink retornou {st}: {txt}"));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let web = v["link"]["webUrl"]
        .as_str()
        .ok_or("link sem webUrl")?
        .to_string();
    Ok(web)
}

// ----------------------------------------------------------------------------
// Cliente de e-mail (Control room): pastas + mensagens por pasta.
// ----------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastaEmail {
    /// id well-known da pasta (serve direto no endpoint de mensagens).
    pub id: String,
    /// chave estável pro ícone/rótulo no front (ex.: "inbox", "sentitems").
    pub tipo: String,
    /// displayName localizado (fallback caso o front não traduza).
    pub nome: String,
    pub nao_lidos: u64,
    pub total: u64,
    /// nº de subpastas — o front só mostra o chevron de expandir quando > 0.
    pub filhos: u64,
}

/// Pastas de e-mail padrão do usuário, com contagens. Mail.Read.
pub fn cr_mail_folders(store: &TokenStore) -> Result<Vec<PastaEmail>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // Pastas well-known (o id textual funciona direto no Graph).
    let alvos = [
        "inbox",
        "drafts",
        "sentitems",
        "archive",
        "junkemail",
        "deleteditems",
    ];
    let mut pastas = Vec::new();
    for id in alvos {
        // Sempre inclui a pasta (mesmo que a contagem falhe): o Inbox não pode
        // sumir do sidebar por causa de um 404/erro transitório numa das chamadas.
        let mut nao_lidos = 0;
        let mut total = 0;
        let mut filhos = 0;
        let mut nome = id.to_string();
        // $expand=childFolders (não $select=childFolderCount): o childFolderCount
        // conta subpastas OCULTAS de sistema (ex.: em Deleted), fazendo aparecer
        // um chevron que expande pra nada. O $expand — como o /childFolders da
        // busca ao expandir — só traz as VISÍVEIS, então `filhos` bate com o que
        // o usuário vê. $top=1 basta pra saber se há ≥1 (chevron sim/não). (#62)
        let url = format!(
            "{GRAPH}/me/mailFolders/{id}?$select=displayName,unreadItemCount,totalItemCount&$expand=childFolders($select=id;$top=1)"
        );
        // Sob o pool + retry central (#64): respeita Retry-After e usa jitter. Sem
        // isso o Inbox aparecia sem contagem de não lidos quando o Graph limitava.
        match graph_enviar("mail:pasta", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(v) = resp.json::<serde_json::Value>() {
                    nome = v["displayName"].as_str().unwrap_or(id).to_string();
                    nao_lidos = v["unreadItemCount"].as_u64().unwrap_or(0);
                    total = v["totalItemCount"].as_u64().unwrap_or(0);
                    // conta só as subpastas VISÍVEIS que o $expand trouxe (#62)
                    filhos = v["childFolders"].as_array().map(|a| a.len() as u64).unwrap_or(0);
                }
            }
            Ok(resp) => {
                log::warn!("[mail] pasta '{id}' retornou {}", resp.status());
            }
            Err(e) => {
                log::warn!("[mail] pasta '{id}' falhou: {e}");
            }
        }
        pastas.push(PastaEmail {
            id: id.to_string(),
            tipo: id.to_string(),
            nome,
            nao_lidos,
            total,
            filhos,
        });
    }
    Ok(pastas)
}

/// Monta um EmailItem a partir de um item de mensagem do Graph. `saida` = pasta
/// de saída (Enviados/Rascunhos): mostra o destinatário no lugar do remetente e
/// usa a data de envio. Compartilhado por cr_folder_mensagens e cr_buscar para
/// que a lista fique idêntica nos dois caminhos.
fn montar_email_item(it: &serde_json::Value, saida: bool) -> EmailItem {
    // Em pastas de saída, mostra o destinatário; nas demais, o remetente.
    let contraparte = if saida {
        it["toRecipients"][0]["emailAddress"]["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| it["toRecipients"][0]["emailAddress"]["address"].as_str())
            .unwrap_or("")
            .to_string()
    } else {
        it["from"]["emailAddress"]["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| it["from"]["emailAddress"]["address"].as_str())
            .unwrap_or("")
            .to_string()
    };
    let quando = if saida {
        it["sentDateTime"].as_str().unwrap_or("")
    } else {
        it["receivedDateTime"].as_str().unwrap_or("")
    };
    // e-mail da contraparte: em saída é o destinatário, senão o remetente
    // (antes ficava sempre o "from", desalinhando com o nome mostrado).
    let contraparte_email = if saida {
        it["toRecipients"][0]["emailAddress"]["address"].as_str().unwrap_or("")
    } else {
        it["from"]["emailAddress"]["address"].as_str().unwrap_or("")
    };
    EmailItem {
        id: it["id"].as_str().unwrap_or("").to_string(),
        assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
        iniciais: iniciais(&contraparte),
        de_email: contraparte_email.to_string(),
        de: contraparte,
        recebido: quando.to_string(),
        preview: it["bodyPreview"].as_str().unwrap_or("").trim().to_string(),
        lido: it["isRead"].as_bool().unwrap_or(true),
        tem_anexos: it["hasAttachments"].as_bool().unwrap_or(false),
        sinalizado: it["flag"]["flagStatus"].as_str() == Some("flagged"),
    }
}

/// Mensagens de uma pasta (até 50, mais recentes primeiro). Mail.Read.
/// Em Enviados/Rascunhos o "de" vira o destinatário (faz mais sentido na lista).
/// Mapeia a chave de ordenação do front para o campo $orderby do Graph. Data
/// respeita a pasta (enviados/rascunhos ordenam por envio). "type" do Outlook
/// não é sortável no Graph → cai no default (data). Só campos que o Graph aceita
/// em $orderby de mensagens.
fn campo_ordenacao(folder_id: &str, chave: &str) -> &'static str {
    let saida = matches!(folder_id, "sentitems" | "drafts");
    let data = if saida { "sentDateTime" } else { "receivedDateTime" };
    match chave {
        "remetente" => "from/emailAddress/name",
        "assunto" => "subject",
        // tamanho/importancia/flag NÃO são ordenáveis server-side no Graph
        // (400) — foram tirados do escopo (#60). Persistidos antigos caem aqui.
        _ => data, // "data" e qualquer desconhecido/removido
    }
}

pub fn cr_folder_mensagens(
    store: &TokenStore,
    folder_id: &str,
    skip: u32,
    ordenar: &str,
    descendente: bool,
) -> Result<Vec<EmailItem>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let saida = matches!(folder_id, "sentitems" | "drafts");
    let campo = campo_ordenacao(folder_id, ordenar);
    let dir = if descendente { "desc" } else { "asc" };
    // Página de 50, com $skip para o lazy load (rolar até o fim carrega mais).
    let base = format!(
        "{GRAPH}/me/mailFolders/{folder_id}/messages\
         ?$select=subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,flag\
         &$top=50&$skip={skip}"
    );
    // Ordenação escolhida; se o Graph REJEITAR o $orderby (400 — ex.: alguns
    // tenants não ordenam por flag/flagStatus), cai no default (data) e refaz —
    // uma ordenação inválida NUNCA pode travar o carregamento da pasta.
    // Retry no 429 (Retry-After): na abertura o app dispara várias chamadas
    // juntas e o Graph estrangula.
    // O 429 fica com o pool + retry central (#64: Retry-After + jitter); aqui só
    // resta o fallback de $orderby: se o Graph REJEITAR (400), refaz com o
    // default (data). Loop pequeno — no máximo uma segunda passada.
    let padrao = format!("{} desc", if saida { "sentDateTime" } else { "receivedDateTime" });
    let mut orderby = format!("{campo} {dir}");
    let resp = loop {
        let url = format!("{base}&$orderby={orderby}");
        let r = graph_enviar("mail:mensagens", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        })
        .map_err(|e| format!("falha ao ler a pasta: {e}"))?;
        if r.status().is_success() {
            break r;
        }
        if r.status().as_u16() == 400 && orderby != padrao {
            log::warn!("[mail] orderby '{orderby}' rejeitado (400); caindo no default (data)");
            orderby = padrao.clone();
            continue;
        }
        return Err(format!("/me/mailFolders/{folder_id}/messages retornou {}", r.status()));
    };
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut itens = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            itens.push(montar_email_item(it, saida));
        }
    }
    Ok(itens)
}

/// Uma página de resultados de busca: os itens desta página e a URL de
/// continuação do Graph (`@odata.nextLink`), quando houver mais páginas.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuscaPagina {
    pub itens: Vec<EmailItem>,
    /// `@odata.nextLink` desta resposta, para pedir a próxima página. `None`
    /// quando esta foi a última página.
    pub proximo: Option<String>,
}

/// Busca mensagens numa pasta pelo termo, no SERVIDOR (via $search do Graph).
/// Devolve a mesma lista de cr_folder_mensagens (reusa montar_email_item), em
/// páginas de 50. O $search do Graph NÃO aceita $orderby junto — por isso não
/// incluímos orderby aqui (o Graph já ordena por relevância). Exige o header
/// ConsistencyLevel: eventual. Retry no 429. Mail.Read.
///
/// Paginação por CONTINUAÇÃO: o $search do Graph NÃO suporta $skip (paginar com
/// $skip junto de $search quebra além da 1ª página). A forma correta é seguir o
/// `@odata.nextLink` (skiptoken), que este devolve em `proximo`. Passe essa URL
/// de volta em `next_link` para pedir a próxima página; ela já vem com
/// $search+$top+skiptoken embutidos, então é usada como GET direto.
pub fn cr_buscar(
    store: &TokenStore,
    folder_id: &str,
    termo: &str,
    next_link: Option<String>,
) -> Result<BuscaPagina, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let saida = matches!(folder_id, "sentitems" | "drafts");
    // Continuação: se veio um nextLink, ele já traz $search+$top+skiptoken —
    // usa-se tal e qual. Só na 1ª página montamos a URL inicial.
    let url = match next_link {
        Some(link) => link,
        None => {
            // As aspas duplas fazem parte da sintaxe do $search; as que vierem no
            // próprio termo são trocadas por espaço para não fechar a expressão
            // antes da hora.
            let termo_limpo = termo.replace('"', " ");
            let enc = urlencoding::encode(termo_limpo.trim());
            // Sem $orderby: o Graph rejeita orderby combinado com $search.
            format!(
                "{GRAPH}/me/mailFolders/{folder_id}/messages\
                 ?$search=\"{enc}\"\
                 &$select=subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,flag\
                 &$top=50"
            )
        }
    };
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let resp = graph_enviar("mail:busca", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("ConsistencyLevel", "eventual")
            .send()
    })
    .map_err(|e| format!("falha na busca: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "busca em /me/mailFolders/{folder_id}/messages retornou {}",
            resp.status()
        ));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut itens = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            itens.push(montar_email_item(it, saida));
        }
    }
    let proximo = v["@odata.nextLink"].as_str().map(|s| s.to_string());
    Ok(BuscaPagina { itens, proximo })
}

/// Resolve o endereço do próprio usuário a partir do token (`/me`). Usado pelo
/// filtro "To me" (D5): "me" é resolvido no backend, não passado pelo front.
fn meu_endereco(client: &reqwest::blocking::Client, token: &str) -> Option<String> {
    let url = format!("{GRAPH}/me?$select=mail,userPrincipalName");
    let r = client.get(&url).bearer_auth(token).send().ok()?;
    if !r.status().is_success() {
        return None;
    }
    let v: serde_json::Value = r.json().ok()?;
    v["mail"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| v["userPrincipalName"].as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Filtra mensagens de uma pasta por um dos filtros que EXIGEM o servidor
/// (os client-side — All/Unread/Flagged/Files — são aplicados no front sobre a
/// lista já carregada). Devolve a mesma `BuscaPagina` de cr_buscar (reusa
/// `montar_email_item`), em páginas de 50, paginando pela CONTINUAÇÃO
/// (`@odata.nextLink`) igual à busca.
///
/// `filtro` aceita:
///   - "tome"     → endereçadas a mim: `$search="to:<meu-email>"` (D5: só a
///                  linha To; "me" resolvido no backend pelo token).
///   - "mentions" → onde fui mencionado: `$filter=mentionsPreview/isMentioned
///                  eq true` (exige ConsistencyLevel: eventual).
///   - "invites"  → convites de agenda: cast OData
///                  `/messages/microsoft.graph.eventMessage`.
///
/// Suporte de "mentions"/"invites" varia por tenant. Quando o Graph responde
/// 400, devolvemos um erro sentinela iniciado por "HTTP 400" para o front
/// esconder a opção silenciosamente (D6) em vez de mostrar erro.
pub fn cr_filtrar(
    store: &TokenStore,
    folder_id: &str,
    filtro: &str,
    next_link: Option<String>,
) -> Result<BuscaPagina, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let saida = matches!(folder_id, "sentitems" | "drafts");
    // Campos idênticos aos de cr_buscar/cr_folder_mensagens: a lista fica igual
    // nos três caminhos (montados por montar_email_item).
    const SELECT: &str = "subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,flag";

    // Continuação: o nextLink já traz filtro+select+top+skiptoken embutidos —
    // usa-se tal e qual. Só na 1ª página montamos a URL inicial por filtro.
    let url = match next_link {
        Some(link) => link,
        None => match filtro {
            "tome" => {
                let email = meu_endereco(&client, &token)
                    .ok_or_else(|| "não foi possível resolver o endereço do usuário".to_string())?;
                // KQL: restringe à linha To (D5). Aspas do $search fazem parte da
                // sintaxe; o valor vai percent-encodado.
                let kql = format!("to:{email}");
                let enc = urlencoding::encode(&kql);
                format!(
                    "{GRAPH}/me/mailFolders/{folder_id}/messages\
                     ?$search=\"{enc}\"&$select={SELECT}&$top=50"
                )
            }
            "mentions" => {
                let flt = urlencoding::encode("mentionsPreview/isMentioned eq true");
                format!(
                    "{GRAPH}/me/mailFolders/{folder_id}/messages\
                     ?$filter={flt}&$select={SELECT}&$top=50"
                )
            }
            "invites" => format!(
                "{GRAPH}/me/mailFolders/{folder_id}/messages/microsoft.graph.eventMessage\
                 ?$select={SELECT}&$top=50"
            ),
            outro => return Err(format!("filtro de servidor desconhecido: '{outro}'")),
        },
    };

    // ConsistencyLevel: eventual é exigido por $search e pelo $filter de
    // mentions; inofensivo no cast de invites. Retry no 429 pelo pool central
    // (#64), igual a cr_buscar.
    let resp = graph_enviar("mail:filtro", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("ConsistencyLevel", "eventual")
            .send()
    })
    .map_err(|e| format!("falha ao filtrar: {e}"))?;
    if resp.status().as_u16() == 400 {
        // Tenant não suporta este filtro → sentinela pro front esconder a opção
        // (D6). Não é falha "real", então fica em nível debug.
        log::debug!("[mail] filtro '{filtro}' retornou 400 (não suportado no tenant)");
        return Err(format!("HTTP 400: filtro '{filtro}' não suportado neste tenant"));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "filtro '{filtro}' em /me/mailFolders/{folder_id}/messages retornou {}",
            resp.status()
        ));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut itens = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            itens.push(montar_email_item(it, saida));
        }
    }
    let proximo = v["@odata.nextLink"].as_str().map(|s| s.to_string());
    Ok(BuscaPagina { itens, proximo })
}

// ----------------------------------------------------------------------------
// Ações de e-mail (Control room): excluir, sinalizar, marcar lido; e ações de
// PASTA inteira: esvaziar (Lixeira/Lixo) e marcar todas como lidas (#89).
// Escopo: Mail.ReadWrite.
// ----------------------------------------------------------------------------

/// DELETE de uma mensagem com retry no 429 (throttling) respeitando Retry-After.
/// 404 conta como sucesso (já foi removida — idempotente). Até 4 tentativas.
fn deletar_msg(
    client: &reqwest::blocking::Client,
    token: &str,
    id: &str,
) -> Result<(), String> {
    let url = format!("{GRAPH}/me/messages/{id}");
    // Sob o pool + retry central (#64): Retry-After + jitter. 404 = idempotente.
    let resp = graph_enviar("mail:excluir", GRAPH_TETO_ESPERA_S, || {
        client.delete(&url).bearer_auth(token).send()
    })
    .map_err(|e| format!("falha ao excluir o e-mail: {e}"))?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(format!("DELETE /me/messages retornou {}", resp.status()))
    }
}

/// Move uma mensagem para uma pasta (well-known como "deleteditems" ou id).
/// 404 conta como sucesso (idempotente). Retry no 429. Mail.ReadWrite.
fn mover_msg(
    client: &reqwest::blocking::Client,
    token: &str,
    id: &str,
    destino: &str,
) -> Result<(), String> {
    let url = format!("{GRAPH}/me/messages/{id}/move");
    let body = serde_json::json!({ "destinationId": destino });
    // Sob o pool + retry central (#64): Retry-After + jitter. 404 = idempotente.
    let resp = graph_enviar("mail:mover", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(token).json(&body).send()
    })
    .map_err(|e| format!("falha ao mover o e-mail: {e}"))?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(format!("POST /me/messages/move retornou {}", resp.status()))
    }
}

/// Exclui um e-mail (move para a Lixeira; recuperável). Mail.ReadWrite.
pub fn cr_excluir_email(store: &TokenStore, id: &str) -> Result<(), String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    mover_msg(&client, &token, id, "deleteditems")
}

/// Exclui vários e-mails em série (evita a rajada concorrente que leva o Graph a
/// 429). Por padrão MOVE para a Lixeira (recuperável) — o DELETE puro podia ir
/// pra exclusão definitiva. Com `permanente=true` (ex.: excluindo de dentro da
/// própria Lixeira) apaga de vez. Cada item tem retry no 429; 404 = já saiu.
/// Retorna os ids que realmente saíram. Mail.ReadWrite.
pub fn cr_excluir_emails(
    store: &TokenStore,
    ids: Vec<String>,
    permanente: bool,
) -> Result<Vec<String>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    let mut ok = Vec::with_capacity(ids.len());
    for id in &ids {
        let r = if permanente {
            deletar_msg(&client, &token, id)
        } else {
            mover_msg(&client, &token, id, "deleteditems")
        };
        match r {
            Ok(()) => ok.push(id.clone()),
            Err(e) => log::warn!("[mail] excluir '{id}' falhou: {e}"),
        }
    }
    Ok(ok)
}

/// Move vários e-mails para uma pasta (#88), em série — evita a rajada
/// concorrente que leva o Graph a 429. `destino` aceita tanto um nome
/// well-known ("archive", "junkemail"…) quanto o id real de uma subpasta, que é
/// exatamente o que `cr_mail_folders`/`cr_subpastas` devolvem como `id`.
/// Reusa `mover_msg` (POST /me/messages/{id}/move com `destinationId`), que já
/// roda sob o pool + retry central do 429 (Retry-After + jitter); 404 = a
/// mensagem já saiu (idempotente). Retorna os ids que realmente foram movidos —
/// o front usa isso para reconciliar o otimista. Mail.ReadWrite.
pub fn cr_mover_emails(
    store: &TokenStore,
    ids: Vec<String>,
    destino: String,
) -> Result<Vec<String>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    let mut ok = Vec::with_capacity(ids.len());
    for id in &ids {
        match mover_msg(&client, &token, id, &destino) {
            Ok(()) => ok.push(id.clone()),
            Err(e) => log::warn!("[mail] mover '{id}' para '{destino}' falhou: {e}"),
        }
    }
    Ok(ok)
}

/// Sinaliza ou remove a sinalização de um e-mail. Mail.ReadWrite.
pub fn cr_marcar_email(store: &TokenStore, id: &str, sinalizado: bool) -> Result<(), String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let status = if sinalizado { "flagged" } else { "notFlagged" };
    let patch = serde_json::json!({ "flag": { "flagStatus": status } });

    let url = format!("{GRAPH}/me/messages/{id}");
    let resp = client
        .patch(&url)
        .bearer_auth(&token)
        .json(&patch)
        .send()
        .map_err(|e| format!("falha ao sinalizar o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("PATCH /me/messages retornou {}", resp.status()));
    }
    Ok(())
}

/// Marca um e-mail como lido ou não lido (PATCH isRead). Retry no 429
/// respeitando Retry-After, até 3 tentativas. Mail.ReadWrite.
pub fn cr_marcar_lido(store: &TokenStore, id: &str, lido: bool) -> Result<(), String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let patch = serde_json::json!({ "isRead": lido });
    let url = format!("{GRAPH}/me/messages/{id}");
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let resp = graph_enviar("mail:marcar-lido", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&patch).send()
    })
    .map_err(|e| format!("falha ao marcar como lido: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("PATCH /me/messages retornou {}", resp.status()))
    }
}

/// Trava de segurança das varreduras de pasta inteira (esvaziar / marcar todas
/// lidas): teto de itens por chamada, para nenhum laço rodar sem fim se o Graph
/// não refletir a mutação na página seguinte.
const CR_PASTA_LIMITE: u64 = 1000;

/// Esvazia uma pasta (Lixeira ou Lixo Eletrônico): apaga cada mensagem via
/// DELETE, paginando até a pasta ficar vazia. `folder_id` aceita tanto o nome
/// well-known ("deleteditems", "junkemail") quanto o id real da pasta.
/// Retorna quantas foram excluídas. Mail.ReadWrite.
///
/// Não usa `$skip`: cada volta relê a PRIMEIRA página, porque os itens da volta
/// anterior já saíram da pasta — paginar por offset puliria mensagens.
pub fn cr_esvaziar_pasta(store: &TokenStore, folder_id: &str) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let mut apagados: u64 = 0;

    loop {
        let url = format!("{GRAPH}/me/mailFolders/{folder_id}/messages?$select=id&$top=50");
        // Sob o pool + retry central (#64): Retry-After + jitter.
        let resp = graph_enviar("mail:esvaziar", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        })
        .map_err(|e| format!("falha ao ler a pasta: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "/me/mailFolders/{folder_id}/messages retornou {}",
                resp.status()
            ));
        }
        let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let ids: Vec<String> = v["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|it| it["id"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // Nada mais a apagar: terminamos.
        if ids.is_empty() {
            break;
        }

        // deletar_msg trata 404 como sucesso (item já saiu) e tem retry no 429 —
        // era o 404 num item da lixeira que abortava o "Empty trash" inteiro.
        let mut progrediu = false;
        for id in ids {
            match deletar_msg(&client, &token, &id) {
                Ok(()) => {
                    apagados += 1;
                    progrediu = true;
                    if apagados >= CR_PASTA_LIMITE {
                        log::warn!(
                            "[mail] esvaziar '{folder_id}': limite de {CR_PASTA_LIMITE} atingido, interrompendo"
                        );
                        return Ok(apagados);
                    }
                }
                Err(e) => log::warn!("[mail] esvaziar '{folder_id}': '{id}' falhou: {e}"),
            }
        }
        // Página inteira sem sair nada: evita reler as mesmas em loop infinito.
        if !progrediu {
            log::warn!("[mail] esvaziar '{folder_id}': página sem progresso, interrompendo");
            break;
        }
    }

    Ok(apagados)
}

/// Marca como lidas TODAS as mensagens não lidas de uma pasta (#89). Pagina
/// `?$filter=isRead eq false` e faz `PATCH {isRead:true}` em série — em série de
/// propósito: a rajada concorrente é justamente o que leva o tenant a 429.
/// `folder_id` aceita well-known ("inbox", "junkemail") ou id real.
/// Retorna quantas foram marcadas. Mail.ReadWrite.
///
/// Mesma estratégia de paginação do `cr_esvaziar_pasta`: relê sempre a primeira
/// página, porque o item marcado sai do filtro `isRead eq false`.
pub fn cr_marcar_pasta_lida(store: &TokenStore, folder_id: &str) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let filtro = urlencoding::encode("isRead eq false");
    let patch = serde_json::json!({ "isRead": true });
    let mut marcadas: u64 = 0;

    loop {
        let url = format!(
            "{GRAPH}/me/mailFolders/{folder_id}/messages?$filter={filtro}&$select=id&$top=50"
        );
        // Sob o pool + retry central (#64): Retry-After + jitter.
        let resp = graph_enviar("mail:marcar-pasta-lida", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        })
        .map_err(|e| format!("falha ao ler a pasta: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "/me/mailFolders/{folder_id}/messages retornou {}",
                resp.status()
            ));
        }
        let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let ids: Vec<String> = v["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|it| it["id"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // Não sobrou não-lido: terminamos.
        if ids.is_empty() {
            break;
        }

        let mut progrediu = false;
        for id in &ids {
            let msg_url = format!("{GRAPH}/me/messages/{id}");
            let r = graph_enviar("mail:marcar-pasta-lida", GRAPH_TETO_ESPERA_S, || {
                client.patch(&msg_url).bearer_auth(&token).json(&patch).send()
            });
            match r {
                // 404 = a mensagem saiu da pasta no meio do caminho: idempotente,
                // conta como progresso pra não travar o laço nessa página.
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 404 => {
                    if resp.status().is_success() {
                        marcadas += 1;
                    }
                    progrediu = true;
                    if marcadas >= CR_PASTA_LIMITE {
                        log::warn!(
                            "[mail] marcar lidas '{folder_id}': limite de {CR_PASTA_LIMITE} atingido, interrompendo"
                        );
                        return Ok(marcadas);
                    }
                }
                Ok(resp) => log::warn!(
                    "[mail] marcar lidas '{folder_id}': '{id}' retornou {}",
                    resp.status()
                ),
                Err(e) => log::warn!("[mail] marcar lidas '{folder_id}': '{id}' falhou: {e}"),
            }
        }
        // Página inteira sem progresso: evita reler as mesmas em loop infinito.
        if !progrediu {
            log::warn!("[mail] marcar lidas '{folder_id}': página sem progresso, interrompendo");
            break;
        }
    }

    Ok(marcadas)
}

// ----------------------------------------------------------------------------
// Compositor de e-mail: busca de pessoas (autocomplete), envio de mensagem
// nova, salvar contatos e subpastas. Escopos: People.Read, Contacts.ReadWrite,
// Mail.Send (ja concedido). Tudo delegado (/me).
// ----------------------------------------------------------------------------

/// Origem da sugestao no autocomplete — vira a secao ("Seus contatos" x "De sua
/// organizacao") na lista do compositor (#40).
pub const ORIGEM_CONTATOS: &str = "contatos";
pub const ORIGEM_ORGANIZACAO: &str = "organizacao";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pessoa {
    pub nome: String,
    pub email: String,
    /// Cargo (`jobTitle`) — 2a linha da sugestao. Costuma faltar em contato
    /// pessoal/externo, entao e opcional.
    #[serde(default)]
    pub cargo: Option<String>,
    /// `contatos` (/me/people) ou `organizacao` (/users). Opcional porque o
    /// front tambem manda `Pessoa` de volta em `cr_salvar_contatos`, sem isso.
    #[serde(default)]
    pub origem: Option<String>,
}

/// `jobTitle` do item do Graph, descartando string vazia/null (o Graph devolve
/// `null` para quem nao tem cargo preenchido no diretorio).
fn cargo_de(item: &serde_json::Value) -> Option<String> {
    item["jobTitle"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Busca pessoas para o autocomplete do compositor. Combina o "relevant people"
/// do usuario (/me/people) com um $search no diretorio (/users). Se um dos dois
/// falhar, usa so o que veio do outro; erro so quando AMBOS falham. People.Read.
pub fn cr_pessoas(store: &TokenStore, query: &str) -> Result<Vec<Pessoa>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();
    let enc = urlencoding::encode(q);

    let mut resultados: Vec<Pessoa> = Vec::new();
    let mut algum_ok = false;

    // 1) Pessoas relevantes do usuario (contatos, colegas com quem troca e-mail).
    let url = format!(
        "{GRAPH}/me/people?$search=\"{enc}\"&$top=8&$select=displayName,scoredEmailAddresses,jobTitle"
    );
    match client.get(&url).bearer_auth(&token).send() {
        Ok(resp) if resp.status().is_success() => {
            algum_ok = true;
            if let Ok(v) = resp.json::<serde_json::Value>() {
                if let Some(items) = v["value"].as_array() {
                    for it in items {
                        let nome = it["displayName"].as_str().unwrap_or("").to_string();
                        let email = it["scoredEmailAddresses"][0]["address"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        resultados.push(Pessoa {
                            nome,
                            email,
                            cargo: cargo_de(it),
                            origem: Some(ORIGEM_CONTATOS.to_string()),
                        });
                    }
                }
            }
        }
        Ok(resp) => log::warn!("[pessoas] /me/people retornou {}", resp.status()),
        Err(e) => log::warn!("[pessoas] /me/people falhou: {e}"),
    }

    // 2) Diretorio da organizacao. $search em /users exige ConsistencyLevel.
    let url = format!(
        "{GRAPH}/users?$search=\"displayName:{enc}\"&$top=8&$select=displayName,mail,userPrincipalName,jobTitle"
    );
    match client
        .get(&url)
        .bearer_auth(&token)
        .header("ConsistencyLevel", "eventual")
        .send()
    {
        Ok(resp) if resp.status().is_success() => {
            algum_ok = true;
            if let Ok(v) = resp.json::<serde_json::Value>() {
                if let Some(items) = v["value"].as_array() {
                    for it in items {
                        let nome = it["displayName"].as_str().unwrap_or("").to_string();
                        let email = it["mail"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .or_else(|| it["userPrincipalName"].as_str())
                            .unwrap_or("")
                            .to_string();
                        resultados.push(Pessoa {
                            nome,
                            email,
                            cargo: cargo_de(it),
                            origem: Some(ORIGEM_ORGANIZACAO.to_string()),
                        });
                    }
                }
            }
        }
        Ok(resp) => log::warn!("[pessoas] /users retornou {}", resp.status()),
        Err(e) => log::warn!("[pessoas] /users falhou: {e}"),
    }

    if !algum_ok {
        return Err("falha ao buscar pessoas".into());
    }

    // Dedupe por e-mail (minusculas), descarta sem e-mail, limita a ~10.
    let mut vistos = std::collections::HashSet::new();
    let mut saida = Vec::new();
    for p in resultados {
        let chave = p.email.trim().to_lowercase();
        if chave.is_empty() || !vistos.insert(chave) {
            continue;
        }
        saida.push(p);
        if saida.len() >= 10 {
            break;
        }
    }
    Ok(saida)
}

/// Envia um e-mail novo (do zero, sem citacao). Guarda em Enviados. Mail.Send.
pub fn cr_enviar_novo(
    store: &TokenStore,
    para: Vec<String>,
    cc: Vec<String>,
    cco: Vec<String>,
    assunto: &str,
    corpo_html: &str,
    anexos: Vec<AnexoUp>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // Mapeia cada e-mail para o formato do Graph, descartando os vazios.
    let recipients = |lista: &[String]| -> Vec<serde_json::Value> {
        lista
            .iter()
            .filter(|e| !e.trim().is_empty())
            .map(|e| serde_json::json!({ "emailAddress": { "address": e.trim() } }))
            .collect()
    };

    // Anexos direto no sendMail (fileAttachment); sem arquivo, campo omitido.
    let anexos_json: Vec<serde_json::Value> = anexos
        .iter()
        .filter(|a| !a.conteudo_b64.trim().is_empty())
        .map(anexo_json)
        .collect();

    let mut message = serde_json::json!({
        "subject": assunto,
        "body": { "contentType": "HTML", "content": corpo_html },
        "toRecipients": recipients(&para),
        "ccRecipients": recipients(&cc),
        "bccRecipients": recipients(&cco),
    });
    if !anexos_json.is_empty() {
        message["attachments"] = serde_json::Value::Array(anexos_json);
    }

    let body = serde_json::json!({
        "message": message,
        "saveToSentItems": true
    });

    let resp = client
        .post(format!("{GRAPH}/me/sendMail"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .map_err(|e| format!("falha ao enviar o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("envio retornou {}", resp.status()));
    }
    Ok(())
}

/// Salva os contatos informados na pasta pessoal do usuario, sem duplicar.
/// Retorna quantos foram efetivamente criados. Contacts.ReadWrite.
pub fn cr_salvar_contatos(store: &TokenStore, pessoas: Vec<Pessoa>) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let mut criados: u64 = 0;
    for p in pessoas {
        let email = p.email.trim();
        if email.is_empty() {
            continue;
        }

        // Ja existe um contato com este e-mail? (as aspas fazem parte do filtro
        // OData; aspa simples no valor escapa dobrando — escape correto do OData).
        let email_odata = email.replace('\'', "''");
        let filtro = format!("emailAddresses/any(a:a/address eq '{email_odata}')");
        let url = format!(
            "{GRAPH}/me/contacts?$filter={}&$top=1",
            urlencoding::encode(&filtro)
        );
        let existe = match client.get(&url).bearer_auth(&token).send() {
            Ok(resp) if resp.status().is_success() => resp
                .json::<serde_json::Value>()
                .ok()
                .and_then(|v| v["value"].as_array().map(|a| !a.is_empty()))
                .unwrap_or(false),
            Ok(resp) => {
                log::warn!("[contatos] filtro '{email}' retornou {}", resp.status());
                // Nao da pra ter certeza: pula para nao arriscar duplicar.
                true
            }
            Err(e) => {
                log::warn!("[contatos] filtro '{email}' falhou: {e}");
                true
            }
        };
        if existe {
            continue;
        }

        let nome = if p.nome.trim().is_empty() { email } else { p.nome.trim() };
        let body = serde_json::json!({
            "givenName": nome,
            "emailAddresses": [{ "address": email, "name": p.nome.trim() }]
        });
        match client
            .post(format!("{GRAPH}/me/contacts"))
            .bearer_auth(&token)
            .json(&body)
            .send()
        {
            Ok(resp) if resp.status().is_success() => criados += 1,
            Ok(resp) => log::warn!("[contatos] criar '{email}' retornou {}", resp.status()),
            Err(e) => log::warn!("[contatos] criar '{email}' falhou: {e}"),
        }
    }
    Ok(criados)
}

/// Subpastas de uma pasta de e-mail. O id do filho serve direto no endpoint de
/// mensagens, entao o caminho existente de carga funciona sem mudanca. Mail.Read.
pub fn cr_subpastas(store: &TokenStore, folder_id: &str) -> Result<Vec<PastaEmail>, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    let url = format!(
        "{GRAPH}/me/mailFolders/{folder_id}/childFolders\
         ?$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount&$top=50"
    );
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| format!("falha ao ler as subpastas: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/mailFolders/childFolders retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut pastas = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            pastas.push(PastaEmail {
                id: it["id"].as_str().unwrap_or("").to_string(),
                tipo: "child".to_string(),
                nome: it["displayName"].as_str().unwrap_or("").to_string(),
                nao_lidos: it["unreadItemCount"].as_u64().unwrap_or(0),
                total: it["totalItemCount"].as_u64().unwrap_or(0),
                filhos: it["childFolderCount"].as_u64().unwrap_or(0),
            });
        }
    }
    Ok(pastas)
}

/// Conta, na PASTA inteira (não só no que está carregado), quantas mensagens
/// batem com um filtro. Usa o endpoint /$count, que devolve um número puro
/// (texto) no corpo — daí o parse para u64. O $filter exige o header
/// ConsistencyLevel: eventual. Retry no 429. Mail.Read.
///
/// `filtro` aceita:
///   - "flagged" → mensagens sinalizadas (flag/flagStatus eq 'flagged')
///   - "anexos"  → mensagens com anexos (hasAttachments eq true)
/// Qualquer outro valor é rejeitado com erro (em vez de contar tudo em
/// silêncio, o que enganaria a UI): assim um filtro digitado errado aparece
/// como falha em vez de virar um total sem sentido.
pub fn cr_contar(store: &TokenStore, folder_id: &str, filtro: &str) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // Mapeia o filtro lógico para a expressão OData. Desconhecido → erro.
    let odata = match filtro {
        "flagged" => "flag/flagStatus eq 'flagged'",
        "anexos" => "hasAttachments eq true",
        outro => return Err(format!("filtro desconhecido: '{outro}'")),
    };

    // O $filter vai percent-encodado; o /$count devolve o total como texto puro.
    let url = format!(
        "{GRAPH}/me/mailFolders/{folder_id}/messages/$count?$filter={}",
        urlencoding::encode(odata)
    );

    // Sob o pool + retry central (#64): Retry-After + jitter. Contadores são a
    // parte da rajada de abertura que mais tomava 429. O /$count com $filter
    // exige ConsistencyLevel: eventual.
    let resp = graph_enviar("mail:contar", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("ConsistencyLevel", "eventual")
            .send()
    })
    .map_err(|e| format!("falha ao contar: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "/me/mailFolders/{folder_id}/messages/$count retornou {}",
            resp.status()
        ));
    }
    let corpo = resp.text().map_err(|e| e.to_string())?;
    corpo
        .trim()
        .parse::<u64>()
        .map_err(|e| format!("resposta do /$count não é um número ('{corpo}'): {e}"))
}

// ---------------------------------------------------------------------------
// Testes do throttling (#64) — evidência de QA.
//
// Este item é puramente técnico: o AC ("sob throttling a lista/agenda ainda
// carregam") não é observável na UI sem provocar um 429 real do tenant. Então a
// prova é aqui: exercitamos o pool e o backoff SEM REDE, com números.
//
// Rodar: cargo test --lib graph::testes_throttling -- --nocapture
// ---------------------------------------------------------------------------
#[cfg(test)]
mod testes_throttling {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
    use std::sync::{mpsc, Arc, Barrier, Mutex, MutexGuard};
    use std::thread;
    use std::time::{Duration, Instant};

    /// O pool (`LIMITADOR`) é um `static` global compartilhado; o cargo test roda
    /// os testes em paralelo. Sem esta trava, dois testes de concorrência
    /// disputariam as MESMAS 4 vagas e o pico medido seria dos dois somados.
    static TRAVA_POOL: Mutex<()> = Mutex::new(());

    fn trava_pool() -> MutexGuard<'static, ()> {
        let g = TRAVA_POOL.lock().unwrap_or_else(|e| e.into_inner());
        // Sanidade: todo teste começa com o pool cheio. Se falhar aqui, algum
        // teste anterior VAZOU vaga (é exatamente o bug que o Drop RAII evita).
        assert_eq!(
            vagas_livres(),
            GRAPH_MAX_CONCORRENTES,
            "pool nao voltou ao estado inicial: vagas vazaram"
        );
        g
    }

    fn vagas_livres() -> usize {
        *LIMITADOR.vagas.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Medidor de "requisições em voo": conta simultâneos e guarda o pico.
    #[derive(Default)]
    struct EmVoo {
        atual: AtomicUsize,
        pico: AtomicUsize,
    }
    impl EmVoo {
        fn entrar(&self) {
            let n = self.atual.fetch_add(1, SeqCst) + 1;
            self.pico.fetch_max(n, SeqCst);
        }
        fn sair(&self) {
            self.atual.fetch_sub(1, SeqCst);
        }
        fn pico(&self) -> usize {
            self.pico.load(SeqCst)
        }
    }

    /// Resposta forjada: implementa só o que o laço de retry enxerga, então dá
    /// pra dirigir `executar_com_pool` sem tocar na rede.
    struct RespostaFake {
        status: u16,
        retry_after: Option<u64>,
    }
    impl RespostaFake {
        fn ok() -> Self {
            RespostaFake { status: 200, retry_after: None }
        }
        fn throttled(retry_after_s: Option<u64>) -> Self {
            RespostaFake { status: 429, retry_after: retry_after_s }
        }
    }
    impl RespostaThrottling for RespostaFake {
        fn status_u16(&self) -> u16 {
            self.status
        }
        fn retry_after_s(&self) -> Option<u64> {
            self.retry_after
        }
    }

    // -----------------------------------------------------------------------
    // 1. POOL DE CONCORRÊNCIA
    // -----------------------------------------------------------------------

    /// AC: "as chamadas Graph passam por um pool de concorrência limitado (N
    /// baixo) em vez de dispararem todas de uma vez".
    /// 20 threads largam JUNTAS (barreira) — o pico em voo nunca pode passar de 4.
    #[test]
    fn pool_limita_o_pico_de_requisicoes_em_voo() {
        let _t = trava_pool();
        const THREADS: usize = 20;

        let em_voo = Arc::new(EmVoo::default());
        let largada = Arc::new(Barrier::new(THREADS));
        let inicio = Instant::now();

        let handles: Vec<_> = (0..THREADS)
            .map(|_| {
                let em_voo = Arc::clone(&em_voo);
                let largada = Arc::clone(&largada);
                thread::spawn(move || {
                    largada.wait(); // a "rajada" da carga inicial do Bridge
                    let vaga = adquirir_vaga();
                    em_voo.entrar();
                    thread::sleep(Duration::from_millis(20)); // simula o .send()
                    em_voo.sair();
                    drop(vaga);
                })
            })
            .collect();
        for h in handles {
            h.join().expect("thread do pool entrou em panico");
        }

        let pico = em_voo.pico();
        println!(
            "[QA #64] pool: {THREADS} threads simultaneas, 20ms cada -> PICO EM VOO = {pico} \
             (limite {GRAPH_MAX_CONCORRENTES}); tempo total {:?}",
            inicio.elapsed()
        );
        assert!(
            pico <= GRAPH_MAX_CONCORRENTES,
            "pool furou: {pico} requisicoes em voo (limite {GRAPH_MAX_CONCORRENTES})"
        );
        // Se nunca chegasse a 4, o teste não teria exercitado contenção nenhuma.
        assert_eq!(pico, GRAPH_MAX_CONCORRENTES, "o teste nao saturou o pool - inconclusivo");
        assert_eq!(vagas_livres(), GRAPH_MAX_CONCORRENTES, "vaga vazou no fim");
    }

    /// A vaga é devolvida no `Drop` (RAII): com o pool cheio ninguém entra, e
    /// basta uma devolução para o próximo passar.
    #[test]
    fn pool_bloqueia_quando_cheio_e_libera_no_drop() {
        let _t = trava_pool();
        let mut ocupadas: Vec<Vaga> =
            (0..GRAPH_MAX_CONCORRENTES).map(|_| adquirir_vaga()).collect();
        assert_eq!(vagas_livres(), 0);

        let (tx, rx) = mpsc::channel();
        let h = thread::spawn(move || {
            let v = adquirir_vaga();
            tx.send(()).ok();
            drop(v);
        });

        // Pool cheio -> o 5º NÃO pode entrar.
        assert!(
            rx.recv_timeout(Duration::from_millis(250)).is_err(),
            "entrou uma 5a requisicao com o pool cheio"
        );
        // Devolve UMA vaga -> o 5º tem de passar.
        ocupadas.pop();
        assert!(
            rx.recv_timeout(Duration::from_secs(2)).is_ok(),
            "vaga devolvida no Drop nao acordou quem esperava (Condvar)"
        );
        h.join().unwrap();
        drop(ocupadas);
        println!("[QA #64] RAII: pool cheio bloqueia o 5o; 1 Drop libera exatamente 1 vaga");
        assert_eq!(vagas_livres(), GRAPH_MAX_CONCORRENTES);
    }

    // -----------------------------------------------------------------------
    // 2. LIBERAÇÃO DA VAGA DURANTE O RETRY
    // -----------------------------------------------------------------------

    /// O design segura a vaga SÓ no `.send()`: enquanto a thread dorme o backoff
    /// do 429, a vaga tem de estar no pool para outra chamada progredir.
    /// Prova: ocupa 3 vagas, põe 1 worker (4ª vaga) tomar um 429 com
    /// `Retry-After: 1` (dorme 1000–1500ms) e, no meio desse sono, tenta pegar
    /// vaga. Se o design segurasse a vaga no sleep, isso travaria.
    #[test]
    fn vaga_e_devolvida_enquanto_a_thread_dorme_no_backoff() {
        let _t = trava_pool();
        let ocupadas: Vec<Vaga> =
            (0..GRAPH_MAX_CONCORRENTES - 1).map(|_| adquirir_vaga()).collect();
        assert_eq!(vagas_livres(), 1, "sobrou exatamente 1 vaga para o worker");

        let (tx_429, rx_429) = mpsc::channel();
        let worker = thread::spawn(move || {
            let mut tentativas = 0u32;
            let r: Result<RespostaFake, ()> = executar_com_pool("qa-retry", 5, || {
                tentativas += 1;
                if tentativas == 1 {
                    tx_429.send(Instant::now()).ok();
                    Ok(RespostaFake::throttled(Some(1))) // -> dorme 1000..1500ms
                } else {
                    Ok(RespostaFake::ok())
                }
            });
            assert_eq!(r.unwrap().status_u16(), 200);
            tentativas
        });

        let t429 = rx_429
            .recv_timeout(Duration::from_secs(5))
            .expect("worker nao chegou a receber o 429");

        // Worker está dormindo o backoff. A 4ª vaga TEM de estar livre.
        let (tx_v, rx_v) = mpsc::channel();
        let ladrao = thread::spawn(move || {
            let v = adquirir_vaga();
            tx_v.send(Instant::now()).ok();
            thread::sleep(Duration::from_millis(50));
            drop(v);
        });
        let obtida = rx_v.recv_timeout(Duration::from_millis(400));
        assert!(
            obtida.is_ok(),
            "a vaga NAO foi devolvida durante o backoff: nada entrou em 400ms \
             enquanto o worker dormia ~1000-1500ms"
        );
        println!(
            "[QA #64] liberacao no retry: vaga reaproveitada {:?} apos o 429, \
             com o worker ainda dormindo o backoff (>=1000ms)",
            obtida.unwrap().duration_since(t429)
        );

        ladrao.join().unwrap();
        drop(ocupadas);
        let tentativas = worker.join().expect("worker entrou em panico");
        assert_eq!(tentativas, 2, "esperado 1 retry apos o 429");
        assert_eq!(vagas_livres(), GRAPH_MAX_CONCORRENTES, "vaga vazou no fim");
    }

    /// N (=12) > GRAPH_MAX_CONCORRENTES (=4) threads TODAS em retry ao mesmo
    /// tempo: se a vaga ficasse presa durante o sleep — ou se o Drop vazasse —
    /// isto travaria. Também confere que o pool continua valendo no caminho real
    /// (`executar_com_pool`), não só no `adquirir_vaga` cru.
    #[test]
    fn n_maior_que_o_pool_em_retry_nao_da_deadlock() {
        let _t = trava_pool();
        const THREADS: usize = 12;
        const RETRIES: u32 = 2; // 429, 429, 200

        let em_voo = Arc::new(EmVoo::default());
        let largada = Arc::new(Barrier::new(THREADS));
        let (fim_tx, fim_rx) = mpsc::channel();
        let inicio = Instant::now();

        let supervisor = {
            let em_voo = Arc::clone(&em_voo);
            thread::spawn(move || {
                let handles: Vec<_> = (0..THREADS)
                    .map(|_| {
                        let em_voo = Arc::clone(&em_voo);
                        let largada = Arc::clone(&largada);
                        thread::spawn(move || {
                            largada.wait();
                            let mut tentativas = 0u32;
                            let r: Result<RespostaFake, ()> =
                                executar_com_pool("qa-storm", 0, || {
                                    em_voo.entrar();
                                    thread::sleep(Duration::from_millis(5));
                                    em_voo.sair();
                                    tentativas += 1;
                                    if tentativas <= RETRIES {
                                        // teto_s=0 -> dorme so o jitter (0..500ms)
                                        Ok(RespostaFake::throttled(Some(30)))
                                    } else {
                                        Ok(RespostaFake::ok())
                                    }
                                });
                            (r.unwrap().status_u16(), tentativas)
                        })
                    })
                    .collect();
                let res: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
                fim_tx.send(res).ok();
            })
        };

        let res = fim_rx
            .recv_timeout(Duration::from_secs(60))
            .expect("DEADLOCK: 12 threads em retry nao terminaram em 60s");
        supervisor.join().unwrap();

        let pico = em_voo.pico();
        let total_tentativas: u32 = res.iter().map(|(_, t)| *t).sum();
        println!(
            "[QA #64] storm: {THREADS} threads x {} tentativas = {total_tentativas} chamadas \
             (2x 429 + 1x 200 cada) -> PICO EM VOO = {pico} (limite {GRAPH_MAX_CONCORRENTES}); \
             concluido em {:?}, sem deadlock",
            RETRIES + 1,
            inicio.elapsed()
        );
        assert!(res.iter().all(|(s, t)| *s == 200 && *t == RETRIES + 1), "resultados: {res:?}");
        assert!(pico <= GRAPH_MAX_CONCORRENTES, "pool furou sob retry: pico {pico}");
        assert_eq!(pico, GRAPH_MAX_CONCORRENTES, "nao saturou o pool - inconclusivo");
        assert_eq!(vagas_livres(), GRAPH_MAX_CONCORRENTES, "vaga vazou no fim");
    }

    /// O laço não re-tenta para sempre: para em `GRAPH_MAX_TENTATIVAS` e devolve
    /// o último 429 pro chamador montar o erro (degradação graciosa).
    #[test]
    fn retry_para_no_teto_de_tentativas_e_devolve_o_429() {
        let _t = trava_pool();
        let mut tentativas = 0u8;
        let r: Result<RespostaFake, ()> = executar_com_pool("qa-teto", 0, || {
            tentativas += 1;
            Ok(RespostaFake::throttled(Some(0)))
        });
        assert_eq!(r.unwrap().status_u16(), 429);
        assert_eq!(tentativas, GRAPH_MAX_TENTATIVAS);
        println!(
            "[QA #64] teto: 429 permanente -> {tentativas} tentativas e devolve 429 (sem loop infinito)"
        );
        assert_eq!(vagas_livres(), GRAPH_MAX_CONCORRENTES);
    }

    /// Sucesso de primeira não deve custar retry nenhum nem segurar vaga.
    #[test]
    fn resposta_ok_nao_re_tenta() {
        let _t = trava_pool();
        let mut tentativas = 0u8;
        let r: Result<RespostaFake, ()> = executar_com_pool("qa-ok", 5, || {
            tentativas += 1;
            Ok(RespostaFake::ok())
        });
        assert_eq!(r.unwrap().status_u16(), 200);
        assert_eq!(tentativas, 1);
        assert_eq!(vagas_livres(), GRAPH_MAX_CONCORRENTES);
    }

    // -----------------------------------------------------------------------
    // 3. BACKOFF: Retry-After como piso, teto e jitter
    // -----------------------------------------------------------------------

    fn amostras(retry_after: Option<u64>, tentativa: u8, teto_s: u64, n: usize) -> Vec<u64> {
        (0..n).map(|_| calc_espera_ms(retry_after, tentativa, teto_s)).collect()
    }

    fn faixa(v: &[u64]) -> (u64, u64, u64) {
        let min = *v.iter().min().unwrap();
        let max = *v.iter().max().unwrap();
        let media = v.iter().sum::<u64>() / v.len() as u64;
        (min, media, max)
    }

    /// AC: "o app respeita o `Retry-After` (dorme o tempo pedido, com teto)".
    /// O valor pedido é PISO: nunca dormimos menos do que o servidor mandou.
    #[test]
    fn retry_after_e_respeitado_como_piso() {
        for pedido_s in [1u64, 2, 3, 5, 10] {
            let v = amostras(Some(pedido_s), 0, GRAPH_TETO_ESPERA_S, 500);
            let (min, media, max) = faixa(&v);
            let piso = pedido_s * 1000;
            println!(
                "[QA #64] Retry-After: {pedido_s}s -> espera min={min}ms media={media}ms \
                 max={max}ms (piso {piso}ms, jitter +0..{GRAPH_JITTER_RETRY_AFTER_MS}ms)"
            );
            assert!(min >= piso, "dormiu MENOS que o Retry-After: {min}ms < {piso}ms");
            assert!(
                max < piso + GRAPH_JITTER_RETRY_AFTER_MS,
                "jitter estourou a janela: {max}ms"
            );
        }
    }

    /// AC: "...com teto sensato" — pedido absurdo do servidor não congela o app.
    #[test]
    fn retry_after_absurdo_e_limitado_pelo_teto() {
        let teto = GRAPH_TETO_ESPERA_S;
        for pedido_s in [60u64, 300, 3600] {
            let v = amostras(Some(pedido_s), 0, teto, 200);
            let (min, _, max) = faixa(&v);
            println!(
                "[QA #64] teto: servidor pediu {pedido_s}s -> dormimos {min}..{max}ms (teto {}ms)",
                teto * 1000
            );
            assert!(min >= teto * 1000, "abaixo do teto: {min}ms");
            assert!(max < teto * 1000 + GRAPH_JITTER_RETRY_AFTER_MS, "acima do teto: {max}ms");
        }
    }

    /// AC: "há jitter no backoff pra não re-sincronizar a rajada".
    /// Com Retry-After fixo, chamadas sucessivas TÊM de divergir.
    #[test]
    fn jitter_dessincroniza_com_retry_after() {
        let v = amostras(Some(2), 0, GRAPH_TETO_ESPERA_S, 500);
        let distintos: std::collections::HashSet<u64> = v.iter().copied().collect();
        let (min, media, max) = faixa(&v);
        println!(
            "[QA #64] jitter (Retry-After 2s, 500 amostras): {} valores distintos, \
             min={min}ms media={media}ms max={max}ms, espalhamento={}ms",
            distintos.len(),
            max - min
        );
        assert!(
            distintos.len() > 100,
            "jitter fraco: so {} valores distintos em 500 amostras",
            distintos.len()
        );
        assert!(max - min > 300, "espalhamento pequeno demais: {}ms", max - min);
    }

    /// Sem `Retry-After` no 429: backoff EXPONENCIAL 2^n, com jitter
    /// multiplicativo delay*(0.5+rand*0.5) -> cada espera cai em [50%,100%] da base.
    #[test]
    fn sem_retry_after_usa_backoff_exponencial_com_jitter() {
        let teto = GRAPH_TETO_ESPERA_S;
        let mut medias = Vec::new();
        for tentativa in 0..GRAPH_MAX_TENTATIVAS {
            let base = (1u64 << tentativa.min(6)).min(teto.max(1)) * 1000;
            let v = amostras(None, tentativa, teto, 500);
            let (min, media, max) = faixa(&v);
            let distintos: std::collections::HashSet<u64> = v.iter().copied().collect();
            println!(
                "[QA #64] backoff s/ Retry-After tentativa {tentativa}: base={base}ms -> \
                 min={min}ms media={media}ms max={max}ms ({} valores distintos)",
                distintos.len()
            );
            assert!(min >= base / 2, "abaixo de 50% da base: {min}ms < {}ms", base / 2);
            assert!(max <= base, "acima de 100% da base: {max}ms > {base}ms");
            assert!(distintos.len() > 100, "jitter fraco na tentativa {tentativa}");
            medias.push(media);
        }
        // Cresce a cada tentativa (até bater o teto).
        for par in medias.windows(2) {
            assert!(par[1] > par[0], "backoff nao cresceu: {medias:?}");
        }
        println!("[QA #64] backoff exponencial (medias por tentativa): {medias:?} ms");
    }

    /// `Retry-After` ausente ou ilegível (ex.: HTTP-date, que o Graph não usa)
    /// não pode virar 0ms nem pânico — cai no backoff exponencial.
    #[test]
    fn retry_after_ausente_ou_ilegivel_cai_no_exponencial() {
        let v = amostras(None, 2, GRAPH_TETO_ESPERA_S, 200);
        let (min, _, max) = faixa(&v);
        assert!(min >= 2000 && max <= 4000, "esperado 2000..4000ms, veio {min}..{max}ms");
        println!("[QA #64] sem Retry-After (tentativa 2): {min}..{max}ms - nunca 0ms");
        assert!(min > 0, "nunca pode ser 0ms (re-tentativa imediata re-sincroniza a rajada)");
    }
}

// ---------------------------------------------------------------------------
// Fotos de contatos internos (#39)
//
// Mostra o avatar (foto de exibição) dos remetentes internos na lista, no
// detalhe e nos participantes de evento. Usa a MESMA técnica do molde de
// `auth::buscar_foto` (bytes → data URI), mas aqui em LOTE via `$batch` do Graph
// (até 20 sub-requisições por chamada) para não disparar 1 request por foto.
//
// Escopo: User.Read.All (admin consent já concedido; ver config::SCOPES). Só faz
// sentido para remetente INTERNO — o filtro por domínio do tenant é do front
// (fotos.ts), que já manda só e-mails internos.
//
// Por foto: 200 = a resposta do $batch traz o binário JÁ em base64 no campo
// `body` (é assim que o $batch serializa corpo binário), então montamos o data
// URI direto, sem decode/encode. 404 = sem foto (None). 403 = sem permissão
// ainda / re-consent pendente (None). O front faz o negative-cache.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FotoContato {
    pub email: String,
    pub foto: Option<String>,
}

/// Resultado de uma sub-requisição de foto no $batch.
enum FotoRes {
    /// 200 com corpo: data URI pronto.
    Data(String),
    /// 404: sem foto nesse endpoint — vale tentar o fallback `/photo/$value`.
    SemFoto,
    /// 403/erro: sem foto e sem tentar fallback (só custaria outro 403).
    Nenhum,
}

/// Fotos (64x64, com fallback pra original) de até 20 contatos internos, em UMA
/// chamada `$batch`. Devolve uma entrada por e-mail (na ordem de entrada, já em
/// minúsculas e sem duplicatas). `User.Read.All`.
pub fn cr_fotos_contatos(
    store: &TokenStore,
    emails: Vec<String>,
) -> Result<Vec<FotoContato>, String> {
    use std::collections::{HashMap, HashSet};

    let token = access_token(store)?;
    let client = reqwest::blocking::Client::new();

    // Normaliza (minúsculas), remove vazios/duplicatas e limita a 20 (teto do
    // $batch). O front já debouncia e manda no máximo 20, mas o teto aqui protege
    // contra chamada malformada.
    let mut vistos = HashSet::new();
    let alvos: Vec<String> = emails
        .into_iter()
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty() && vistos.insert(e.clone()))
        .take(20)
        .collect();
    if alvos.is_empty() {
        return Ok(Vec::new());
    }

    let mut fotos: HashMap<String, Option<String>> = HashMap::new();
    // Passo 1: tamanho reduzido (64x64) — o avatar é pequeno na UI.
    let mut fallback: Vec<String> = Vec::new();
    for (email, res) in batch_fotos(&client, &token, &alvos, "photos/64x64/$value")? {
        match res {
            FotoRes::Data(d) => {
                fotos.insert(email, Some(d));
            }
            FotoRes::SemFoto => fallback.push(email), // 404 → tenta a original
            FotoRes::Nenhum => {
                fotos.insert(email, None);
            }
        }
    }
    // Passo 2 (só pros 404 do passo 1): foto original, sem tamanho fixo.
    if !fallback.is_empty() {
        for (email, res) in batch_fotos(&client, &token, &fallback, "photo/$value")? {
            let foto = match res {
                FotoRes::Data(d) => Some(d),
                _ => None,
            };
            fotos.insert(email, foto);
        }
    }

    Ok(alvos
        .into_iter()
        .map(|email| {
            let foto = fotos.get(&email).cloned().flatten();
            FotoContato { email, foto }
        })
        .collect())
}

/// Uma passada de `$batch`: pede `/users/{email}/{sufixo}` para cada e-mail e
/// devolve (email, resultado). Reusa `graph_enviar` (pool + Retry-After +
/// jitter). O `id` de cada sub-resposta é o índice no slice — o Graph não
/// garante a ordem, então casamos pelo id de volta.
fn batch_fotos(
    client: &reqwest::blocking::Client,
    token: &str,
    emails: &[String],
    sufixo: &str,
) -> Result<Vec<(String, FotoRes)>, String> {
    let requests: Vec<serde_json::Value> = emails
        .iter()
        .enumerate()
        .map(|(i, email)| {
            serde_json::json!({
                "id": i.to_string(),
                "method": "GET",
                "url": format!("/users/{}/{}", urlencoding::encode(email), sufixo),
            })
        })
        .collect();
    let body = serde_json::json!({ "requests": requests });
    let url = format!("{GRAPH}/$batch");

    let resp = graph_enviar("fotos", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(token).json(&body).send()
    })
    .map_err(|e| format!("falha ao buscar fotos: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/$batch retornou {}", resp.status()));
    }

    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(items) = v["responses"].as_array() {
        for it in items {
            let idx: usize = it["id"].as_str().and_then(|s| s.parse().ok()).unwrap_or(usize::MAX);
            let email = match emails.get(idx) {
                Some(e) => e.clone(),
                None => continue,
            };
            let status = it["status"].as_u64().unwrap_or(0);
            let res = if status == 200 {
                // O corpo binário vem base64 no próprio JSON do $batch. O
                // content-type pode vir com capitalização variada.
                let mime = it["headers"]["Content-Type"]
                    .as_str()
                    .or_else(|| it["headers"]["content-type"].as_str())
                    .unwrap_or("image/jpeg");
                let mime = mime.split(';').next().unwrap_or("image/jpeg").trim();
                match it["body"].as_str() {
                    Some(b64) if !b64.is_empty() => {
                        FotoRes::Data(format!("data:{mime};base64,{b64}"))
                    }
                    _ => FotoRes::SemFoto,
                }
            } else if status == 404 {
                FotoRes::SemFoto
            } else {
                // 403 (sem permissão / re-consent pendente) e outros: None.
                FotoRes::Nenhum
            };
            out.push((email, res));
        }
    }
    Ok(out)
}
