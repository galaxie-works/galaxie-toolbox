//! Chamadas ao Microsoft Graph: descobrir os sites que o usuario acessa e
//! criar o atalho ("Add shortcut to OneDrive") apontando pra biblioteca do
//! site. Usa o payload validado na migracao: remoteItem.sharepointIds com
//! listItemUniqueId="root" e conflictBehavior=fail (409 = ja existe).

use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::{refresh, TokenStore};


const GRAPH: &str = "https://graph.microsoft.com/v1.0";
/// Alguns settings org-wide (#425: appsAndServices, forms) só existem no beta do
/// Graph; o M365 Install já é v1.0. Ver `cr_org_settings`.
const GRAPH_BETA: &str = "https://graph.microsoft.com/beta";

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

/// Teto para ESTABELECER a conexão (TCP+TLS). Nenhum connect legítimo ao Graph
/// leva tanto; o que passa disso é conexão pendurada — e pendurada é o caso
/// grave, porque ela segura uma das 4 vagas de `GRAPH_MAX_CONCORRENTES` sem
/// nunca falhar. Com 4 penduradas, TODO o tráfego Graph do app para, sem erro.
const GRAPH_CONNECT_TIMEOUT_S: u64 = 10;

/// Teto TOTAL de uma requisição Graph.
///
/// ⚠️ É um LIMITE, não uma medição: ninguém mediu a cauda real de download de
/// anexo grande. Escolhido folgado de propósito, porque o erro caro aqui é
/// apertar demais e quebrar em silêncio um anexo que funcionava. Operação que
/// legitimamente demore mais deve sobrescrever POR REQUISIÇÃO
/// (`RequestBuilder::timeout`), não afrouxar este default.
const GRAPH_TIMEOUT_TOTAL_S: u64 = 120;

/// Client HTTP único do Graph (#1074 RB44).
///
/// Eram **87** `reqwest::blocking::Client::new()` espalhados, **nenhum** com
/// timeout. Cada `new()` monta o próprio pool de conexão, então o app nem
/// reaproveitava conexão TLS entre chamadas — e, sem timeout, uma conexão que
/// pendura fica pendurada para sempre.
///
/// `Client` é barato de clonar (é `Arc` por dentro) e é `Send + Sync`, então um
/// único `OnceLock` serve todas as chamadas — mesmo padrão do `POOL` do
/// `fs_explorer.rs`.
fn cliente() -> &'static reqwest::blocking::Client {
    static CLIENT: std::sync::OnceLock<reqwest::blocking::Client> =
        std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(GRAPH_CONNECT_TIMEOUT_S))
            .timeout(std::time::Duration::from_secs(GRAPH_TIMEOUT_TOTAL_S))
            .build()
            // Só falha se o backend TLS não subir; aí não há Graph nenhum e um
            // client sem timeout é melhor que derrubar o app no boot.
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    })
}

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

// ---------------------------------------------------------------------------
// Single-flight + cache de TTL curto por operação (#440 A1)
//
// O pool acima corta a rajada e re-tenta 429, mas NÃO impede que a MESMA leitura
// seja disparada duas vezes quase junto — o boot do Atoms e o keep-alive do
// Bridge pedem agenda/e-mail no mesmo instante. Aqui coalescemos chamadas
// idênticas concorrentes e reusamos um resultado fresco (janela curta), matando
// o "thundering herd" na ORIGEM. Só resultado Ok é cacheado; um Err re-executa na
// próxima chamada (o Retry PRECISA funcionar). Escritas invalidam a chave via
// `memo_invalidar` para o próximo read trazer dado fresco.
// ---------------------------------------------------------------------------

/// Janela de reuso do memo. Curta de propósito: cobre o pico do boot (tudo nos
/// primeiros ~1-2s) sem servir dado velho — e as escritas invalidam explicitamente.
const MEMO_TTL_MS: u64 = 2500;

/// Teto de chaves no mapa de memo. Backstop contra crescimento: chaves de agenda
/// carregam a janela (bucketizada por minuto), então sessões longas acumulam uma
/// entrada por minuto navegado. Ao estourar, limpamos o mapa inteiro (raro; quem
/// está no meio de uma chamada segura seu próprio Arc e não é afetado).
const MEMO_MAX_CHAVES: usize = 128;

/// Trunca um ISO 8601 ("2026-08-03T10:23:45.123Z") no minuto ("2026-08-03T10:23")
/// pra usar como CHAVE de memo. Sem isso, `toISOString()` (precisão de ms) geraria
/// uma chave nova a cada chamada → o coalescing de agenda nunca casaria (Atoms vs.
/// Bridge no mesmo segundo) e o mapa cresceria a cada mount. O minuto coalesce o
/// boot (sub-segundo) e mantém o mapa enxuto; a frescura segue governada pelo TTL.
fn chave_por_minuto(iso: &str) -> &str {
    iso.get(..16).unwrap_or(iso)
}

struct FatiaMemo {
    /// O Mutex serializa chamadas da MESMA chave → single-flight: a 2ª chamada
    /// concorrente espera a 1ª e reusa o resultado em vez de refazer a rede.
    /// Chaves diferentes usam fatias diferentes e não se bloqueiam.
    dado: std::sync::Mutex<Option<(u64, std::sync::Arc<dyn std::any::Any + Send + Sync>)>>,
}

fn memo_mapa(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<FatiaMemo>>> {
    static MEMO: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<FatiaMemo>>>,
    > = std::sync::OnceLock::new();
    MEMO.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn agora_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Executa `calc` sob single-flight + cache de TTL curto na `chave`. `T` precisa
/// ser clonável e `'static` (guardado type-erased via `Any` e clonado na volta).
/// Só sucesso é cacheado — um erro re-executa na próxima chamada.
fn com_memo_curto<T, F>(chave: &str, calc: F) -> Result<T, String>
where
    T: Clone + Send + Sync + 'static,
    F: FnOnce() -> Result<T, String>,
{
    let fatia = {
        let mut m = memo_mapa().lock().unwrap_or_else(|e| e.into_inner());
        // Backstop de crescimento: se estourou o teto e esta é uma chave nova,
        // limpa o mapa antes de inserir (chamadas em voo seguram o próprio Arc).
        if m.len() >= MEMO_MAX_CHAVES && !m.contains_key(chave) {
            m.clear();
        }
        m.entry(chave.to_string())
            .or_insert_with(|| {
                std::sync::Arc::new(FatiaMemo { dado: std::sync::Mutex::new(None) })
            })
            .clone()
    };
    // Trava da fatia: enquanto a 1ª chamada busca, a 2ª espera aqui e, ao entrar,
    // encontra o resultado fresco — coalesce sem refazer a rede.
    let mut guard = fatia.dado.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((quando, val)) = guard.as_ref() {
        if agora_ms().saturating_sub(*quando) < MEMO_TTL_MS {
            if let Ok(tipado) = val.clone().downcast::<T>() {
                return Ok((*tipado).clone());
            }
        }
    }
    let resultado = calc()?;
    *guard = Some((agora_ms(), std::sync::Arc::new(resultado.clone())));
    Ok(resultado)
}

/// Invalida toda entrada de memo cuja chave começa com `prefixo`. Chamado pelas
/// escritas (criar/editar/excluir evento → "agenda:"; concluir tarefa →
/// "tarefas:") para o próximo read trazer dado fresco em vez do cacheado.
fn memo_invalidar(prefixo: &str) {
    let mut m = memo_mapa().lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|k, _| !k.starts_with(prefixo));
}

/// #555 (P0): zera TODO o memo curto (chaveado por email:atoms/tarefas/agenda,
/// SEM discriminador de conta) na troca de conta — senão a conta nova pega, na
/// janela de 2,5s, o batch memoizado da conta anterior. Chamado no reset de sessão.
pub fn limpar_memo_sessao() {
    memo_invalidar("");
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
/// costumam aparecer. #1076 (RB48/LGPD): loga só a CONTAGEM agregada — nunca os
/// NOMES dos itens do OneDrive (podem ser nome de cliente/projeto = PII).
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
                            // #1076 (RB48): NÃO logar o nome do item (PII); só coletar
                            // o siteId e contar.
                            if let Some(sid) =
                                it["remoteItem"]["sharepointIds"]["siteId"].as_str()
                            {
                                com_remote += 1;
                                out.push(sid.to_string());
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

/// Lista os sites do tenant que o usuario enxerga (delegado), com status.
pub fn list_sites(store: &TokenStore) -> Result<Vec<SiteDto>, String> {
    let token = access_token(store)?;
    let client = cliente();
    // #1073 (RB38): a sonda de diagnóstico `sondar_atalhos` foi REMOVIDA — rodava em
    // produção a cada `list_sites` (3 GETs extras fora do pool + logava nomes de
    // arquivo do usuário). Nada mais depende dela.

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
    let client = cliente();

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
    let client = cliente();

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

    let client = cliente();
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
    let client = cliente();

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
    let client = cliente();
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
    let client = cliente();
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
    let client = cliente();

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

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailRecente {
    pub assunto: String,
    pub de: String,
    pub recebido: String,
}

#[derive(serde::Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaixaEntrada {
    pub nao_lidos: u64,
    pub recentes: Vec<EmailRecente>,
}

/// E-mail do dashboard Atoms (#440 A1): não-lidos + sinalizados + recentes num
/// ÚNICO `$batch` sob o pool — 1 request, 1 caminho de erro. Substitui o
/// `Promise.all([cr_email, cr_contadores])` do front, que acoplava duas chamadas
/// de resiliência diferente e derrubava o widget inteiro quando só o contador
/// falhava (#187). Memoizado (single-flight + TTL curto) pra não competir com o
/// Bridge no boot. Só o não-lido é sinal-chave (propaga erro); sinalizados e
/// recentes degradam graciosamente. Mail.Read.
#[derive(serde::Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AtomsEmail {
    pub nao_lidos: u64,
    pub sinalizados: u64,
    pub recentes: Vec<EmailRecente>,
}

pub fn atoms_email(store: &TokenStore) -> Result<AtomsEmail, String> {
    com_memo_curto("email:atoms", || atoms_email_inner(store))
}

fn atoms_email_inner(store: &TokenStore) -> Result<AtomsEmail, String> {
    let token = access_token(store)?;
    let client = cliente();

    let requests = serde_json::json!({
        "requests": [
            {
                "id": "naoLidos",
                "method": "GET",
                "url": "/me/mailFolders/inbox?$select=unreadItemCount"
            },
            {
                "id": "sinalizados",
                "method": "GET",
                "url": format!(
                    "/me/mailFolders/inbox/messages/$count?$filter={}",
                    urlencoding::encode("flag/flagStatus eq 'flagged'")
                ),
                "headers": { "ConsistencyLevel": "eventual" }
            },
            {
                "id": "recentes",
                "method": "GET",
                "url": "/me/mailFolders/inbox/messages?$filter=isRead eq false&$select=subject,from,receivedDateTime&$top=5&$orderby=receivedDateTime desc"
            }
        ]
    });
    let url = format!("{GRAPH}/$batch");
    let resp = graph_enviar("atoms:email", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&requests).send()
    })
    .map_err(|e| format!("falha no e-mail do Atoms: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        log::warn!("[atoms:email] $batch retornou {st}");
        return Err(format!("/$batch (atoms:email) retornou {st}"));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    atoms_email_de_batch(&v)
}

/// Extrai `AtomsEmail` do JSON de resposta do `$batch` — lógica PURA (sem rede),
/// exercitada em teste. Casa cada sub-resposta pelo `id` (o Graph não garante a
/// ordem). O não-lido é o sinal-chave: se a sub-resposta dele não for 200, a
/// função inteira falha (AC4 — nada de "0 não-lidos" mentiroso). Sinalizados e
/// recentes que falharem caem no default (degradação graciosa).
fn atoms_email_de_batch(v: &serde_json::Value) -> Result<AtomsEmail, String> {
    let mut out = AtomsEmail::default();
    let mut viu_nao_lidos = false;
    if let Some(items) = v["responses"].as_array() {
        for it in items {
            let id = it["id"].as_str().unwrap_or("");
            let status = it["status"].as_u64().unwrap_or(0);
            match id {
                "naoLidos" => {
                    if status != 200 {
                        return Err(format!("sub-resposta naoLidos: status {status}"));
                    }
                    out.nao_lidos = it["body"]["unreadItemCount"].as_u64().unwrap_or(0);
                    viu_nao_lidos = true;
                }
                "sinalizados" if status == 200 => {
                    out.sinalizados = it["body"]
                        .as_u64()
                        .or_else(|| it["body"].as_str().and_then(|s| s.trim().parse().ok()))
                        .unwrap_or(0);
                }
                "recentes" if status == 200 => {
                    if let Some(msgs) = it["body"]["value"].as_array() {
                        for m in msgs {
                            out.recentes.push(EmailRecente {
                                assunto: m["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
                                de: m["from"]["emailAddress"]["name"]
                                    .as_str()
                                    .or_else(|| m["from"]["emailAddress"]["address"].as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                recebido: m["receivedDateTime"].as_str().unwrap_or("").to_string(),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if !viu_nao_lidos {
        return Err("resposta do $batch sem a sub-resposta naoLidos".to_string());
    }
    Ok(out)
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tarefa {
    pub titulo: String,
    pub lista: String,
    // #184 (Atoms S2): ids pra concluir in-place + prazo pro score de atenção.
    pub id: String,
    pub lista_id: String,
    pub prazo: Option<String>,
}

/// Tarefas pendentes do To Do (todas as listas, ate 8). Tasks.ReadWrite.
///
/// #440 (A1): AGORA cada request passa pelo pool (`graph_enviar` — retry/429),
/// e o resultado é memoizado (single-flight + TTL curto) pra não repetir a
/// varredura de listas no boot. Era a causa do "Couldn't load" em Tasks: a
/// chamada crua estourava 429 e o `Err` no 1º 429 derrubava o widget, com o
/// Retry re-chamando a MESMA função desprotegida (#184).
pub fn cr_tarefas(store: &TokenStore) -> Result<Vec<Tarefa>, String> {
    com_memo_curto("tarefas:atoms", || cr_tarefas_inner(store))
}

fn cr_tarefas_inner(store: &TokenStore) -> Result<Vec<Tarefa>, String> {
    let token = access_token(store)?;
    let client = cliente();

    // 1) listas
    let url = format!("{GRAPH}/me/todo/lists?$select=id,displayName&$top=50");
    let resp = graph_enviar("todo:listas", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler as listas: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        log::warn!("[todo:listas] Graph retornou {st}");
        return Err(format!("/me/todo/lists retornou {st}"));
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
                 &$select=id,title,dueDateTime&$top=8"
            );
            if let Ok(r) = graph_enviar("todo:tarefas", GRAPH_TETO_ESPERA_S, || {
                client.get(&url).bearer_auth(&token).send()
            }) {
                if r.status().is_success() {
                    if let Ok(vt) = r.json::<serde_json::Value>() {
                        if let Some(items) = vt["value"].as_array() {
                            for it in items {
                                if tarefas.len() >= 8 {
                                    break;
                                }
                                // dueDateTime é objeto { dateTime, timeZone } no Graph.
                                let prazo = it["dueDateTime"]["dateTime"]
                                    .as_str()
                                    .map(|s| s.to_string());
                                tarefas.push(Tarefa {
                                    titulo: it["title"].as_str().unwrap_or("").to_string(),
                                    lista: nome.clone(),
                                    id: it["id"].as_str().unwrap_or("").to_string(),
                                    lista_id: id.to_string(),
                                    prazo,
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

/// Conclui uma tarefa do To Do (#184, Atoms S2): PATCH status=completed em
/// /me/todo/lists/{lista}/tasks/{id}. Tasks.ReadWrite (já concedido).
pub fn cr_tarefa_concluir(
    store: &TokenStore,
    lista_id: &str,
    tarefa_id: &str,
) -> Result<(), String> {
    let lista_id = lista_id.trim();
    let tarefa_id = tarefa_id.trim();
    if lista_id.is_empty() || tarefa_id.is_empty() {
        return Err("Invalid task.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/me/todo/lists/{}/tasks/{}",
        urlencoding::encode(lista_id),
        urlencoding::encode(tarefa_id)
    );
    let body = serde_json::json!({ "status": "completed" });
    let resp = graph_enviar("todo:concluir", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("Failed to complete task: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("To Do: Graph returned {}", resp.status()));
    }
    // #440: a lista de tarefas mudou — invalida o memo pra o próximo read do
    // dashboard não trazer a tarefa concluída de volta do cache.
    memo_invalidar("tarefas:");
    Ok(())
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

#[derive(serde::Serialize, Clone)]
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
    /// Semântica do convite (#287): `responseStatus.response` do Graph —
    /// `none` · `organizer` · `tentativelyAccepted` · `accepted` · `declined`
    /// · `notResponded`. A UI usa isso para renderizar o estado (RSVP) e para
    /// ocultar/riscar os recusados.
    pub resposta: String,
    /// True quando o usuário organiza o evento (Graph `isOrganizer`) — sem RSVP.
    pub sou_organizador: bool,
    /// E-mail do organizador (Graph `organizer.emailAddress.address`). Aditivo
    /// (#570): habilita o avatar do organizador no chip (day/week). Igual ao
    /// #515 P2, mas no list-item.
    pub organizador_email: String,
    /// Graph `responseRequested`: false = convite informativo (sem pedir RSVP).
    pub resposta_solicitada: bool,
    /// Graph `type` (#397): "singleInstance" | "occurrence" | "exception" |
    /// "seriesMaster". Occurrence/exception/seriesMaster = recorrente.
    pub tipo: String,
    /// Graph `seriesMasterId` (#397): id da série mãe (só p/ ocorrências/exceções).
    pub series_master_id: Option<String>,
}

/// Parseia a resposta de um `calendarView` (lista `value[]`) em EventoAgenda.
/// Compartilhado entre /me/calendarView (padrão) e
/// /me/calendars/{id}/calendarView (por calendário — #233).
fn parse_eventos(v: &serde_json::Value) -> Vec<EventoAgenda> {
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
                // Semântica do convite (#287). `isOrganizer` também vem como
                // `response: "organizer"`, mas mantemos ambos para a UI decidir.
                resposta: it["responseStatus"]["response"]
                    .as_str()
                    .unwrap_or("none")
                    .to_string(),
                sou_organizador: it["isOrganizer"].as_bool().unwrap_or(false),
                organizador_email: it["organizer"]["emailAddress"]["address"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .to_string(),
                resposta_solicitada: it["responseRequested"].as_bool().unwrap_or(true),
                tipo: it["type"].as_str().unwrap_or("singleInstance").to_string(),
                series_master_id: it["seriesMasterId"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string()),
            });
        }
    }
    eventos
}

/// Busca + parseia um calendarView a partir de uma URL já montada. Fica sob o
/// mesmo pool + retry central (#64) — respeita Retry-After e usa jitter. O
/// calendarView era a única chamada sem retry, e um 429 transitório derrubava a
/// agenda até um F5 no app inteiro (#41).
fn buscar_calendar_view(store: &TokenStore, url: &str) -> Result<Vec<EventoAgenda>, String> {
    let token = access_token(store)?;
    let client = cliente();
    let resp = graph_enviar("agenda", GRAPH_TETO_ESPERA_S, || {
        client
            .get(url)
            .bearer_auth(&token)
            .header("Prefer", "outlook.timezone=\"UTC\"")
            .send()
    })
    .map_err(|e| format!("falha no calendario: {e}"))?;
    let st = resp.status();
    if !st.is_success() {
        return Err(format!("calendarView retornou {st}"));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(parse_eventos(&v))
}

const AGENDA_SELECT: &str = "id,subject,start,end,location,isAllDay,onlineMeeting,attendees,hasAttachments,categories,responseStatus,isOrganizer,organizer,responseRequested,type,seriesMasterId";

/// Eventos do calendário padrão no intervalo (limites em ISO UTC). Calendars.Read.
///
/// #440 (A1): memoizado (single-flight + TTL curto, chave "agenda:") — o boot do
/// Atoms e o keep-alive do Bridge pedem a MESMA janela quase juntos; coalescer
/// evita a duplicata no mesmo segundo (AC3). Escritas invalidam "agenda:".
pub fn cr_agenda(
    store: &TokenStore,
    inicio: &str,
    fim: &str,
    mailbox: Option<&str>,
) -> Result<Vec<EventoAgenda>, String> {
    // #495: caixa própria = /me, caixa compartilhada = /users/{addr}. O prefixo
    // entra TAMBÉM na chave do memo curto — sem isso, os eventos de uma caixa
    // vazariam pra outra (isolamento estilo Cruiser).
    let prefix = mailbox_prefix(mailbox);
    let url = format!(
        "{GRAPH}/{prefix}/calendarView?startDateTime={inicio}&endDateTime={fim}\
         &$select={AGENDA_SELECT}&$orderby=start/dateTime&$top=100"
    );
    com_memo_curto(
        &format!(
            "agenda:{prefix}:default:{}:{}",
            chave_por_minuto(inicio),
            chave_por_minuto(fim)
        ),
        || buscar_calendar_view(store, &url),
    )
}

/// Eventos de um calendário específico no intervalo (#233). Mesmo parse/pool do
/// calendário padrão, mas via /me/calendars/{id}/calendarView. Calendars.Read.
pub fn cr_agenda_calendario(
    store: &TokenStore,
    calendario_id: &str,
    inicio: &str,
    fim: &str,
    mailbox: Option<&str>,
) -> Result<Vec<EventoAgenda>, String> {
    // #495: caixa própria = /me, caixa compartilhada = /users/{addr}. Prefixo na
    // chave do memo pra não vazar eventos entre caixas.
    let prefix = mailbox_prefix(mailbox);
    let url = format!(
        "{GRAPH}/{prefix}/calendars/{calendario_id}/calendarView?startDateTime={inicio}&endDateTime={fim}\
         &$select={AGENDA_SELECT}&$orderby=start/dateTime&$top=100"
    );
    com_memo_curto(
        &format!(
            "agenda:{prefix}:{calendario_id}:{}:{}",
            chave_por_minuto(inicio),
            chave_por_minuto(fim)
        ),
        || buscar_calendar_view(store, &url),
    )
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendario {
    pub id: String,
    pub nome: String,
    pub cor: String, // hex (#RRGGBB)
    pub is_default_calendar: bool,
    pub can_edit: bool,
}

/// Mapeia o enum de cor de calendário do Graph (CalendarColor) para um hex.
/// Usado quando o calendário não tem `hexColor` custom preenchido.
fn cor_calendario_para_hex(cor: &str) -> &'static str {
    match cor {
        "lightBlue" => "#0078D4",
        "lightGreen" => "#498205",
        "lightOrange" => "#FF8C00",
        "lightGray" => "#8A8886",
        "lightYellow" => "#EAA300",
        "lightTeal" => "#00B7C3",
        "lightPink" => "#E3008C",
        "lightBrown" => "#7A4B00",
        "lightRed" => "#D13438",
        // "auto", "maxColor" ou desconhecido: azul padrão do Outlook.
        _ => "#0078D4",
    }
}

/// Lista os calendários do usuário (GET /me/calendars). Calendars.Read. Fica sob
/// o mesmo pool + retry central (#64) das demais chamadas.
pub fn cr_calendarios(
    store: &TokenStore,
    mailbox: Option<&str>,
) -> Result<Vec<Calendario>, String> {
    let token = access_token(store)?;
    let client = cliente();

    // #495: caixa própria = /me, caixa compartilhada = /users/{addr}.
    let prefix = mailbox_prefix(mailbox);
    let url = format!(
        "{GRAPH}/{prefix}/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit&$top=100"
    );
    let resp = graph_enviar("calendarios", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao listar os calendarios: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me/calendars retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut calendarios = Vec::new();
    if let Some(items) = v["value"].as_array() {
        for it in items {
            // hexColor vem preenchido quando o calendário tem cor custom; senão
            // caímos no enum `color` (CalendarColor) mapeado para hex.
            let hex = it["hexColor"].as_str().unwrap_or("");
            let cor = if hex.starts_with('#') && hex.len() >= 4 {
                hex.to_string()
            } else {
                cor_calendario_para_hex(it["color"].as_str().unwrap_or("auto")).to_string()
            };
            calendarios.push(Calendario {
                id: it["id"].as_str().unwrap_or("").to_string(),
                nome: it["name"].as_str().unwrap_or("(sem nome)").to_string(),
                cor,
                is_default_calendar: it["isDefaultCalendar"].as_bool().unwrap_or(false),
                can_edit: it["canEdit"].as_bool().unwrap_or(false),
            });
        }
    }
    Ok(calendarios)
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
    let client = cliente();

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

/// Cria uma categoria mestra (POST /me/outlook/masterCategories). `preset` é o
/// nome do preset de cor do Outlook ("preset0".."preset24"); devolve a categoria
/// criada já com o hex resolvido. Exige MailboxSettings.ReadWrite (#211).
pub fn cr_criar_categoria(
    store: &TokenStore,
    nome: &str,
    preset: &str,
) -> Result<CategoriaCor, String> {
    let token = access_token(store)?;
    let client = cliente();

    let url = format!("{GRAPH}/me/outlook/masterCategories");
    let body = serde_json::json!({ "displayName": nome, "color": preset });
    let resp = graph_enviar("categorias:criar", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao criar a categoria: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita(
            "me/outlook/masterCategories",
            "criar categoria",
            resp.status(),
        ));
    }
    let it: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let nome_final = it["displayName"].as_str().unwrap_or(nome).to_string();
    let preset_final = it["color"].as_str().unwrap_or(preset);
    Ok(CategoriaCor {
        nome: nome_final,
        cor: preset_para_hex(preset_final).to_string(),
    })
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
    /// E-mail do organizador (Graph `organizer.emailAddress.address`). Aditivo
    /// (#515): habilita o `PersonHoverCard` no organizador do detalhe.
    pub organizador_email: String,
    /// True quando o usuário ativo organiza o evento (Graph `isOrganizer`).
    /// Habilita a ação "Cancelar evento" (#260), que notifica os convidados.
    pub sou_organizador: bool,
    /// Semântica do convite (#287): `responseStatus.response` — habilita o RSVP
    /// (Aceitar/Talvez/Recusar) e o badge de estado no detalhe.
    pub resposta: String,
    /// Graph `responseRequested`: false = convite informativo (sem RSVP).
    pub resposta_solicitada: bool,
    pub corpo: String,
    pub corpo_tipo: String, // "html" | "text"
    pub participantes: Vec<Participante>,
    pub web_link: String,
}

/// Detalhe completo de um evento (corpo + todos os convidados). Calendars.Read.
pub fn cr_evento_corpo(store: &TokenStore, id: &str) -> Result<EventoDetalhe, String> {
    let token = access_token(store)?;
    let client = cliente();

    let url = format!(
        "{GRAPH}/me/events/{id}?$select=subject,start,end,location,onlineMeeting,\
         isOnlineMeeting,onlineMeetingUrl,organizer,isOrganizer,responseStatus,\
         responseRequested,body,attendees,webLink"
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
        organizador_email: it["organizer"]["emailAddress"]["address"].as_str().unwrap_or("").to_string(),
        sou_organizador: it["isOrganizer"].as_bool().unwrap_or(false),
        resposta: it["responseStatus"]["response"]
            .as_str()
            .unwrap_or("none")
            .to_string(),
        resposta_solicitada: it["responseRequested"].as_bool().unwrap_or(true),
        corpo: it["body"]["content"].as_str().unwrap_or("").to_string(),
        corpo_tipo: it["body"]["contentType"].as_str().unwrap_or("text").to_string(),
        participantes,
        web_link: it["webLink"].as_str().unwrap_or("").to_string(),
    })
}

// ----------------------------------------------------------------------------
// Escrita de eventos (Agenda — #211): criar / editar / excluir.
// Escopo: Calendars.ReadWrite. Sob o mesmo pool + retry central (#64) das
// demais chamadas, respeitando Retry-After e jitter.
// ----------------------------------------------------------------------------

/// Um convidado do evento (#211): endereço + nome de exibição. Vira um
/// `attendees[]` no payload do Graph.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Convidado {
    pub email: String,
    pub nome: String,
}

fn intervalo_padrao() -> i64 {
    1
}

/// Recorrência de evento (#396, S1). Modelo do app; traduzido pro formato do
/// Graph (`recurrence.pattern` + `recurrence.range`) em `recurrence_json`.
///
/// #397: `Serialize` também — pra o back devolver a recorrência da série (parseada
/// do Graph por `recorrencia_de_json`) e o form CARREGAR os campos ao editar.
#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Recorrencia {
    /// "daily" | "weekly" | "monthly" | "yearly".
    pub frequencia: String,
    #[serde(default = "intervalo_padrao")]
    pub intervalo: i64,
    /// Só weekly: "monday".."sunday".
    #[serde(default)]
    pub dias_semana: Vec<String>,
    /// Monthly/yearly: dia do mês (1..31).
    #[serde(default)]
    pub dia_do_mes: Option<i64>,
    /// Yearly: mês (1..12).
    #[serde(default)]
    pub mes: Option<i64>,
    /// "noEnd" | "endDate" | "numbered".
    pub fim_tipo: String,
    /// Início da série (YYYY-MM-DD).
    pub data_inicio: String,
    #[serde(default)]
    pub data_fim: Option<String>,
    #[serde(default)]
    pub numero_ocorrencias: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventoInput {
    pub assunto: String,
    pub inicio: String, // hora-de-parede local, sem Z
    pub fim: String,
    pub dia_inteiro: bool,
    pub local: String,
    pub corpo: String,
    pub categorias: Vec<String>,
    pub time_zone: String, // IANA (ex. "America/Sao_Paulo")
    /// Convidados do evento (#211). Vazio = sem convidados.
    #[serde(default)]
    pub convidados: Vec<Convidado>,
    /// Reunião do Teams (#211): liga isOnlineMeeting + provider teamsForBusiness.
    #[serde(default)]
    pub reuniao_teams: bool,
    /// Calendário-alvo do evento (#233). Vazio/ausente = calendário padrão
    /// (/me/events). Presente = /me/calendars/{id}/events.
    #[serde(default)]
    pub calendario_id: Option<String>,
    /// Recorrência (#396). Ausente = evento único.
    #[serde(default)]
    pub recorrencia: Option<Recorrencia>,
    /// #397: PATCH só de campos (sem start/end/recurrence) — usado no "editar a
    /// série inteira" pra não mover o schedule ao editar campos. Default false.
    #[serde(default)]
    pub somente_campos: bool,
}

/// Traduz o modelo do app pro objeto `recurrence` do Graph (pattern + range).
fn recurrence_json(r: &Recorrencia, time_zone: &str) -> serde_json::Value {
    let (tipo, mut pattern) = match r.frequencia.as_str() {
        "weekly" => (
            "weekly",
            serde_json::json!({
                "daysOfWeek": r.dias_semana,
                "firstDayOfWeek": "sunday",
            }),
        ),
        "monthly" => (
            "absoluteMonthly",
            serde_json::json!({ "dayOfMonth": r.dia_do_mes.unwrap_or(1) }),
        ),
        "yearly" => (
            "absoluteYearly",
            serde_json::json!({
                "dayOfMonth": r.dia_do_mes.unwrap_or(1),
                "month": r.mes.unwrap_or(1),
            }),
        ),
        _ => ("daily", serde_json::json!({})),
    };
    pattern["type"] = serde_json::json!(tipo);
    pattern["interval"] = serde_json::json!(r.intervalo.max(1));

    let mut range = serde_json::json!({
        "type": r.fim_tipo,
        "startDate": r.data_inicio,
        "recurrenceTimeZone": time_zone,
    });
    match r.fim_tipo.as_str() {
        "endDate" => {
            if let Some(d) = &r.data_fim {
                range["endDate"] = serde_json::json!(d);
            }
        }
        "numbered" => {
            range["numberOfOccurrences"] =
                serde_json::json!(r.numero_ocorrencias.unwrap_or(1).max(1));
        }
        _ => {}
    }
    serde_json::json!({ "pattern": pattern, "range": range })
}

/// Reverso de `recurrence_json` (#397): traduz o objeto `recurrence` do Graph
/// (`pattern` + `range`) de volta pro modelo do app, pra o form CARREGAR os campos
/// ao editar a série. Lógica PURA (sem rede), exercitada em teste.
///
/// `None` quando não há recorrência (evento único) OU o pattern é de um tipo que o
/// app não modela fielmente (relativeMonthly/relativeYearly = "a 1ª segunda do mês")
/// — melhor degradar do que mentir um padrão editável que não corresponde.
fn recorrencia_de_json(recurrence: &serde_json::Value) -> Option<Recorrencia> {
    let pattern = recurrence.get("pattern")?;
    let range = recurrence.get("range")?;
    let frequencia = match pattern["type"].as_str()? {
        "daily" => "daily",
        "weekly" => "weekly",
        "absoluteMonthly" => "monthly",
        "absoluteYearly" => "yearly",
        _ => return None, // relative* e desconhecidos: não modelados
    }
    .to_string();

    let dias_semana: Vec<String> = pattern["daysOfWeek"]
        .as_array()
        .map(|a| a.iter().filter_map(|d| d.as_str().map(String::from)).collect())
        .unwrap_or_default();

    Some(Recorrencia {
        frequencia,
        intervalo: pattern["interval"].as_i64().unwrap_or(1).max(1),
        dias_semana,
        dia_do_mes: pattern["dayOfMonth"].as_i64(),
        mes: pattern["month"].as_i64(),
        fim_tipo: range["type"].as_str().unwrap_or("noEnd").to_string(),
        data_inicio: range["startDate"].as_str().unwrap_or("").to_string(),
        data_fim: range["endDate"].as_str().map(String::from),
        numero_ocorrencias: range["numberOfOccurrences"].as_i64(),
    })
}

/// #397: recorrência da SÉRIE (do `seriesMaster`) pra o form CARREGAR os campos ao
/// editar "a série inteira". `GET /me/events/{id}?$select=recurrence` sob o pool.
/// `None` quando o evento não é recorrente ou o padrão não é modelado pelo app
/// (o form então esconde/desabilita a recorrência em vez de mostrar errado).
/// Calendars.Read.
pub fn cr_evento_recorrencia(
    store: &TokenStore,
    id: &str,
    mailbox: Option<&str>,
) -> Result<Option<Recorrencia>, String> {
    let token = access_token(store)?;
    let client = cliente();
    // #1069: recorrência da série na caixa RESOLVIDA — antes /me fixo, o que numa
    // caixa compartilhada dava 404 e o form de "editar a série" não carregava os
    // campos (só o fallback best-effort). Agora acompanha a escrita mailbox-aware.
    let prefix = mailbox_prefix(mailbox);
    let url = format!("{GRAPH}/{prefix}/events/{id}?$select=recurrence");
    let resp = graph_enviar("agenda:recorrencia", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler a recorrência: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        log::warn!("[agenda:recorrencia] Graph retornou {st}");
        return Err(format!("/{prefix}/events (recorrência) retornou {st}"));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(recorrencia_de_json(&v["recurrence"]))
}

// ---------------------------------------------------------------------------
// #397: parse Graph→app da recorrência (o que faltava — a série não carregava os
// campos no form). Round-trip com `recurrence_json` + casos de borda.
//
// Rodar: cargo test --lib graph::testes_recorrencia
// ---------------------------------------------------------------------------
#[cfg(test)]
mod testes_cliente_graph {
    use super::*;

    #[test]
    fn cliente_e_a_mesma_instancia_em_toda_chamada() {
        // O ponto do OnceLock não é economizar alocação: é o POOL DE CONEXÃO ser
        // um só. Com 87 `Client::new()`, cada chamada abria o próprio pool e o app
        // não reaproveitava conexão TLS entre requisições ao mesmo host.
        let a = cliente();
        let b = cliente();
        assert!(
            std::ptr::eq(a, b),
            "cliente() devolveu instâncias diferentes — o pool de conexão deixou de ser único"
        );
    }

    #[test]
    fn connect_timeout_e_menor_que_o_teto_total() {
        // Se o connect pudesse durar tanto quanto a requisição inteira, o teto de
        // connect não bloquearia nada — a conexão pendurada seguraria a vaga do
        // pool até o fim do timeout total.
        assert!(
            GRAPH_CONNECT_TIMEOUT_S < GRAPH_TIMEOUT_TOTAL_S,
            "connect ({GRAPH_CONNECT_TIMEOUT_S}s) tem que ser menor que o total ({GRAPH_TIMEOUT_TOTAL_S}s)"
        );
    }

    #[test]
    fn teto_total_cobre_o_backoff_do_retry_com_folga() {
        // `graph_enviar` re-tenta até GRAPH_MAX_TENTATIVAS dormindo até
        // GRAPH_TETO_ESPERA_S entre elas. O timeout TOTAL é por requisição (o
        // reqwest reconta a cada tentativa), mas se ele fosse menor que uma espera
        // inteira, a 1ª tentativa lenta já estouraria antes de qualquer retry ter
        // chance — o retry viraria decoração.
        let espera_total = GRAPH_TETO_ESPERA_S * u64::from(GRAPH_MAX_TENTATIVAS);
        assert!(
            GRAPH_TIMEOUT_TOTAL_S > espera_total,
            "teto total ({GRAPH_TIMEOUT_TOTAL_S}s) não pode ser menor que o backoff acumulado ({espera_total}s)"
        );
    }
}

#[cfg(test)]
mod testes_mail {
    use super::*;

    #[test]
    fn delete_status_ok_trata_404_410_como_sucesso() {
        // apagou de fato
        assert!(delete_status_ok(200));
        assert!(delete_status_ok(204));
        // já não existia → idempotente (não pode abortar o empty)
        assert!(delete_status_ok(404));
        assert!(delete_status_ok(410));
        // erros reais NÃO contam
        assert!(!delete_status_ok(403));
        assert!(!delete_status_ok(429));
        assert!(!delete_status_ok(500));
        assert!(!delete_status_ok(0));
    }
}

#[cfg(test)]
mod testes_recorrencia {
    use super::*;

    #[test]
    fn round_trip_weekly_com_fim_por_data() {
        let r = Recorrencia {
            frequencia: "weekly".into(),
            intervalo: 2,
            dias_semana: vec!["monday".into(), "wednesday".into()],
            dia_do_mes: None,
            mes: None,
            fim_tipo: "endDate".into(),
            data_inicio: "2026-08-03".into(),
            data_fim: Some("2026-12-31".into()),
            numero_ocorrencias: None,
        };
        let g = recurrence_json(&r, "America/Sao_Paulo");
        let volta = recorrencia_de_json(&g).expect("weekly volta");
        assert_eq!(volta.frequencia, "weekly");
        assert_eq!(volta.intervalo, 2);
        assert_eq!(volta.dias_semana, vec!["monday", "wednesday"]);
        assert_eq!(volta.fim_tipo, "endDate");
        assert_eq!(volta.data_inicio, "2026-08-03");
        assert_eq!(volta.data_fim.as_deref(), Some("2026-12-31"));
    }

    #[test]
    fn absolute_monthly_vira_monthly() {
        let g = serde_json::json!({
            "pattern": { "type": "absoluteMonthly", "interval": 1, "dayOfMonth": 15 },
            "range": { "type": "noEnd", "startDate": "2026-01-15" }
        });
        let r = recorrencia_de_json(&g).expect("monthly");
        assert_eq!(r.frequencia, "monthly");
        assert_eq!(r.dia_do_mes, Some(15));
        assert_eq!(r.fim_tipo, "noEnd");
        assert!(r.data_fim.is_none());
    }

    #[test]
    fn numbered_traz_a_contagem() {
        let g = serde_json::json!({
            "pattern": { "type": "daily", "interval": 3 },
            "range": { "type": "numbered", "startDate": "2026-02-01", "numberOfOccurrences": 10 }
        });
        let r = recorrencia_de_json(&g).expect("daily numbered");
        assert_eq!(r.frequencia, "daily");
        assert_eq!(r.intervalo, 3);
        assert_eq!(r.fim_tipo, "numbered");
        assert_eq!(r.numero_ocorrencias, Some(10));
    }

    #[test]
    fn relativo_nao_modelado_vira_none() {
        // relativeMonthly ("a 1ª segunda do mês") não é modelado → None, pra o form
        // não mostrar um padrão editável que não corresponde.
        let g = serde_json::json!({
            "pattern": { "type": "relativeMonthly", "interval": 1, "daysOfWeek": ["monday"], "index": "first" },
            "range": { "type": "noEnd", "startDate": "2026-01-01" }
        });
        assert!(recorrencia_de_json(&g).is_none());
    }

    #[test]
    fn sem_recurrence_vira_none() {
        // Evento único: `recurrence` vem null/ausente → None.
        assert!(recorrencia_de_json(&serde_json::Value::Null).is_none());
        assert!(recorrencia_de_json(&serde_json::json!({})).is_none());
    }
}

/// Monta o corpo JSON de um evento para POST/PATCH em /me/events. Mandamos a
/// hora-de-parede local + o `timeZone` IANA do usuário — o Graph resolve o
/// instante, o que também satisfaz a exigência de meia-noite no fuso para
/// eventos de dia inteiro. O Z é removido por garantia (dateTime não leva zona).
fn evento_json(input: &EventoInput) -> serde_json::Value {
    // Convidados -> attendees[] no formato do Graph (ignora e-mail vazio).
    let attendees: Vec<serde_json::Value> = input
        .convidados
        .iter()
        .filter(|c| !c.email.trim().is_empty())
        .map(|c| {
            serde_json::json!({
                "emailAddress": { "address": c.email, "name": c.nome },
                "type": "required",
            })
        })
        .collect();
    let mut obj = serde_json::json!({
        "subject": input.assunto,
        "location": { "displayName": input.local },
        "body": { "contentType": "text", "content": input.corpo },
        "categories": input.categorias,
        "attendees": attendees,
        "isOnlineMeeting": input.reuniao_teams,
    });
    // onlineMeetingProvider só é válido quando isOnlineMeeting é true; ao ligar,
    // o Graph gera o link do Teams no evento.
    if input.reuniao_teams {
        obj["onlineMeetingProvider"] = serde_json::json!("teamsForBusiness");
    }
    // #397: no "editar a série inteira" (somente_campos) omitimos start/end e
    // recurrence pra não mover o schedule; o PATCH no seriesMaster só aplica os
    // campos. No fluxo normal (criar / editar ocorrência), envia tudo.
    if !input.somente_campos {
        let ini = input.inicio.trim_end_matches('Z');
        let fim = input.fim.trim_end_matches('Z');
        obj["isAllDay"] = serde_json::json!(input.dia_inteiro);
        obj["start"] = serde_json::json!({ "dateTime": ini, "timeZone": input.time_zone });
        obj["end"] = serde_json::json!({ "dateTime": fim, "timeZone": input.time_zone });
        // Recorrência (#396): só quando presente.
        if let Some(r) = &input.recorrencia {
            obj["recurrence"] = recurrence_json(r, &input.time_zone);
        }
    }
    obj
}

/// #1069: URL de um recurso de evento na caixa RESOLVIDA por `mailbox_prefix`.
/// `sufixo` acrescenta a sub-ação ("" · "/cancel" · "/accept"…). O bug do #1069
/// era a escrita de agenda presa em `/me/events`: numa caixa COMPARTILHADA isso
/// mirava o calendário errado (e, no excluir/cancelar, o 404 da caixa errada
/// virava sucesso → exclusão FANTASMA). Extraída pura pra provar em teste que a
/// caixa certa endereça `/users/{addr}/events`.
fn url_evento(prefix: &str, id: &str, sufixo: &str) -> String {
    format!("{GRAPH}/{prefix}/events/{id}{sufixo}")
}

/// #1069: URL da COLEÇÃO de eventos na caixa resolvida (POST criar). Sem
/// calendário-alvo mira `/{prefix}/events`; com id, `/{prefix}/calendars/{id}/events`.
fn url_eventos_colecao(prefix: &str, calendario_id: Option<&str>) -> String {
    match calendario_id.filter(|s| !s.is_empty()) {
        Some(cal) => format!("{GRAPH}/{prefix}/calendars/{cal}/events"),
        None => format!("{GRAPH}/{prefix}/events"),
    }
}

/// Cria um evento no calendário da caixa ativa (POST /{prefix}/events). Devolve o
/// id do evento criado para o front trocar o id otimista pelo real. #1069:
/// `mailbox` endereça a caixa (própria ou compartilhada). Calendars.ReadWrite(.Shared).
pub fn cr_criar_evento(
    store: &TokenStore,
    input: EventoInput,
    mailbox: Option<&str>,
) -> Result<String, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    // Calendário-alvo (#233): com id, cria em /{prefix}/calendars/{id}/events; sem
    // id, mantém o padrão (/{prefix}/events) — sem regressão do #211. #1069: agora
    // na caixa resolvida, não mais no /me fixo.
    let url = url_eventos_colecao(&prefix, input.calendario_id.as_deref());
    let body = evento_json(&input);
    let resp = graph_enviar("agenda:criar", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao criar o evento: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita(&format!("{prefix}/events"), "criar evento", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    memo_invalidar("agenda:"); // #440: agenda mudou → próximo read traz fresco
    Ok(v["id"].as_str().unwrap_or("").to_string())
}

/// Edita um evento existente (PATCH /{prefix}/events/{id}). #1069: `mailbox`
/// endereça a caixa (própria ou compartilhada). Calendars.ReadWrite(.Shared).
pub fn cr_editar_evento(
    store: &TokenStore,
    id: &str,
    input: EventoInput,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let url = url_evento(&prefix, id, "");
    let body = evento_json(&input);
    let resp = graph_enviar("agenda:editar", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao editar o evento: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita(&format!("{prefix}/events"), "editar evento", resp.status()));
    }
    memo_invalidar("agenda:"); // #440
    Ok(())
}

/// #213: reagenda um evento arrastando (PATCH /me/events/{id}) — envia SÓ
/// start/end/isAllDay, preservando attendees/corpo/categorias/recorrência (um
/// PATCH parcial no Graph não toca nos campos omitidos). Distinto do
/// `cr_editar_evento`, que reenvia a coleção de attendees. A hora-de-parede
/// local + o `time_zone` IANA seguem o mesmo contrato do criar/editar; o Z é
/// removido por garantia (dateTime não leva zona). Calendars.ReadWrite.
pub fn cr_reagendar_evento(
    store: &TokenStore,
    id: &str,
    inicio: &str,
    fim: &str,
    dia_inteiro: bool,
    time_zone: &str,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let url = url_evento(&prefix, id, ""); // #1069: caixa resolvida, não /me fixo.
    let ini = inicio.trim_end_matches('Z');
    let f = fim.trim_end_matches('Z');
    let body = serde_json::json!({
        "isAllDay": dia_inteiro,
        "start": { "dateTime": ini, "timeZone": time_zone },
        "end": { "dateTime": f, "timeZone": time_zone },
    });
    let resp = graph_enviar("agenda:reagendar", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao reagendar o evento: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita(&format!("{prefix}/events"), "reagendar evento", resp.status()));
    }
    memo_invalidar("agenda:"); // #440
    Ok(())
}

/// Exclui um evento (DELETE /{prefix}/events/{id}). #1069: `mailbox` endereça a
/// caixa (própria ou compartilhada) — antes era /me fixo, o que numa caixa
/// compartilhada apagava do calendário errado (ou, mais grave, o Graph devolvia
/// 404 "não é da minha caixa" e o código tratava como sucesso: a UI removia o
/// card e o evento PERMANECIA na caixa real — exclusão FANTASMA).
/// Calendars.ReadWrite(.Shared).
pub fn cr_excluir_evento(
    store: &TokenStore,
    id: &str,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let url = url_evento(&prefix, id, "");
    let resp = graph_enviar("agenda:excluir", GRAPH_TETO_ESPERA_S, || {
        client.delete(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao excluir o evento: {e}"))?;
    if resp.status().is_success() {
        memo_invalidar("agenda:"); // #440
        Ok(())
    } else if resp.status().as_u16() == 404 {
        // #1069: 404 só é aceito como sucesso-idempotente PORQUE a chamada foi
        // endereçada à caixa CORRETA (mailbox aplicado no `prefix`). Antes, com
        // /me fixo, um 404 podia significar apenas "este evento não é da minha
        // caixa" e ainda assim virava sucesso → exclusão fantasma. Agora,
        // resolvida a caixa, 404 = o evento realmente não existe LÁ.
        // Limite honesto: sem um GET de verificação prévio não dá pra separar
        // "nunca existiu" de "já foi excluído antes" — ambos são idempotência
        // legítima na caixa certa, então aceitamos como sucesso e logamos.
        log::info!("[agenda:excluir] 404 na caixa /{prefix} — evento já não existe (idempotente)");
        memo_invalidar("agenda:"); // #440
        Ok(())
    } else {
        Err(erro_escrita(&format!("{prefix}/events"), "excluir evento", resp.status()))
    }
}

/// Cancela um evento organizado pelo usuário (POST /me/events/{id}/cancel).
/// Diferente de excluir (#260): envia uma mensagem de cancelamento a todos os
/// convidados e remove o evento. Só é válido quando o usuário é o organizador —
/// a UI já restringe a ação; um 403/400 do Graph vira erro tratado. O
/// `comentario` opcional entra no corpo como "Comment". Calendars.ReadWrite.
pub fn cr_cancelar_evento(
    store: &TokenStore,
    id: &str,
    comentario: &str,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let url = url_evento(&prefix, id, "/cancel"); // #1069: caixa resolvida, não /me.
    let body = serde_json::json!({ "Comment": comentario });
    let resp = graph_enviar("agenda:cancelar", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao cancelar o evento: {e}"))?;
    if resp.status().is_success() {
        memo_invalidar("agenda:"); // #440
        Ok(())
    } else if resp.status().as_u16() == 404 {
        // #1069: mesmo limite honesto do excluir — 404 só é sucesso-idempotente
        // porque a chamada foi endereçada à caixa CORRETA (mailbox no `prefix`).
        // Com /me fixo, cancelar evento de caixa compartilhada dava 404 "não é da
        // minha caixa" tratado como sucesso (o front removia o card e o evento
        // ficava). Resolvida a caixa, 404 = realmente não existe lá.
        log::info!("[agenda:cancelar] 404 na caixa /{prefix} — evento já não existe (idempotente)");
        memo_invalidar("agenda:"); // #440
        Ok(())
    } else {
        Err(erro_escrita(&format!("{prefix}/events"), "cancelar evento", resp.status()))
    }
}

/// Responde a um convite de reunião (#287): RSVP via
/// POST /me/events/{id}/{accept|tentativelyAccept|decline}, com
/// `{ comment, sendResponse }`. `resposta` é a ação semântica vinda do front
/// ("accept" · "tentativelyAccept" · "decline"); qualquer outro valor é erro.
/// `enviar_resposta` liga/desliga o aviso ao organizador; `comentario` opcional
/// acompanha a resposta. Só faz sentido para quem foi CONVIDADO — a UI restringe
/// a ação (organizer não vê RSVP). Calendars.ReadWrite.
pub fn cr_responder_evento(
    store: &TokenStore,
    id: &str,
    resposta: &str,
    enviar_resposta: bool,
    comentario: &str,
    mailbox: Option<&str>,
) -> Result<(), String> {
    // Mapeia a ação semântica -> segmento do endpoint do Graph. Recusamos
    // valores desconhecidos em vez de montar uma URL inválida.
    let acao = match resposta {
        "accept" | "accepted" | "aceitar" => "accept",
        "tentativelyAccept" | "tentativelyAccepted" | "talvez" | "tentative" => "tentativelyAccept",
        "decline" | "declined" | "recusar" => "decline",
        outro => return Err(format!("resposta de convite inválida: {outro}")),
    };
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    // #1069: RSVP na caixa resolvida (/{prefix}/events/{id}/{acao}), não /me fixo.
    let url = url_evento(&prefix, id, &format!("/{acao}"));
    let body = serde_json::json!({
        "comment": comentario,
        "sendResponse": enviar_resposta,
    });
    let resp = graph_enviar("agenda:responder", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao responder o convite: {e}"))?;
    // 404 = evento já não existe na caixa CORRETA (idempotente, como cancelar/
    // excluir): agora que o `prefix` endereça a caixa certa, aceitar é honesto.
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        memo_invalidar("agenda:"); // #440
        Ok(())
    } else {
        Err(erro_escrita(&format!("{prefix}/events"), "responder convite", resp.status()))
    }
}

#[cfg(test)]
mod testes_agenda_1069 {
    use super::{deve_limpar_rascunho, mailbox_prefix, url_evento, url_eventos_colecao};

    // #1069 — RB35: prova que a ESCRITA de agenda numa caixa COMPARTILHADA
    // endereça /users/{addr}/events, e não /me/events (o bug: escrita presa em
    // /me → operação no calendário errado + 404 tratado como sucesso = exclusão
    // fantasma). Reverter `url_evento`/`cr_excluir_evento` pro /me fixo faz este
    // teste ficar VERMELHO (o `!contains("/me/events")`).
    #[test]
    fn escrita_de_evento_endereca_caixa_compartilhada() {
        let prefix = mailbox_prefix(Some("shared@x.com"));
        // O que `cr_excluir_evento(mailbox=Some("shared@x.com"))` monta:
        let excluir = url_evento(&prefix, "AAA", "");
        assert!(
            excluir.ends_with("/users/shared%40x.com/events/AAA"),
            "excluir deveria mirar a caixa compartilhada, veio: {excluir}"
        );
        assert!(
            !excluir.contains("/me/events"),
            "regressão: escrita voltou ao /me fixo: {excluir}"
        );
        // cancelar/RSVP acrescentam a sub-ação na MESMA caixa.
        let cancelar = url_evento(&prefix, "AAA", "/cancel");
        assert!(cancelar.ends_with("/users/shared%40x.com/events/AAA/cancel"));
        let rsvp = url_evento(&prefix, "AAA", "/accept");
        assert!(rsvp.ends_with("/users/shared%40x.com/events/AAA/accept"));
    }

    // #1069: a caixa PRÓPRia (None/"me") preserva o caminho pessoal — sem
    // regressão do comportamento pré-#1069.
    #[test]
    fn escrita_de_evento_preserva_me_na_caixa_propria() {
        let prefix = mailbox_prefix(None);
        assert!(url_evento(&prefix, "AAA", "").ends_with("/me/events/AAA"));
        assert!(url_eventos_colecao(&prefix, None).ends_with("/me/events"));
        assert!(url_eventos_colecao(&prefix, Some("cal1")).ends_with("/me/calendars/cal1/events"));
    }

    // #1069: criar (coleção) também segue a caixa, com/sem calendário-alvo (#233).
    #[test]
    fn colecao_de_evento_endereca_caixa_compartilhada() {
        let prefix = mailbox_prefix(Some("shared@x.com"));
        assert!(url_eventos_colecao(&prefix, None).ends_with("/users/shared%40x.com/events"));
        assert!(url_eventos_colecao(&prefix, Some(""))
            .ends_with("/users/shared%40x.com/events")); // id vazio = sem calendário
        assert!(url_eventos_colecao(&prefix, Some("cal1"))
            .ends_with("/users/shared%40x.com/calendars/cal1/events"));
    }

    // #1069 — RB36: rascunho ÓRFÃO. A limpeza só dispara quando o rascunho já
    // existe E um passo posterior falhou. Se a criação falha não há rascunho;
    // se o envio conclui, o rascunho foi consumido. (Antes, os 4 passos rodavam
    // fora do pool/retry e um 429 no meio deixava o rascunho parado em Drafts.)
    #[test]
    fn limpa_rascunho_so_apos_criar_e_em_falha() {
        assert!(deve_limpar_rascunho(true, false)); // patch/anexo/send falhou → limpa
        assert!(!deve_limpar_rascunho(false, false)); // createReply falhou → sem draft
        assert!(!deve_limpar_rascunho(true, true)); // tudo ok → draft consumido
        assert!(!deve_limpar_rascunho(false, true)); // impossível na prática
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailItem {
    pub id: String,
    pub conversation_id: Option<String>,
    pub conversation_index: Option<String>,
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnexoEmail {
    pub id: String,
    pub nome: String,
    pub tamanho: u64,
    /// MIME do anexo (`contentType` do Graph) — o front decide o renderer
    /// antes de buscar os bytes. Vazio quando o Graph não informa.
    pub content_type: String,
    /// `@odata.type` do anexo: `fileAttachment` / `itemAttachment` /
    /// `referenceAttachment`. Roteia file vs .msg vs link (#178 §5).
    pub odata_type: String,
    /// Anexo inline (embutido no corpo, ex.: imagem citada) vs. anexo real.
    pub is_inline: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDetalhe {
    pub assunto: String,
    pub de: String,
    pub de_email: String,
    pub para: Vec<String>,
    pub cc: Vec<String>,
    /// E-mails dos destinatarios, ALINHADOS 1:1 com `para`/`cc` (#515). Existem
    /// pro front abrir o hover card por pessoa; `para`/`cc` seguem com os nomes.
    pub para_emails: Vec<String>,
    pub cc_emails: Vec<String>,
    pub recebido: String,
    pub corpo: String,
    pub corpo_tipo: String, // "html" | "text"
    pub anexos: Vec<AnexoEmail>,
    pub web_link: String,
}

/// Predicado compartilhado por `nomes_recipients`/`emails_recipients`: mantem o
/// recipient se houver name OU address (senao ambos caem juntos → alinhados).
fn recipient_tem_conteudo(r: &serde_json::Value) -> bool {
    !r["emailAddress"]["name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| r["emailAddress"]["address"].as_str())
        .unwrap_or("")
        .is_empty()
}

/// Nomes (ou e-mails) de uma lista de recipients do Graph.
fn nomes_recipients(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter(|r| recipient_tem_conteudo(r))
                .map(|r| {
                    r["emailAddress"]["name"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .or_else(|| r["emailAddress"]["address"].as_str())
                        .unwrap_or("")
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// E-mails (address) de uma lista de recipients, ALINHADO 1:1 com
/// `nomes_recipients` (mesmo filtro). Address pode vir "" se so houver name (#515).
fn emails_recipients(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter(|r| recipient_tem_conteudo(r))
                .map(|r| {
                    r["emailAddress"]["address"]
                        .as_str()
                        .unwrap_or("")
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Corpo completo de um e-mail + destinatarios e anexos. Mail.Read.
pub fn cr_email_corpo(
    store: &TokenStore,
    id: &str,
    mailbox: Option<&str>,
) -> Result<EmailDetalhe, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!(
        "{GRAPH}/{prefix}/messages/{id}\
         ?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,webLink"
    );
    let resp = graph_enviar("mail:corpo", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/{prefix}/messages retornou {}", resp.status()));
    }
    let it: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let para = nomes_recipients(&it["toRecipients"]);
    let cc = nomes_recipients(&it["ccRecipients"]);
    let para_emails = emails_recipients(&it["toRecipients"]);
    let cc_emails = emails_recipients(&it["ccRecipients"]);

    // Anexos so quando houver (poupa uma chamada).
    let mut anexos = Vec::new();
    if it["hasAttachments"].as_bool().unwrap_or(false) {
        let au = format!(
            "{GRAPH}/{prefix}/messages/{id}/attachments\
             ?$select=id,name,size,contentType,isInline"
        );
        if let Ok(r) = graph_enviar("mail:anexos", GRAPH_TETO_ESPERA_S, || {
            client.get(&au).bearer_auth(&token).send()
        }) {
            if r.status().is_success() {
                if let Ok(va) = r.json::<serde_json::Value>() {
                    if let Some(arr) = va["value"].as_array() {
                        for a in arr {
                            anexos.push(AnexoEmail {
                                id: a["id"].as_str().unwrap_or("").to_string(),
                                nome: a["name"].as_str().unwrap_or("arquivo").to_string(),
                                tamanho: a["size"].as_u64().unwrap_or(0),
                                content_type: a["contentType"].as_str().unwrap_or("").to_string(),
                                // `@odata.type` vem automático na coleção polimórfica
                                // (fileAttachment/itemAttachment/referenceAttachment).
                                odata_type: a["@odata.type"].as_str().unwrap_or("").to_string(),
                                is_inline: a["isInline"].as_bool().unwrap_or(false),
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
        para_emails,
        cc_emails,
        recebido: it["receivedDateTime"].as_str().unwrap_or("").to_string(),
        corpo: it["body"]["content"].as_str().unwrap_or("").to_string(),
        corpo_tipo: it["body"]["contentType"].as_str().unwrap_or("text").to_string(),
        anexos,
        web_link: it["webLink"].as_str().unwrap_or("").to_string(),
    })
}

// --- Segurança do leitor (#91) ---------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemetenteNomeado {
    pub nome: String,
    pub email: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegurancaEmail {
    /// Endereços de Reply-To (para detectar divergência do From no front).
    pub reply_to: Vec<RemetenteNomeado>,
    /// Valores dos headers `Authentication-Results` / `ARC-Authentication-Results`
    /// (SPF/DKIM/DMARC). O parse fica no front (`seguranca-leitor.ts`, testável).
    pub autenticacao: Vec<String>,
    /// Valores de `Received-SPF` (fallback de SPF quando o AR não traz).
    pub received_spf: Vec<String>,
}

/// Nome + e-mail de cada recipient de uma lista do Graph (mantém pares vazios
/// fora do resultado).
fn recipients_nomeados(v: &serde_json::Value) -> Vec<RemetenteNomeado> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let email = r["emailAddress"]["address"].as_str().unwrap_or("");
                    if email.is_empty() {
                        return None;
                    }
                    let nome = r["emailAddress"]["name"].as_str().unwrap_or("");
                    Some(RemetenteNomeado {
                        nome: nome.to_string(),
                        email: email.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Dados de segurança de um e-mail (#91): Reply-To + headers de autenticação.
/// `internetMessageHeaders` vem só quando explicitamente selecionado e requer
/// apenas `Mail.Read` (já concedido; ver AGENTS.md §1.1). Passa pelo pool
/// `graph_enviar` (#64) como as demais chamadas.
pub fn cr_email_seguranca(
    store: &TokenStore,
    id: &str,
    mailbox: Option<&str>,
) -> Result<SegurancaEmail, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!(
        "{GRAPH}/{prefix}/messages/{id}?$select=replyTo,internetMessageHeaders"
    );
    let resp = graph_enviar("mail:seguranca", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler cabeçalhos do e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "/{prefix}/messages (segurança) retornou {}",
            resp.status()
        ));
    }
    let it: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let reply_to = recipients_nomeados(&it["replyTo"]);

    let mut autenticacao = Vec::new();
    let mut received_spf = Vec::new();
    if let Some(hdrs) = it["internetMessageHeaders"].as_array() {
        for h in hdrs {
            let nome = h["name"].as_str().unwrap_or("").to_ascii_lowercase();
            let valor = h["value"].as_str().unwrap_or("");
            if valor.is_empty() {
                continue;
            }
            match nome.as_str() {
                "authentication-results" | "arc-authentication-results" => {
                    autenticacao.push(valor.to_string());
                }
                "received-spf" => received_spf.push(valor.to_string()),
                _ => {}
            }
        }
    }

    Ok(SegurancaEmail {
        reply_to,
        autenticacao,
        received_spf,
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
    mailbox: Option<&str>,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!(
        "{GRAPH}/{prefix}/messages/{message_id}/attachments/{attachment_id}"
    );
    let resp = graph_enviar("mail:baixar-anexo", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao baixar o anexo: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "/{prefix}/messages/attachments retornou {}",
            resp.status()
        ));
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

/// Conteúdo de um anexo lido em memória para pré-visualização (#188).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnexoConteudo {
    /// Bytes do anexo já em base64 (o Graph entrega `contentBytes` assim —
    /// repassamos sem decodificar/recodificar).
    pub bytes_b64: String,
    /// MIME informado pelo Graph (ou vazio).
    pub content_type: String,
    pub nome: String,
}

/// Lê um anexo **em memória** (base64) para o preview, **sem** gravar em
/// Downloads (esse é o papel do `cr_baixar_anexo`, que vira o botão "Salvar").
/// Só trata `fileAttachment` (tem `contentBytes`); item/reference são tratados
/// em fatias posteriores do épico (#178 §5).
pub fn cr_ler_anexo(
    store: &TokenStore,
    message_id: &str,
    attachment_id: &str,
    mailbox: Option<&str>,
) -> Result<AnexoConteudo, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!(
        "{GRAPH}/{prefix}/messages/{message_id}/attachments/{attachment_id}"
    );
    let resp = graph_enviar("mail:ler-anexo", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler o anexo: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "/{prefix}/messages/attachments retornou {}",
            resp.status()
        ));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;

    let bytes_b64 = v["contentBytes"]
        .as_str()
        .ok_or("anexo sem conteúdo (não é um arquivo? .msg/link não têm bytes)")?
        .to_string();

    Ok(AnexoConteudo {
        bytes_b64,
        content_type: v["contentType"].as_str().unwrap_or("").to_string(),
        nome: v["name"].as_str().unwrap_or("anexo").to_string(),
    })
}

/// Lê a mensagem embutida de um `itemAttachment` (e-mail encaminhado/`.msg`),
/// expandindo `microsoft.graph.itemAttachment/item`, e devolve um `EmailDetalhe`
/// para o mesmo reader (#191). Corrige o bug de itemAttachment não ter
/// `contentBytes` (o `cr_ler_anexo` falha nesses hoje).
pub fn cr_ler_anexo_email(
    store: &TokenStore,
    message_id: &str,
    attachment_id: &str,
    mailbox: Option<&str>,
) -> Result<EmailDetalhe, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!(
        "{GRAPH}/{prefix}/messages/{message_id}/attachments/{attachment_id}\
         ?$expand=microsoft.graph.itemAttachment/item"
    );
    let resp = graph_enviar("mail:ler-anexo-email", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler o e-mail anexado: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "leitura do e-mail anexado retornou {}",
            resp.status()
        ));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let it = &v["item"];
    if it.is_null() {
        return Err("este anexo não é uma mensagem embutida".to_string());
    }

    let para = nomes_recipients(&it["toRecipients"]);
    let cc = nomes_recipients(&it["ccRecipients"]);
    let para_emails = emails_recipients(&it["toRecipients"]);
    let cc_emails = emails_recipients(&it["ccRecipients"]);

    // Anexos aninhados (best-effort: só se o Graph os trouxe junto do item).
    let mut anexos = Vec::new();
    if let Some(arr) = it["attachments"].as_array() {
        for a in arr {
            anexos.push(AnexoEmail {
                id: a["id"].as_str().unwrap_or("").to_string(),
                nome: a["name"].as_str().unwrap_or("arquivo").to_string(),
                tamanho: a["size"].as_u64().unwrap_or(0),
                content_type: a["contentType"].as_str().unwrap_or("").to_string(),
                odata_type: a["@odata.type"].as_str().unwrap_or("").to_string(),
                is_inline: a["isInline"].as_bool().unwrap_or(false),
            });
        }
    }

    Ok(EmailDetalhe {
        assunto: it["subject"].as_str().unwrap_or("(sem assunto)").to_string(),
        de: it["from"]["emailAddress"]["name"].as_str().unwrap_or("").to_string(),
        de_email: it["from"]["emailAddress"]["address"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        para,
        cc,
        para_emails,
        cc_emails,
        recebido: it["receivedDateTime"].as_str().unwrap_or("").to_string(),
        corpo: it["body"]["content"].as_str().unwrap_or("").to_string(),
        corpo_tipo: it["body"]["contentType"].as_str().unwrap_or("text").to_string(),
        anexos,
        web_link: it["webLink"].as_str().unwrap_or("").to_string(),
    })
}

/// Devolve o link de destino de um `referenceAttachment` (OneDrive/SharePoint)
/// sem baixar bytes (#191). Cai no `webLink` se não houver `sourceUrl`.
pub fn cr_anexo_link(
    store: &TokenStore,
    message_id: &str,
    attachment_id: &str,
    mailbox: Option<&str>,
) -> Result<String, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let url =
        format!("{GRAPH}/{prefix}/messages/{message_id}/attachments/{attachment_id}");
    let resp = graph_enviar("mail:anexo-link", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler o anexo: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("leitura do anexo retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    v["sourceUrl"]
        .as_str()
        .or_else(|| v["webLink"].as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "anexo de referência sem link".to_string())
}

/// Path C (spec §4.3): converte um anexo Office para PDF em **alta fidelidade**
/// usando o próprio OneDrive do usuário — sobe para uma pasta temporária oculta
/// (`/Bridge Anexos/.preview/`), pede `?format=pdf` ao Graph e **sempre apaga**
/// o item temporário (mesmo se a conversão falhar). O PDF resultante é
/// renderizado pelo mesmo pdf.js da Story 1.
///
/// Egress consciente (§7.3): o anexo sai para o OneDrive do **próprio tenant**
/// do usuário (dado dele, tenant dele), em pasta oculta, e o temp é removido no
/// fim. Usa `Files.ReadWrite` (já concedido) — sem escopo novo.
pub fn cr_anexo_para_pdf(
    store: &TokenStore,
    message_id: &str,
    attachment_id: &str,
    mailbox: Option<&str>,
) -> Result<AnexoConteudo, String> {
    use base64::{engine::general_purpose, Engine as _};

    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    // 1) Lê o anexo (bytes + nome).
    let a_url =
        format!("{GRAPH}/{prefix}/messages/{message_id}/attachments/{attachment_id}");
    let resp = graph_enviar("mail:ler-anexo-pdf", GRAPH_TETO_ESPERA_S, || {
        client.get(&a_url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler o anexo: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("leitura do anexo retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let nome = v["name"].as_str().unwrap_or("anexo").to_string();
    let bytes = general_purpose::STANDARD
        .decode(v["contentBytes"].as_str().unwrap_or("").trim())
        .map_err(|e| format!("conteúdo do anexo inválido: {e}"))?;

    let caminho = std::path::Path::new(&nome);
    let ext = caminho.extension().and_then(|s| s.to_str()).unwrap_or("bin");
    let stem = caminho.file_stem().and_then(|s| s.to_str()).unwrap_or("anexo");

    // Nome temporário único (nanos): evita colisão entre previews concorrentes.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_nome = urlencoding::encode(&format!("{ts}.{ext}")).into_owned();

    // 2) PUT numa pasta oculta .preview (o PUT-por-path cria a pasta se preciso).
    let put_url = format!(
        "{GRAPH}/me/drive/root:/Bridge%20Anexos/.preview/{temp_nome}:/content"
    );
    let resp = graph_enviar("onedrive:preview-upload", GRAPH_TETO_ESPERA_S, || {
        client
            .put(&put_url)
            .bearer_auth(&token)
            .header("Content-Type", "application/octet-stream")
            .body(bytes.clone())
            .send()
    })
    .map_err(|e| format!("falha no upload para conversão: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("upload para conversão retornou {}", resp.status()));
    }
    let item: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let item_id = item["id"]
        .as_str()
        .ok_or("item temporário sem id")?
        .to_string();

    // 3) GET ?format=pdf (o reqwest segue o redirect de download).
    let conv_url =
        format!("{GRAPH}/me/drive/items/{item_id}/content?format=pdf");
    let conv = graph_enviar("onedrive:convert-pdf", GRAPH_TETO_ESPERA_S, || {
        client.get(&conv_url).bearer_auth(&token).send()
    });

    // 4) Cleanup do temp — SEMPRE, dê o que der na conversão (best-effort).
    let del_url = format!("{GRAPH}/me/drive/items/{item_id}");
    let _ = graph_enviar("onedrive:preview-delete", GRAPH_TETO_ESPERA_S, || {
        client.delete(&del_url).bearer_auth(&token).send()
    });

    // 5) Só agora avalia o resultado da conversão.
    let conv = conv.map_err(|e| format!("falha na conversão para PDF: {e}"))?;
    if !conv.status().is_success() {
        return Err(format!("conversão para PDF retornou {}", conv.status()));
    }
    let pdf = conv.bytes().map_err(|e| e.to_string())?;

    Ok(AnexoConteudo {
        bytes_b64: general_purpose::STANDARD.encode(&pdf),
        content_type: "application/pdf".to_string(),
        nome: format!("{stem}.pdf"),
    })
}

/// Devolve um caminho ainda livre dentro de `dir` para `nome`. Se ja existir,
/// anexa " (1)", " (2)", ... antes da extensao ate achar um nome disponivel.
pub(crate) fn caminho_livre(dir: &std::path::Path, nome: &str) -> std::path::PathBuf {
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
// Salvar como… — S2 .eml (#637). Baixa o MIME (RFC822) pronto de cada mensagem
// via `GET /messages/{id}/$value` e grava um `.eml` íntegro na pasta escolhida.
// Lote resiliente: a falha de um item não aborta os demais.
// ----------------------------------------------------------------------------

/// Resultado de um lote de "Salvar como…": caminhos gravados + falhas por item.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalvarEmailResultado {
    /// Caminhos absolutos dos arquivos gravados (um por e-mail bem-sucedido).
    pub salvos: Vec<String>,
    /// Itens que falharam, identificados pelo assunto, com o motivo.
    pub falhas: Vec<SalvarEmailFalha>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalvarEmailFalha {
    /// Assunto do e-mail (ou "(sem assunto)") para identificar o item no toast.
    pub assunto: String,
    /// Motivo legível da falha.
    pub erro: String,
}

/// Sanitiza um assunto para nome de arquivo do Windows: troca os caracteres
/// proibidos (`\ / : * ? " < > |`) e de controle por espaço, colapsa espaços,
/// corta em ~120 chars e apara `.`/espaço das pontas. Vazio → `fallback`.
pub(crate) fn sanitizar_nome_arquivo(bruto: &str, fallback: &str) -> String {
    const INVALIDOS: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    let limpo: String = bruto
        .chars()
        .map(|c| {
            if INVALIDOS.contains(&c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let colapsado = limpo.split_whitespace().collect::<Vec<_>>().join(" ");
    let cortado: String = colapsado.chars().take(120).collect();
    let aparado = cortado
        .trim_matches(|c: char| c == '.' || c == ' ')
        .to_string();
    if aparado.is_empty() {
        fallback.to_string()
    } else {
        aparado
    }
}

/// Lê o assunto de uma mensagem (best-effort) — vira o nome do arquivo e
/// identifica o item num eventual erro. Falha aqui não impede a gravação.
fn assunto_da_mensagem(
    client: &reqwest::blocking::Client,
    token: &str,
    prefix: &str,
    id: &str,
) -> Option<String> {
    let url = format!("{GRAPH}/{prefix}/messages/{id}?$select=subject");
    let resp = graph_enviar("mail:salvar-assunto", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(token).send()
    })
    .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().ok()?;
    v["subject"].as_str().map(|s| s.to_string())
}

/// Baixa o MIME (RFC822) pronto de uma mensagem via `$value`.
fn mime_da_mensagem(
    client: &reqwest::blocking::Client,
    token: &str,
    prefix: &str,
    id: &str,
) -> Result<Vec<u8>, String> {
    let url = format!("{GRAPH}/{prefix}/messages/{id}/$value");
    let resp = graph_enviar("mail:salvar-eml", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(token).send()
    })
    .map_err(|e| format!("falha ao baixar o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/messages/$value retornou {}", resp.status()));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| format!("falha ao ler o conteudo: {e}"))
}

/// Salva um ou vários e-mails como `.eml` (MIME íntegro) na `pasta` escolhida.
/// Nome = assunto sanitizado + `.eml`, com sufixo ` (2)`… em caso de colisão.
/// Lote resiliente: cada item é independente; falhas vão em `resultado.falhas`.
pub fn cr_salvar_email_eml(
    store: &TokenStore,
    ids: &[String],
    pasta: &str,
    mailbox: Option<&str>,
) -> Result<SalvarEmailResultado, String> {
    let dir = std::path::Path::new(pasta);
    if !dir.is_dir() {
        return Err(format!("pasta invalida: {pasta}"));
    }

    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let mut salvos: Vec<String> = Vec::new();
    let mut falhas: Vec<SalvarEmailFalha> = Vec::new();

    for id in ids {
        // Assunto best-effort: nomeia o arquivo e rotula o item num erro.
        let assunto = assunto_da_mensagem(&client, &token, &prefix, id).unwrap_or_default();
        let rotulo = if assunto.trim().is_empty() {
            "(sem assunto)".to_string()
        } else {
            assunto.clone()
        };
        let nome = sanitizar_nome_arquivo(&assunto, "(sem assunto)");

        match mime_da_mensagem(&client, &token, &prefix, id) {
            Ok(bytes) => {
                let destino = caminho_livre(dir, &format!("{nome}.eml"));
                match std::fs::write(&destino, &bytes) {
                    Ok(()) => salvos.push(destino.to_string_lossy().to_string()),
                    Err(e) => falhas.push(SalvarEmailFalha {
                        assunto: rotulo,
                        erro: format!("falha ao gravar o arquivo: {e}"),
                    }),
                }
            }
            Err(e) => falhas.push(SalvarEmailFalha {
                assunto: rotulo,
                erro: e,
            }),
        }
    }

    Ok(SalvarEmailResultado { salvos, falhas })
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

/// #1069 (RB36): decide se um passo do `compor_e_enviar` deixou rascunho ÓRFÃO a
/// limpar. O rascunho só existe DEPOIS do passo de criação (createReply/Forward);
/// um envio BEM-sucedido consome o rascunho (nada a limpar). Pura, pra testar a
/// regra sem rede: só limpamos quando o rascunho foi criado E um passo posterior
/// falhou. Antes do RB36, os 4 passos rodavam fora do `graph_enviar` e um 429 no
/// meio abortava deixando o rascunho parado em Drafts.
fn deve_limpar_rascunho(rascunho_criado: bool, passo_ok: bool) -> bool {
    rascunho_criado && !passo_ok
}

/// Cria um rascunho de resposta/encaminhamento, injeta o corpo e envia.
/// #1069 (RB36): as 4 chamadas rodam sob `graph_enviar` (pool + retry 429), como
/// o `cr_enviar_novo`; se um passo POSTERIOR à criação falhar, o rascunho é
/// removido (DELETE) pra não ficar órfão em Drafts.
fn compor_e_enviar(
    store: &TokenStore,
    id: &str,
    acao: &str, // "createReply" | "createReplyAll" | "createForward"
    corpo_html: &str,
    para: &[String],
    anexos: &[AnexoUp],
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    // 1) rascunho a partir da mensagem original — sob o pool + retry 429 (#1069).
    let url = format!("{GRAPH}/{prefix}/messages/{id}/{acao}");
    let resp = graph_enviar("mail:compor-rascunho", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).header("Content-Length", "0").send()
    })
    .map_err(|e| format!("falha ao criar o rascunho: {e}"))?;
    if !resp.status().is_success() {
        // Criação falhou: `deve_limpar_rascunho(false, _)` = nada a limpar.
        return Err(erro_envio(&prefix, acao, resp.status()));
    }
    let rascunho: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let draft_id = rascunho["id"].as_str().ok_or("rascunho sem id")?.to_string();
    // corpo original (com a citação) que o Graph montou — preservamos abaixo
    let citacao = rascunho["body"]["content"].as_str().unwrap_or("");
    let corpo_final = format!("{corpo_html}<br>{citacao}");

    // #1069 (RB36): daqui pra frente o rascunho JÁ existe em Drafts. Qualquer
    // falha de passo POSTERIOR (transporte ou 429 esgotado) tem de LIMPAR o
    // rascunho, senão fica órfão. `limpar` faz o DELETE best-effort (via
    // `deletar_msg`, que já roda sob o pool) e devolve o erro original.
    let limpar = |erro: String| -> String {
        // No caminho de falha, o passo NÃO teve ok (passo_ok = false).
        if deve_limpar_rascunho(true, false) {
            if let Err(e) = deletar_msg(&client, &token, &prefix, &draft_id) {
                log::warn!("[mail:compor] rascunho órfão {draft_id} não pôde ser limpo: {e}");
            }
        }
        erro
    };

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
    let url = format!("{GRAPH}/{prefix}/messages/{draft_id}");
    let resp = graph_enviar("mail:compor-patch", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&patch).send()
    })
    .map_err(|e| limpar(format!("falha ao preencher o rascunho: {e}")))?;
    if !resp.status().is_success() {
        return Err(limpar(erro_envio(&prefix, "PATCH do rascunho", resp.status())));
    }

    // 2.5) anexa os arquivos no rascunho (POST /attachments), um por vez.
    for a in anexos {
        if a.conteudo_b64.trim().is_empty() {
            continue;
        }
        let url = format!("{GRAPH}/{prefix}/messages/{draft_id}/attachments");
        let resp = graph_enviar("mail:compor-anexo", GRAPH_TETO_ESPERA_S, || {
            client.post(&url).bearer_auth(&token).json(&anexo_json(a)).send()
        })
        .map_err(|e| limpar(format!("falha ao anexar '{}': {e}", a.nome)))?;
        if !resp.status().is_success() {
            return Err(limpar(erro_envio(
                &prefix,
                &format!("anexar '{}'", a.nome),
                resp.status(),
            )));
        }
    }

    // 3) envia — sucesso CONSOME o rascunho (não há o que limpar).
    let url = format!("{GRAPH}/{prefix}/messages/{draft_id}/send");
    let resp = graph_enviar("mail:compor-enviar", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).header("Content-Length", "0").send()
    })
    .map_err(|e| limpar(format!("falha ao enviar: {e}")))?;
    if !resp.status().is_success() {
        return Err(limpar(erro_envio(&prefix, "envio", resp.status())));
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
    mailbox: Option<&str>,
) -> Result<(), String> {
    let acao = if todos { "createReplyAll" } else { "createReply" };
    compor_e_enviar(store, id, acao, corpo_html, &[], &anexos, mailbox)
}

/// Encaminha um e-mail para os destinatários informados.
pub fn cr_encaminhar(
    store: &TokenStore,
    id: &str,
    corpo_html: &str,
    para: Vec<String>,
    anexos: Vec<AnexoUp>,
    mailbox: Option<&str>,
) -> Result<(), String> {
    if para.iter().all(|e| e.trim().is_empty()) {
        return Err("informe ao menos um destinatário".into());
    }
    compor_e_enviar(
        store,
        id,
        "createForward",
        corpo_html,
        &para,
        &anexos,
        mailbox,
    )
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
    let client = cliente();

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

const ONEDRIVE_SETTINGS_CONTENT_URL: &str =
    "https://graph.microsoft.com/v1.0/me/drive/root:/Documents/Galaxie/AppSettings/toolbox.json:/content";
const ONEDRIVE_SETTINGS_ITEM_URL: &str =
    "https://graph.microsoft.com/v1.0/me/drive/root:/Documents/Galaxie/AppSettings/toolbox.json:?$select=eTag,cTag";
const ONEDRIVE_SETTINGS_CONFLICT: &str = "onedrive-settings-conflict";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveSettingsReadResult {
    pub content: Option<String>,
    pub e_tag: Option<String>,
    pub c_tag: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveSettingsWriteResult {
    pub e_tag: Option<String>,
    pub c_tag: Option<String>,
}

fn drive_item_tags(value: &serde_json::Value) -> (Option<String>, Option<String>) {
    (
        value["eTag"].as_str().map(str::to_owned),
        value["cTag"].as_str().map(str::to_owned),
    )
}

/// Lê o JSON privado de configuração. 404 é o primeiro uso, não um erro.
pub fn onedrive_settings_read(store: &TokenStore) -> Result<OneDriveSettingsReadResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let item = graph_enviar("onedrive:settings:item", GRAPH_TETO_ESPERA_S, || {
        client
            .get(ONEDRIVE_SETTINGS_ITEM_URL)
            .bearer_auth(&token)
            .send()
    })
    .map_err(|e| format!("falha ao ler versão da configuração do OneDrive: {e}"))?;

    let item_status = item.status();
    if item_status.as_u16() == 404 {
        return Ok(OneDriveSettingsReadResult {
            content: None,
            e_tag: None,
            c_tag: None,
        });
    }
    if !item_status.is_success() {
        let body = item.text().unwrap_or_default();
        return Err(format!(
            "leitura da versão da configuração do OneDrive retornou {item_status}: {body}"
        ));
    }
    let item_json: serde_json::Value = item
        .json()
        .map_err(|e| format!("versão da configuração do OneDrive ilegível: {e}"))?;
    let (e_tag, c_tag) = drive_item_tags(&item_json);

    let resp = graph_enviar("onedrive:settings:read", GRAPH_TETO_ESPERA_S, || {
        client
            .get(ONEDRIVE_SETTINGS_CONTENT_URL)
            .bearer_auth(&token)
            .send()
    })
    .map_err(|e| format!("falha ao ler configuração do OneDrive: {e}"))?;

    let status = resp.status();
    if status.as_u16() == 404 {
        return Ok(OneDriveSettingsReadResult {
            content: None,
            e_tag: None,
            c_tag: None,
        });
    }
    if !status.is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!(
            "leitura da configuração do OneDrive retornou {status}: {body}"
        ));
    }
    let content = resp
        .text()
        .map_err(|e| format!("configuração do OneDrive ilegível: {e}"))?;
    Ok(OneDriveSettingsReadResult {
        content: Some(content),
        e_tag,
        c_tag,
    })
}

/// Grava o snapshot JSON com If-Match; 412 é exposto como conflito recuperável.
pub fn onedrive_settings_write(
    store: &TokenStore,
    content: &str,
    e_tag: Option<&str>,
) -> Result<OneDriveSettingsWriteResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let bytes = content.as_bytes().to_vec();
    let upload = || {
        graph_enviar("onedrive:settings:write", GRAPH_TETO_ESPERA_S, || {
            let request = client
                .put(ONEDRIVE_SETTINGS_CONTENT_URL)
                .bearer_auth(&token)
                .header("Content-Type", "application/json; charset=utf-8")
                .body(bytes.clone());
            match e_tag {
                Some(tag) => request.header(reqwest::header::IF_MATCH, tag),
                None => request.header(reqwest::header::IF_NONE_MATCH, "*"),
            }
            .send()
        })
    };
    let mut resp = upload()
        .map_err(|e| format!("falha ao gravar configuração no OneDrive: {e}"))?;

    // Upload por path cria o arquivo, mas exige o parent. No primeiro uso as
    // duas pastas do app ainda não existem: cria-as e repete o mesmo PUT.
    if resp.status().as_u16() == 404 {
        ensure_onedrive_settings_dirs(&client, &token)?;
        resp = upload()
            .map_err(|e| format!("falha ao gravar configuração no OneDrive: {e}"))?;
    }

    if resp.status().as_u16() == 412 {
        return Err(ONEDRIVE_SETTINGS_CONFLICT.to_string());
    }
    if resp.status().is_success() {
        let value: serde_json::Value = resp
            .json()
            .map_err(|e| format!("resposta da gravação do OneDrive ilegível: {e}"))?;
        let (e_tag, c_tag) = drive_item_tags(&value);
        return Ok(OneDriveSettingsWriteResult { e_tag, c_tag });
    }
    let status = resp.status();
    let body = resp.text().unwrap_or_default();
    Err(format!(
        "gravação da configuração no OneDrive retornou {status}: {body}"
    ))
}

fn ensure_onedrive_settings_dirs(
    client: &reqwest::blocking::Client,
    token: &str,
) -> Result<(), String> {
    ensure_onedrive_folder(client, token, "Documents", "Galaxie")?;
    ensure_onedrive_folder(
        client,
        token,
        "Documents/Galaxie",
        "AppSettings",
    )
}

fn ensure_onedrive_folder(
    client: &reqwest::blocking::Client,
    token: &str,
    parent_path: &str,
    name: &str,
) -> Result<(), String> {
    let url = format!("{GRAPH}/me/drive/root:/{parent_path}:/children");
    let body = serde_json::json!({
        "name": name,
        "folder": {},
        "@microsoft.graph.conflictBehavior": "fail"
    });
    let resp = graph_enviar("onedrive:settings:mkdir", GRAPH_TETO_ESPERA_S, || {
        client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
    })
    .map_err(|e| format!("falha ao preparar pasta de configuração: {e}"))?;
    let status = resp.status();
    if status.is_success() || status.as_u16() == 409 {
        return Ok(());
    }
    let body = resp.text().unwrap_or_default();
    Err(format!(
        "criação da pasta de configuração retornou {status}: {body}"
    ))
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
    /// A pasta existe, mas o token não tem acesso a ela nesta caixa. O front
    /// mantém a árvore utilizável e mostra o aviso de acesso parcial (#112).
    pub acesso_negado: bool,
}

/// Prefixo do recurso de e-mail no Graph. `None`/`"me"` preserva o caminho
/// pessoal; um endereço vira `/users/{addr}` com o mesmo encode já usado pelas
/// fotos e pela validação de caixas compartilhadas.
fn mailbox_prefix(mailbox: Option<&str>) -> String {
    match mailbox.map(str::trim).filter(|m| !m.is_empty() && *m != "me") {
        Some(addr) => format!("users/{}", urlencoding::encode(addr)),
        None => "me".to_string(),
    }
}

/// #1076 (RB48/LGPD): mascara o local-part de um e-mail pra uso em LOG — mantém só
/// a 1ª letra e o domínio (`fulano@empresa.com` → `f***@empresa.com`). Sem `@` (não
/// parece e-mail), preserva só a 1ª letra. Endereço de contato é PII de cliente
/// real; nunca deve ir em claro pro log.
fn mascarar_email(email: &str) -> String {
    let email = email.trim();
    match email.split_once('@') {
        Some((local, dominio)) if !local.is_empty() => {
            let inicial = local.chars().next().unwrap_or('*');
            format!("{inicial}***@{dominio}")
        }
        _ => {
            let mut chars = email.chars();
            match chars.next() {
                Some(c) => format!("{c}***"),
                None => "***".to_string(),
            }
        }
    }
}

#[cfg(test)]
mod testes_mailbox_prefix {
    use super::{erro_envio, erro_escrita, mailbox_prefix, mascarar_email};

    #[test]
    fn preserva_me_como_default() {
        assert_eq!(mailbox_prefix(None), "me");
        assert_eq!(mailbox_prefix(Some("")), "me");
        assert_eq!(mailbox_prefix(Some("me")), "me");
    }

    #[test]
    fn endereca_e_codifica_caixa_compartilhada() {
        assert_eq!(
            mailbox_prefix(Some(" Financeiro+SP@Empresa.com ")),
            "users/Financeiro%2BSP%40Empresa.com"
        );
    }

    #[test]
    fn escrita_403_nao_vaza_a_caixa_no_erro() {
        // #1076 (RB48/LGPD): o `/{prefix}` de uma caixa compartilhada é
        // `users/<email>` — PII do cliente. A mensagem que vai ao FRONT (toast) NÃO
        // pode conter o endereço; a caixa fica só no log interno.
        let erro = erro_escrita(
            "users/financeiro%40empresa.com",
            "mover mensagem",
            reqwest::StatusCode::FORBIDDEN,
        );
        assert!(erro.contains("sem permissão de escrita"));
        assert!(erro.contains("(403)"));
        assert!(
            !erro.contains("financeiro"),
            "não pode vazar a caixa (PII) no erro: {erro}"
        );
        assert!(
            !erro.contains("users/"),
            "não pode vazar o prefix da caixa: {erro}"
        );
    }

    #[test]
    fn envio_403_nao_vaza_a_caixa_no_erro() {
        let erro = erro_envio(
            "users/financeiro%40empresa.com",
            "envio",
            reqwest::StatusCode::FORBIDDEN,
        );
        assert!(erro.contains("sem permissão para enviar"));
        assert!(erro.contains("(403)"));
        // #1076 (RB48): também aqui a caixa não pode vazar no toast.
        assert!(
            !erro.contains("financeiro"),
            "não pode vazar a caixa (PII) no erro: {erro}"
        );
    }

    #[test]
    fn mascarar_email_preserva_inicial_e_dominio() {
        // #1076 (RB48): local-part vira `x***`, domínio intacto; sem `@` não vaza tudo.
        assert_eq!(mascarar_email("fulano@empresa.com"), "f***@empresa.com");
        assert_eq!(mascarar_email(" Ana.Silva@Cliente.com "), "A***@Cliente.com");
        assert_eq!(mascarar_email("x@y.z"), "x***@y.z");
        assert_eq!(mascarar_email(""), "***");
        // sem '@' não expõe o valor inteiro.
        let m = mascarar_email("naoehemail");
        assert_ne!(m, "naoehemail");
        assert!(m.starts_with('n') && m.ends_with("***"));
    }
}

/// Pastas de e-mail padrão da caixa ativa, com contagens. Mail.Read /
/// Mail.Read.Shared.
pub fn cr_mail_folders(
    store: &TokenStore,
    mailbox: Option<&str>,
) -> Result<Vec<PastaEmail>, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

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
        let mut acesso_negado = false;
        // $expand=childFolders (não $select=childFolderCount): o childFolderCount
        // conta subpastas OCULTAS de sistema (ex.: em Deleted), fazendo aparecer
        // um chevron que expande pra nada. O $expand — como o /childFolders da
        // busca ao expandir — só traz as VISÍVEIS, então `filhos` bate com o que
        // o usuário vê. $top=1 basta pra saber se há ≥1 (chevron sim/não). (#62)
        let url = format!(
            "{GRAPH}/{prefix}/mailFolders/{id}?$select=displayName,unreadItemCount,totalItemCount&$expand=childFolders($select=id;$top=1)"
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
                acesso_negado = resp.status().as_u16() == 403;
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
            acesso_negado,
        });
    }
    Ok(pastas)
}

// ===========================================================================
// Caixas compartilhadas (#111) — adicionar caixa por endereço
// ===========================================================================

/// Resultado da validação de uma caixa compartilhada por endereço (#111). O
/// front decide o que fazer a partir do discriminante `status`:
/// - "ok"             → 200: acesso confirmado, adiciona ao seletor.
/// - "sem_acesso"     → 403 com o escopo presente: sem permissão nessa caixa.
/// - "nao_encontrado" → 404: endereço não existe no tenant.
/// - "precisa_relogin"→ 403 mas o token atual NÃO traz Mail.Read.Shared (sessão
///                      aberta antes do escopo novo): pede relogin, não é falta
///                      de acesso.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidacaoCaixa {
    /// Endereço normalizado (trim + minúsculas) — o que vai pro seletor.
    pub endereco: String,
    pub status: String,
}

/// Verdadeiro se o token ATUAL foi emitido com os escopos de leitura e escrita
/// compartilhadas. Assim uma sessão anterior à #113 pede relogin antes de
/// oferecer mutações que inevitavelmente retornariam 403.
pub fn mail_shared_disponivel(store: &TokenStore) -> Result<bool, String> {
    // Renova se necessário (o refresh reusa o MESMO conjunto de `config::scopes_para`,
    // então um
    // token renovado já reflete o escopo novo sem novo login interativo — desde
    // que o refresh_token original tenha o offline_access, que sempre pedimos).
    access_token(store)?;
    let guard = store
        .inner
        .lock()
        .map_err(|_| "estado de token corrompido".to_string())?;
    let atual = guard.as_ref().ok_or("nao autenticado")?;
    Ok(
        escopo_presente(&atual.scopes, "Mail.Read.Shared")
            && escopo_presente(&atual.scopes, "Mail.ReadWrite.Shared"),
    )
}

/// Verdadeiro se o token ATUAL foi emitido com Mail.Send.Shared (#114).
/// Mantido separado da checagem de leitura/escrita para não bloquear acesso à
/// caixa quando só o novo escopo de envio ainda exige relogin.
pub fn mail_send_shared_disponivel(store: &TokenStore) -> Result<bool, String> {
    access_token(store)?;
    let guard = store
        .inner
        .lock()
        .map_err(|_| "estado de token corrompido".to_string())?;
    let atual = guard.as_ref().ok_or("nao autenticado")?;
    Ok(escopo_presente(&atual.scopes, "Mail.Send.Shared"))
}

/// Checa se um escopo (case-insensitive) está na string `scope` do OAuth (lista
/// separada por espaço). Compara token a token pra não casar por substring.
fn escopo_presente(scopes: &str, alvo: &str) -> bool {
    scopes
        .split_whitespace()
        .any(|s| s.eq_ignore_ascii_case(alvo))
}

/// Valida na hora se o usuário tem acesso a uma caixa por endereço (#111):
/// `GET /users/{addr}/mailFolders/inbox?$select=id`. Reusa o mesmo encode de
/// endereço do `batch_fotos` (urlencoding::encode em `/users/{email}/...`).
///
/// NÃO lista o conteúdo — isso é a #112. Aqui só confirmamos 200/403/404 para
/// adicionar (ou não) a caixa ao seletor.
pub fn cr_validar_caixa(store: &TokenStore, endereco: &str) -> Result<ValidacaoCaixa, String> {
    let addr = endereco.trim().to_lowercase();
    if addr.is_empty() || !addr.contains('@') || !addr.contains('.') {
        return Err("endereco invalido".into());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/users/{}/mailFolders/inbox?$select=id",
        urlencoding::encode(&addr)
    );
    let resp = graph_enviar("mail:validar-caixa", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao validar a caixa: {e}"))?;

    let status = resp.status().as_u16();
    let discriminante = match status {
        200 => "ok",
        403 => {
            // 403 pode ser falta de acesso à caixa OU token sem o escopo novo
            // (sessão anterior ao Mail.Read.Shared). Distinguir olhando o token.
            if mail_shared_disponivel(store).unwrap_or(true) {
                "sem_acesso"
            } else {
                "precisa_relogin"
            }
        }
        404 => "nao_encontrado",
        outro => return Err(format!("resposta inesperada do Graph: {outro}")),
    };
    Ok(ValidacaoCaixa {
        endereco: addr,
        status: discriminante.to_string(),
    })
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
        conversation_id: it["conversationId"].as_str().map(str::to_string),
        conversation_index: it["conversationIndex"].as_str().map(str::to_string),
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

// ---------------------------------------------------------------------------
// Threaded email (#29): prova sem rede de que os dois campos do Graph chegam
// ao contrato camelCase consumido pelo front.
//
// Rodar: cargo test --lib graph::testes_threaded_email
// ---------------------------------------------------------------------------
#[cfg(test)]
mod testes_threaded_email {
    use super::*;

    #[test]
    fn mapeia_conversation_id_e_index_no_contrato_camel_case() {
        let item = serde_json::json!({
            "id": "msg-2",
            "conversationId": "conv-1",
            "conversationIndex": "AAI=",
            "subject": "Re: Planejamento",
            "from": {
                "emailAddress": {
                    "name": "Ana",
                    "address": "ana@example.com"
                }
            },
            "receivedDateTime": "2026-07-29T03:00:00Z",
            "bodyPreview": "Segunda mensagem",
            "isRead": false,
            "hasAttachments": false,
            "flag": { "flagStatus": "notFlagged" }
        });

        let email = montar_email_item(&item, false);
        let serializado = serde_json::to_value(email).expect("EmailItem serializa");

        assert_eq!(serializado["conversationId"], "conv-1");
        assert_eq!(serializado["conversationIndex"], "AAI=");
    }

    #[test]
    fn campos_de_conversa_ausentes_degradam_para_null() {
        let item = serde_json::json!({
            "id": "legado",
            "subject": "Sem metadados",
            "from": {
                "emailAddress": {
                    "name": "Legacy",
                    "address": "legacy@example.com"
                }
            },
            "receivedDateTime": "2026-07-29T02:00:00Z",
            "bodyPreview": "",
            "isRead": true,
            "hasAttachments": false,
            "flag": { "flagStatus": "notFlagged" }
        });

        let email = montar_email_item(&item, false);
        assert!(email.conversation_id.is_none());
        assert!(email.conversation_index.is_none());
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
    mailbox: Option<&str>,
) -> Result<Vec<EmailItem>, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let saida = matches!(folder_id, "sentitems" | "drafts");
    let campo = campo_ordenacao(folder_id, ordenar);
    let dir = if descendente { "desc" } else { "asc" };
    // Página de 50, com $skip para o lazy load (rolar até o fim carrega mais).
    let base = format!(
        "{GRAPH}/{prefix}/mailFolders/{folder_id}/messages\
         ?$select=subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,flag,conversationId,conversationIndex\
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
        return Err(format!(
            "/{prefix}/mailFolders/{folder_id}/messages retornou {}",
            r.status()
        ));
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
    mailbox: Option<&str>,
) -> Result<BuscaPagina, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let saida = matches!(folder_id, "sentitems" | "drafts");
    // Continuação: se veio um nextLink, ele já traz $search+$top+skiptoken —
    // usa-se tal e qual. Só na 1ª página montamos a URL inicial.
    let url = match next_link {
        Some(link) => {
            // Segurança (#1068): o next_link chega do renderer via IPC e é usado com
            // bearer_auth. Um XSS/script injetado poderia mandar uma URL de outro host
            // e exfiltrar o access token delegado. Validamos que a continuação segue
            // DENTRO do Graph ANTES de anexar o token.
            if !url_continuacao_graph_valida(&link) {
                return Err("next_link inválido: continuação fora do Microsoft Graph".to_string());
            }
            link
        }
        None => {
            // As aspas duplas fazem parte da sintaxe do $search; as que vierem no
            // próprio termo são trocadas por espaço para não fechar a expressão
            // antes da hora.
            let termo_limpo = termo.replace('"', " ");
            let enc = urlencoding::encode(termo_limpo.trim());
            // Sem $orderby: o Graph rejeita orderby combinado com $search.
            format!(
                "{GRAPH}/{prefix}/mailFolders/{folder_id}/messages\
                 ?$search=\"{enc}\"\
                 &$select=subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,flag,conversationId,conversationIndex\
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
            "busca em /{prefix}/mailFolders/{folder_id}/messages retornou {}",
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
    mailbox: Option<&str>,
) -> Result<BuscaPagina, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let saida = matches!(folder_id, "sentitems" | "drafts");
    // Campos idênticos aos de cr_buscar/cr_folder_mensagens: a lista fica igual
    // nos três caminhos (montados por montar_email_item).
    const SELECT: &str = "subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,flag,conversationId,conversationIndex";

    // Continuação: o nextLink já traz filtro+select+top+skiptoken embutidos —
    // usa-se tal e qual. Só na 1ª página montamos a URL inicial por filtro.
    let url = match next_link {
        Some(link) => {
            // Segurança (#1068): mesma proteção de cr_buscar — valida o next_link do
            // renderer antes do bearer_auth pra não exfiltrar o token.
            if !url_continuacao_graph_valida(&link) {
                return Err("next_link inválido: continuação fora do Microsoft Graph".to_string());
            }
            link
        }
        None => match filtro {
            "tome" => {
                let email = mailbox
                    .map(str::trim)
                    .filter(|m| !m.is_empty() && *m != "me")
                    .map(str::to_string)
                    .or_else(|| meu_endereco(&client, &token))
                    .ok_or_else(|| {
                        "não foi possível resolver o endereço da caixa ativa".to_string()
                    })?;
                // KQL: restringe à linha To (D5). Aspas do $search fazem parte da
                // sintaxe; o valor vai percent-encodado.
                let kql = format!("to:{email}");
                let enc = urlencoding::encode(&kql);
                format!(
                    "{GRAPH}/{prefix}/mailFolders/{folder_id}/messages\
                     ?$search=\"{enc}\"&$select={SELECT}&$top=50"
                )
            }
            "mentions" => {
                let flt = urlencoding::encode("mentionsPreview/isMentioned eq true");
                format!(
                    "{GRAPH}/{prefix}/mailFolders/{folder_id}/messages\
                     ?$filter={flt}&$select={SELECT}&$top=50"
                )
            }
            "invites" => format!(
                "{GRAPH}/{prefix}/mailFolders/{folder_id}/messages/microsoft.graph.eventMessage\
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
    prefix: &str,
    id: &str,
) -> Result<(), String> {
    let url = format!("{GRAPH}/{prefix}/messages/{id}");
    // Sob o pool + retry central (#64): Retry-After + jitter. 404 = idempotente.
    let resp = graph_enviar("mail:excluir", GRAPH_TETO_ESPERA_S, || {
        client.delete(&url).bearer_auth(token).send()
    })
    .map_err(|e| format!("falha ao excluir o e-mail: {e}"))?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(erro_escrita(prefix, "excluir mensagem", resp.status()))
    }
}

/// Mensagem de erro de escrita para o FRONT. #1076 (RB48/LGPD): NÃO inclui o
/// `/{prefix}` — numa caixa compartilhada o prefix é `users/<email>`, e o endereço
/// é PII do cliente; não pode vazar no toast do usuário. O prefix fica só no log
/// interno (diagnóstico), nunca na string devolvida.
fn erro_escrita(
    prefix: &str,
    operacao: &str,
    status: reqwest::StatusCode,
) -> String {
    log::warn!("[escrita] {operacao} em /{prefix} retornou {status}");
    if status.as_u16() == 403 {
        format!("sem permissão de escrita na caixa ativa (403): {operacao}")
    } else {
        format!("{operacao} na caixa ativa retornou {status}")
    }
}

/// Mensagem de erro de envio para o FRONT. #1076 (RB48/LGPD): mesma regra do
/// `erro_escrita` — o `/{prefix}` (`users/<email>` na caixa compartilhada) é PII e
/// fica só no log interno, nunca no toast.
fn erro_envio(
    prefix: &str,
    operacao: &str,
    status: reqwest::StatusCode,
) -> String {
    log::warn!("[envio] {operacao} em /{prefix} retornou {status}");
    if prefix != "me" && status == reqwest::StatusCode::FORBIDDEN {
        format!("sem permissão para enviar usando a caixa ativa (403): {operacao}")
    } else {
        format!("{operacao} na caixa ativa retornou {status}")
    }
}

fn eh_erro_permissao(erro: &str) -> bool {
    erro.contains("(403)") || erro.contains(" 403") || erro.contains("403 ")
}

/// Move uma mensagem para uma pasta (well-known como "deleteditems" ou id).
/// 404 conta como sucesso (idempotente). Retry no 429. Mail.ReadWrite ou
/// Mail.ReadWrite.Shared, conforme `prefix`.
fn mover_msg(
    client: &reqwest::blocking::Client,
    token: &str,
    prefix: &str,
    id: &str,
    destino: &str,
) -> Result<(), String> {
    let url = format!("{GRAPH}/{prefix}/messages/{id}/move");
    let body = serde_json::json!({ "destinationId": destino });
    // Sob o pool + retry central (#64): Retry-After + jitter. 404 = idempotente.
    let resp = graph_enviar("mail:mover", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(token).json(&body).send()
    })
    .map_err(|e| format!("falha ao mover o e-mail: {e}"))?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(erro_escrita(prefix, "mover mensagem", resp.status()))
    }
}

/// Exclui um e-mail (move para a Lixeira; recuperável). Mail.ReadWrite.
pub fn cr_excluir_email(
    store: &TokenStore,
    id: &str,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    mover_msg(&client, &token, &prefix, id, "deleteditems")
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
    mailbox: Option<&str>,
) -> Result<Vec<String>, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let mut ok = Vec::with_capacity(ids.len());
    for id in &ids {
        let r = if permanente {
            deletar_msg(&client, &token, &prefix, id)
        } else {
            mover_msg(&client, &token, &prefix, id, "deleteditems")
        };
        match r {
            Ok(()) => ok.push(id.clone()),
            Err(e) if eh_erro_permissao(&e) => return Err(e),
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
    mailbox: Option<&str>,
) -> Result<Vec<String>, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let mut ok = Vec::with_capacity(ids.len());
    for id in &ids {
        match mover_msg(&client, &token, &prefix, id, &destino) {
            Ok(()) => ok.push(id.clone()),
            Err(e) if eh_erro_permissao(&e) => return Err(e),
            Err(e) => log::warn!("[mail] mover '{id}' para '{destino}' falhou: {e}"),
        }
    }
    Ok(ok)
}

/// Sinaliza ou remove a sinalização de um e-mail. Mail.ReadWrite.
pub fn cr_marcar_email(
    store: &TokenStore,
    id: &str,
    sinalizado: bool,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let status = if sinalizado { "flagged" } else { "notFlagged" };
    let patch = serde_json::json!({ "flag": { "flagStatus": status } });

    let url = format!("{GRAPH}/{prefix}/messages/{id}");
    // Sob o pool + retry central (#64): Retry-After + jitter. Escrita idempotente:
    // grava um flagStatus FIXO ("flagged"/"notFlagged"), e o retry do pool só
    // dispara em 429 (rejeitado antes de aplicar) — reenviar deixa o mesmo estado.
    let resp = graph_enviar("mail:sinalizar", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&patch).send()
    })
    .map_err(|e| format!("falha ao sinalizar o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita(&prefix, "sinalizar mensagem", resp.status()));
    }
    Ok(())
}

/// Marca um e-mail como lido ou não lido (PATCH isRead). Retry no 429
/// respeitando Retry-After, até 3 tentativas. Mail.ReadWrite.
pub fn cr_marcar_lido(
    store: &TokenStore,
    id: &str,
    lido: bool,
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let patch = serde_json::json!({ "isRead": lido });
    let url = format!("{GRAPH}/{prefix}/messages/{id}");
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let resp = graph_enviar("mail:marcar-lido", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&patch).send()
    })
    .map_err(|e| format!("falha ao marcar como lido: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(erro_escrita(&prefix, "marcar mensagem como lida", resp.status()))
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
/// #788: no esvaziar em lote, um DELETE conta como sucesso se apagou (2xx) OU se
/// o item já não existia (404/410) — idempotente, pra um item já removido não
/// abortar o resto do "empty".
fn delete_status_ok(status: u64) -> bool {
    (200..300).contains(&status) || status == 404 || status == 410
}

pub fn cr_esvaziar_pasta(
    store: &TokenStore,
    folder_id: &str,
    mailbox: Option<&str>,
) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let mut apagados: u64 = 0;
    // #788: logar o ciclo da mutação (antes não aparecia no GALAXIE.log).
    log::info!(
        "[mail] esvaziar '{folder_id}' (mailbox={}): iniciando",
        mailbox.unwrap_or("me")
    );

    loop {
        let url =
            format!("{GRAPH}/{prefix}/mailFolders/{folder_id}/messages?$select=id&$top=50");
        // Sob o pool + retry central (#64): Retry-After + jitter.
        let resp = graph_enviar("mail:esvaziar", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        })
        .map_err(|e| format!("falha ao ler a pasta: {e}"))?;
        if !resp.status().is_success() {
            return Err(erro_escrita(&prefix, "ler pasta para esvaziar", resp.status()));
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

        // #788: apaga em LOTE ($batch, 20 DELETEs por request) — o 1-a-1 era o
        // gargalo (esvaziar "demorou muito"). 404/410 = item já saiu (idempotente,
        // conta como sucesso); assim um item já removido não aborta o resto.
        let mut progrediu = false;
        for chunk in ids.chunks(20) {
            let requests: Vec<serde_json::Value> = chunk
                .iter()
                .enumerate()
                .map(|(i, id)| {
                    serde_json::json!({
                        "id": i.to_string(),
                        "method": "DELETE",
                        "url": format!("/{prefix}/messages/{}", urlencoding::encode(id)),
                    })
                })
                .collect();
            let batch_body = serde_json::json!({ "requests": requests });
            let resp = graph_enviar("mail:esvaziar:batch", GRAPH_TETO_ESPERA_S, || {
                client
                    .post(format!("{GRAPH}/$batch"))
                    .bearer_auth(&token)
                    .json(&batch_body)
                    .send()
            })
            .map_err(|e| format!("falha no $batch ao esvaziar: {e}"))?;
            if !resp.status().is_success() {
                log::error!(
                    "[mail] esvaziar '{folder_id}': $batch retornou {}",
                    resp.status()
                );
                return Err(erro_escrita(&prefix, "esvaziar pasta (batch)", resp.status()));
            }
            let value: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
            for item in value["responses"].as_array().into_iter().flatten() {
                let status = item["status"].as_u64().unwrap_or_default();
                if delete_status_ok(status) {
                    apagados += 1;
                    progrediu = true;
                } else {
                    log::warn!(
                        "[mail] esvaziar '{folder_id}': item do batch com status {status}"
                    );
                }
            }
            if apagados >= CR_PASTA_LIMITE {
                log::warn!(
                    "[mail] esvaziar '{folder_id}': limite de {CR_PASTA_LIMITE} atingido, interrompendo"
                );
                return Ok(apagados);
            }
        }
        // Página inteira sem sair nada: evita reler as mesmas em loop infinito.
        if !progrediu {
            log::warn!("[mail] esvaziar '{folder_id}': página sem progresso, interrompendo");
            break;
        }
    }

    log::info!("[mail] esvaziar '{folder_id}': concluído, {apagados} mensagens apagadas");
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
pub fn cr_marcar_pasta_lida(
    store: &TokenStore,
    folder_id: &str,
    mailbox: Option<&str>,
) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let filtro = urlencoding::encode("isRead eq false");
    let patch = serde_json::json!({ "isRead": true });
    let mut marcadas: u64 = 0;

    loop {
        let url = format!(
            "{GRAPH}/{prefix}/mailFolders/{folder_id}/messages?$filter={filtro}&$select=id&$top=50"
        );
        // Sob o pool + retry central (#64): Retry-After + jitter.
        let resp = graph_enviar("mail:marcar-pasta-lida", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        })
        .map_err(|e| format!("falha ao ler a pasta: {e}"))?;
        if !resp.status().is_success() {
            return Err(erro_escrita(
                &prefix,
                "ler pasta para marcar como lida",
                resp.status(),
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
            let msg_url = format!("{GRAPH}/{prefix}/messages/{id}");
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
                Ok(resp) if resp.status().as_u16() == 403 => {
                    return Err(erro_escrita(
                        &prefix,
                        "marcar pasta como lida",
                        resp.status(),
                    ));
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

/// Endereco de e-mail normalizado para o modulo People (#166).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleEmail {
    pub address: String,
    #[serde(default)]
    pub label: Option<String>,
}

/// Telefone normalizado para o modulo People (#166).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeoplePhone {
    pub number: String,
    pub label: String,
}

/// Registro cru de uma das duas fontes do Graph. O merge/dedupe por e-mail
/// acontece no front, onde este mesmo modelo alimenta a lista e o resolver
/// compartilhado dos futuros pontos de entrada do People.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleRecord {
    pub id: String,
    pub source: String,
    pub name: String,
    pub emails: Vec<PeopleEmail>,
    pub phones: Vec<PeoplePhone>,
    pub job_title: Option<String>,
    pub company: Option<String>,
    pub department: Option<String>,
    pub office_location: Option<String>,
    pub manager: Option<String>,
    pub organization: bool,
    pub people_rank: Option<usize>,
    /// Categorias do Outlook do contato (#406). Só `source=="contacts"` (o
    /// endpoint /me/people não expõe categories). Vazio caso contrário.
    #[serde(default)]
    pub categories: Vec<String>,
}

/// Resultado estruturado: uma fonte pode falhar sem esconder os dados da outra.
/// 401/403 viram escopos ausentes para a UI oferecer o fluxo de consentimento
/// existente de forma explicita; demais falhas continuam visiveis e retentaveis.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleListResult {
    pub records: Vec<PeopleRecord>,
    pub missing_scopes: Vec<String>,
    pub failures: Vec<String>,
    pub next_links: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleTenantOrganization {
    pub id: String,
    pub name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleOrganizationResult {
    pub organization: Option<PeopleTenantOrganization>,
    pub missing_scopes: Vec<String>,
    pub failures: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleDirectoryResult {
    pub records: Vec<PeopleRecord>,
    pub missing_scopes: Vec<String>,
    pub failures: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleGroup {
    pub id: String,
    pub name: String,
    /// #578: descrição do grupo (M365 `description`), pro detalhe. Vazio se ausente.
    pub description: String,
    /// #578 rework: e-mail do grupo (M365 `mail`) — vazio em security group sem mail.
    pub mail: String,
    /// #578 rework: `Public`/`Private` (M365 `visibility`); vazio em security group.
    pub visibility: String,
    pub member_count: Option<usize>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleGroupsResult {
    pub groups: Vec<PeopleGroup>,
    pub missing_scopes: Vec<String>,
    pub failures: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleGroupMembersResult {
    pub records: Vec<PeopleRecord>,
    pub member_count: usize,
}

fn texto_opcional(item: &serde_json::Value, campo: &str) -> Option<String> {
    item[campo]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn emails_de_contato(item: &serde_json::Value) -> Vec<PeopleEmail> {
    item["emailAddresses"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|email| {
            let address = email["address"].as_str()?.trim();
            if address.is_empty() {
                return None;
            }
            Some(PeopleEmail {
                address: address.to_string(),
                label: texto_opcional(email, "name"),
            })
        })
        .collect()
}

fn telefones_de_contato(item: &serde_json::Value) -> Vec<PeoplePhone> {
    let mut phones = Vec::new();
    let mut push_many = |campo: &str, label: &str| {
        if let Some(values) = item[campo].as_array() {
            for value in values {
                if let Some(number) = value.as_str().map(str::trim).filter(|v| !v.is_empty()) {
                    phones.push(PeoplePhone {
                        number: number.to_string(),
                        label: label.to_string(),
                    });
                }
            }
        }
    };
    push_many("businessPhones", "work");
    push_many("homePhones", "home");
    if let Some(number) = item["mobilePhone"]
        .as_str()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        phones.push(PeoplePhone {
            number: number.to_string(),
            label: "mobile".to_string(),
        });
    }
    phones
}

fn emails_de_people(item: &serde_json::Value) -> Vec<PeopleEmail> {
    let mut emails: Vec<PeopleEmail> = item["scoredEmailAddresses"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|email| {
            let address = email["address"].as_str()?.trim();
            if address.is_empty() {
                return None;
            }
            Some(PeopleEmail {
                address: address.to_string(),
                label: None,
            })
        })
        .collect();
    if emails.is_empty() {
        if let Some(address) = item["userPrincipalName"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            emails.push(PeopleEmail {
                address: address.to_string(),
                label: None,
            });
        }
    }
    emails
}

fn telefones_de_people(item: &serde_json::Value) -> Vec<PeoplePhone> {
    item["phones"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|phone| {
            let number = phone["number"].as_str()?.trim();
            if number.is_empty() {
                return None;
            }
            Some(PeoplePhone {
                number: number.to_string(),
                label: phone["type"].as_str().unwrap_or("other").to_string(),
            })
        })
        .collect()
}

fn registro_de_usuario_do_diretorio(item: &serde_json::Value) -> Option<PeopleRecord> {
    let id = item["id"].as_str()?.trim();
    let address = item["mail"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            item["userPrincipalName"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })?;
    if id.is_empty() {
        return None;
    }

    let name = item["displayName"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(address);
    Some(PeopleRecord {
        id: id.to_string(),
        source: "directory".to_string(),
        name: name.to_string(),
        emails: vec![PeopleEmail {
            address: address.to_string(),
            label: None,
        }],
        phones: telefones_de_contato(item),
        job_title: texto_opcional(item, "jobTitle"),
        company: texto_opcional(item, "companyName"),
        department: texto_opcional(item, "department"),
        office_location: texto_opcional(item, "officeLocation"),
        manager: None,
        organization: true,
        people_rank: None,
        categories: Vec::new(),
    })
}

fn url_continuacao_graph_valida(url: &str) -> bool {
    url.strip_prefix(GRAPH)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

/// `/me/people` mistura pessoas e objetos mail-enabled. `personType.class` é o
/// sinal canônico do Graph para excluir Teams, listas de distribuição e sites
/// SharePoint respaldados por Microsoft 365 Groups da lista de pessoas (#281).
fn eh_grupo_de_people(item: &serde_json::Value) -> bool {
    item["personType"]["class"]
        .as_str()
        .is_some_and(|class| class.eq_ignore_ascii_case("Group"))
}

#[cfg(test)]
mod testes_people_person_type {
    use super::eh_grupo_de_people;

    #[test]
    fn exclui_group_independente_de_caixa_e_subclasse() {
        for class in ["Group", "group", "GROUP"] {
            let item = serde_json::json!({
                "personType": {
                    "class": class,
                    "subclass": "OrganizationUser"
                }
            });
            assert!(eh_grupo_de_people(&item));
        }
    }

    #[test]
    fn preserva_pessoa_e_registro_sem_person_type() {
        let pessoa = serde_json::json!({
            "personType": {
                "class": "Person",
                "subclass": "OrganizationUser"
            }
        });
        assert!(!eh_grupo_de_people(&pessoa));
        assert!(!eh_grupo_de_people(&serde_json::json!({})));
    }
}

#[cfg(test)]
mod testes_people_directory {
    use super::{registro_de_usuario_do_diretorio, url_continuacao_graph_valida};

    #[test]
    fn normaliza_usuario_do_diretorio_com_campos_do_people() {
        let item = serde_json::json!({
            "id": " user-1 ",
            "displayName": " Ada Lovelace ",
            "mail": " ada@example.com ",
            "userPrincipalName": "ada@example.onmicrosoft.com",
            "businessPhones": [" +44 20 7946 0958 "],
            "mobilePhone": " +44 7700 900123 ",
            "jobTitle": " Architect ",
            "companyName": " Analytical Engines ",
            "department": " Research ",
            "officeLocation": " London "
        });

        let record = registro_de_usuario_do_diretorio(&item).expect("usuario valido");
        assert_eq!(record.id, "user-1");
        assert_eq!(record.source, "directory");
        assert_eq!(record.name, "Ada Lovelace");
        assert_eq!(record.emails[0].address, "ada@example.com");
        assert_eq!(record.phones.len(), 2);
        assert_eq!(record.job_title.as_deref(), Some("Architect"));
        assert_eq!(record.company.as_deref(), Some("Analytical Engines"));
        assert_eq!(record.department.as_deref(), Some("Research"));
        assert_eq!(record.office_location.as_deref(), Some("London"));
        assert!(record.organization);
    }

    #[test]
    fn usa_upn_quando_mail_esta_vazio_e_descarta_usuario_sem_endereco() {
        let com_upn = serde_json::json!({
            "id": "user-2",
            "displayName": "",
            "mail": " ",
            "userPrincipalName": "grace@example.com"
        });
        let record = registro_de_usuario_do_diretorio(&com_upn).expect("upn valido");
        assert_eq!(record.name, "grace@example.com");
        assert_eq!(record.emails[0].address, "grace@example.com");

        let sem_endereco = serde_json::json!({
            "id": "user-3",
            "displayName": "Sem endereço"
        });
        assert!(registro_de_usuario_do_diretorio(&sem_endereco).is_none());
    }

    #[test]
    fn aceita_apenas_continuacao_dentro_do_graph_v1() {
        assert!(url_continuacao_graph_valida(
            "https://graph.microsoft.com/v1.0/users?$skiptoken=abc"
        ));
        assert!(!url_continuacao_graph_valida(
            "https://graph.microsoft.com/v1.0.evil.example/users"
        ));
        assert!(!url_continuacao_graph_valida(
            "https://example.com/v1.0/users"
        ));
    }
}

#[cfg(test)]
mod testes_next_link_1068 {
    //! #1068 — o `next_link` (paginação) chega do renderer via IPC e é usado com
    //! `bearer_auth` em 6 pontos (cr_buscar, cr_filtrar, cr_grupos, cr_grupo_membros,
    //! cr_contact_folders, cr_pasta_contatos). Se a URL apontar pra fora do Graph, o
    //! access token delegado vaza. A guarda tem que rejeitar ANTES do bearer_auth.
    use super::{url_continuacao_graph_valida, GRAPH};

    /// Vetores de exfiltração que a guarda DEVE rejeitar. Inclui os dois formatos que
    /// o relatório de auditoria chama por nome.
    const MALICIOSOS: &[&str] = &[
        // sufixo colado no host — passa numa checagem ingênua de "contém graph.microsoft.com"
        "https://graph.microsoft.com.evil.example/v1.0/users",
        // sufixo colado no PATH v1.0 — este é o que fura a guarda fraca `starts_with(GRAPH)`
        "https://graph.microsoft.com/v1.0.evil.example/users",
        // userinfo trick: host real é evil.example
        "https://graph.microsoft.com@evil.example/v1.0/users",
        // host totalmente diferente
        "https://evil.example/v1.0/users",
        // downgrade de esquema
        "http://graph.microsoft.com/v1.0/users",
    ];

    #[test]
    fn rejeita_todos_os_vetores_de_exfiltracao() {
        for u in MALICIOSOS {
            assert!(
                !url_continuacao_graph_valida(u),
                "next_link malicioso passou pela guarda (exfiltra token): {u}"
            );
        }
    }

    #[test]
    fn aceita_continuacao_legitima_do_graph() {
        // não pode regredir a paginação real devolvida pelo próprio Graph.
        for u in [
            "https://graph.microsoft.com/v1.0/users?$skiptoken=abc",
            "https://graph.microsoft.com/v1.0/me/contactFolders/AAA/contacts?$skip=100",
            "https://graph.microsoft.com/v1.0/me/memberOf?$skiptoken=xyz",
        ] {
            assert!(
                url_continuacao_graph_valida(u),
                "continuação legítima do Graph foi rejeitada (regressão): {u}"
            );
        }
    }

    /// PROVA da vulnerabilidade que motivou o #1068: a guarda fraca `starts_with(GRAPH)`,
    /// usada em 4 dos 6 pontos, ACEITA o bypass `v1.0.evil.example` — enviaria o token
    /// pro atacante. A guarda forte (aplicada agora) o rejeita. Este teste ficaria
    /// VERMELHO se alguém revertesse pro `starts_with(GRAPH)`.
    #[test]
    fn guarda_fraca_starts_with_era_exploravel() {
        let bypass = "https://graph.microsoft.com/v1.0.evil.example/users";
        assert!(
            bypass.starts_with(GRAPH),
            "pré-condição: o bypass passava pela guarda fraca"
        );
        assert!(
            !url_continuacao_graph_valida(bypass),
            "a guarda forte tem que fechar o bypass que a fraca deixava passar"
        );
    }
}

/// Lista inicial do People (#166): contatos explicitos + pessoas relevantes.
/// Mantem as fontes separadas para o merge deterministico no front e preserva a
/// ordem de relevancia de `/me/people` via `people_rank`.
pub fn cr_people_list(
    store: &TokenStore,
    next_links: Vec<String>,
    mailbox: Option<&str>,
) -> Result<PeopleListResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let mut result = PeopleListResult {
        records: Vec::new(),
        missing_scopes: Vec::new(),
        failures: Vec::new(),
        next_links: Vec::new(),
    };

    // #495: caixa própria = /me (contatos + relevância "people"); caixa
    // COMPARTILHADA = só /users/{addr}/contacts. O "/me/people" é a relevância do
    // usuário LOGADO (não da caixa) e "/users/{addr}/people" exigiria
    // People.Read.All (não concedido) — então pra caixa compartilhada mostramos
    // apenas os contatos reais daquela caixa.
    let prefix = mailbox_prefix(mailbox);
    let base = format!("{GRAPH}/{prefix}/");
    let requests: Vec<(&str, String)> = if next_links.is_empty() {
        let mut reqs = vec![(
            "contacts",
            format!(
                "{base}contacts?$top=100&$select=id,displayName,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle,department,officeLocation,manager,categories"
            ),
        )];
        if mailbox_prefix(mailbox) == "me" {
            reqs.push((
                "people",
                format!(
                    "{GRAPH}/me/people?$top=100&$select=id,displayName,scoredEmailAddresses,phones,companyName,jobTitle,personType,userPrincipalName"
                ),
            ));
        }
        reqs
    } else {
        next_links
            .into_iter()
            .filter_map(|url| {
                if !url.starts_with(&base) {
                    return None;
                }
                if url.contains("/contacts?") {
                    Some(("contacts", url))
                } else if url.contains("/people?") {
                    Some(("people", url))
                } else {
                    None
                }
            })
            .collect()
    };

    for (source, url) in requests {
        let label = if source == "contacts" {
            "Contacts"
        } else {
            "People"
        };
        match graph_enviar(
            if source == "contacts" {
                "people:contacts"
            } else {
                "people:relevant"
            },
            GRAPH_TETO_ESPERA_S,
            || client.get(&url).bearer_auth(&token).send(),
        ) {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
                Ok(body) => {
                    if let Some(next_link) = body["@odata.nextLink"].as_str() {
                        result.next_links.push(next_link.to_string());
                    }
                    if let Some(items) = body["value"].as_array() {
                        if source == "contacts" {
                            result.records.extend(items.iter().filter_map(|item| {
                                let emails = emails_de_contato(item);
                                if emails.is_empty() {
                                    return None;
                                }
                                Some(PeopleRecord {
                                    id: item["id"].as_str().unwrap_or("").to_string(),
                                    source: "contacts".to_string(),
                                    name: item["displayName"]
                                        .as_str()
                                        .unwrap_or("")
                                        .trim()
                                        .to_string(),
                                    emails,
                                    phones: telefones_de_contato(item),
                                    job_title: texto_opcional(item, "jobTitle"),
                                    company: texto_opcional(item, "companyName"),
                                    department: texto_opcional(item, "department"),
                                    office_location: texto_opcional(item, "officeLocation"),
                                    manager: texto_opcional(item, "manager"),
                                    organization: false,
                                    people_rank: None,
                                    categories: item["categories"]
                                        .as_array()
                                        .map(|arr| {
                                            arr.iter()
                                                .filter_map(|c| {
                                                    c.as_str().map(|s| s.to_string())
                                                })
                                                .collect()
                                        })
                                        .unwrap_or_default(),
                                })
                            }));
                        } else {
                            let is_first_page = url.contains("/me/people?$top=");
                            result.records.extend(items.iter().enumerate().filter_map(
                                |(rank, item)| {
                                    if eh_grupo_de_people(item) {
                                        return None;
                                    }
                                    let emails = emails_de_people(item);
                                    if emails.is_empty() {
                                        return None;
                                    }
                                    let person_type = &item["personType"];
                                    let organization = person_type["subclass"]
                                        .as_str()
                                        .or_else(|| person_type["class"].as_str())
                                        .is_some_and(|value| {
                                            value.eq_ignore_ascii_case("OrganizationUser")
                                        });
                                    Some(PeopleRecord {
                                        id: item["id"].as_str().unwrap_or("").to_string(),
                                        source: "people".to_string(),
                                        name: item["displayName"]
                                            .as_str()
                                            .unwrap_or("")
                                            .trim()
                                            .to_string(),
                                        emails,
                                        phones: telefones_de_people(item),
                                        job_title: texto_opcional(item, "jobTitle"),
                                        company: texto_opcional(item, "companyName"),
                                        department: None,
                                        office_location: None,
                                        manager: None,
                                        organization,
                                        people_rank: is_first_page.then_some(rank),
                                        categories: Vec::new(),
                                    })
                                },
                            ));
                        }
                    }
                }
                Err(error) => result
                    .failures
                    .push(format!("{label}: resposta invalida ({error})")),
            },
            Ok(resp) if matches!(resp.status().as_u16(), 401 | 403) => {
                result.missing_scopes.push(format!("{label}.Read"));
            }
            Ok(resp) => result
                .failures
                .push(format!("{label}: Graph retornou {}", resp.status())),
            Err(error) => result
                .failures
                .push(format!("{label}: falha de rede ({error})")),
        }
    }

    Ok(result)
}

/// Organização do tenant atual, usando o nome canônico do Microsoft Graph.
pub fn cr_organizacao(store: &TokenStore) -> Result<PeopleOrganizationResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let mut result = PeopleOrganizationResult {
        organization: None,
        missing_scopes: Vec::new(),
        failures: Vec::new(),
    };
    let url = format!("{GRAPH}/organization?$select=id,displayName");

    match graph_enviar("people:organization", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    }) {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
            Ok(body) => {
                let organization = body["value"].as_array().and_then(|items| {
                    items.iter().find_map(|item| {
                        let id = item["id"].as_str()?.trim();
                        let name = item["displayName"].as_str()?.trim();
                        if id.is_empty() || name.is_empty() {
                            return None;
                        }
                        Some(PeopleTenantOrganization {
                            id: id.to_string(),
                            name: name.to_string(),
                        })
                    })
                });
                if organization.is_none() {
                    result
                        .failures
                        .push("Organization: resposta sem organização válida".to_string());
                }
                result.organization = organization;
            }
            Err(error) => result
                .failures
                .push(format!("Organization: resposta invalida ({error})")),
        },
        Ok(resp) => result
            .failures
            .push(format!("Organization: Graph retornou {}", resp.status())),
        Err(error) => result
            .failures
            .push(format!("Organization: falha de rede ({error})")),
    }

    Ok(result)
}

/// Snapshot completo dos usuários do tenant. A paginação é consumida no
/// backend para que a hidratação de sessão não dependa da máquina nem de cache
/// local e nunca exponha uma lista silenciosamente truncada.
pub fn cr_people_directory(store: &TokenStore) -> Result<PeopleDirectoryResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let mut result = PeopleDirectoryResult {
        records: Vec::new(),
        missing_scopes: Vec::new(),
        failures: Vec::new(),
    };
    let mut proxima = Some(format!(
        "{GRAPH}/users?$top=999&$select=id,displayName,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,companyName,department,officeLocation"
    ));
    let mut paginas_visitadas = std::collections::HashSet::new();

    while let Some(url) = proxima.take() {
        if !url_continuacao_graph_valida(&url) {
            result
                .failures
                .push("Directory: continuation URL outside Microsoft Graph".to_string());
            break;
        }
        if !paginas_visitadas.insert(url.clone()) {
            result
                .failures
                .push("Directory: continuation URL repeated".to_string());
            break;
        }
        match graph_enviar("people:directory", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => {
                let body = match resp.json::<serde_json::Value>() {
                    Ok(body) => body,
                    Err(error) => {
                        result
                            .failures
                            .push(format!("Directory: resposta invalida ({error})"));
                        break;
                    }
                };
                proxima = body["@odata.nextLink"].as_str().map(str::to_string);
                let Some(items) = body["value"].as_array() else {
                    result
                        .failures
                        .push("Directory: resposta sem coleção de usuários".to_string());
                    break;
                };
                result
                    .records
                    .extend(items.iter().filter_map(registro_de_usuario_do_diretorio));
            }
            Ok(resp) if matches!(resp.status().as_u16(), 401 | 403) => {
                result.missing_scopes.push("User.Read.All".to_string());
                break;
            }
            Ok(resp) => {
                result
                    .failures
                    .push(format!("Directory: Graph retornou {}", resp.status()));
                break;
            }
            Err(error) => {
                result
                    .failures
                    .push(format!("Directory: falha de rede ({error})"));
                break;
            }
        }
    }

    result
        .records
        .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result.records.dedup_by(|a, b| a.id == b.id);
    Ok(result)
}

/// Grupos M365/security aos quais o usuário atual pertence diretamente (#293).
/// A lista não dispara N+1: a contagem fica ausente até `cr_grupo_membros`.
pub fn cr_grupos(store: &TokenStore) -> Result<PeopleGroupsResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let mut result = PeopleGroupsResult {
        groups: Vec::new(),
        missing_scopes: Vec::new(),
        failures: Vec::new(),
    };
    let mut proxima = Some(format!(
        "{GRAPH}/me/memberOf?$top=999&$select=id,displayName,description,mail,visibility,groupTypes,mailEnabled,securityEnabled"
    ));

    while let Some(url) = proxima.take() {
        // Segurança (#1068): guarda forte (host exato do Graph). `starts_with(GRAPH)`
        // deixava passar `https://graph.microsoft.com/v1.0.evil.example/...` e exfiltrava
        // o token; `url_continuacao_graph_valida` exige o `/` logo após o v1.0.
        if !url_continuacao_graph_valida(&url) {
            result
                .failures
                .push("Groups: continuation URL outside Microsoft Graph".to_string());
            break;
        }
        match graph_enviar("people:groups", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => {
                let body = match resp.json::<serde_json::Value>() {
                    Ok(body) => body,
                    Err(error) => {
                        result
                            .failures
                            .push(format!("Groups: resposta invalida ({error})"));
                        break;
                    }
                };
                proxima = body["@odata.nextLink"].as_str().map(str::to_string);
                if let Some(items) = body["value"].as_array() {
                    result.groups.extend(items.iter().filter_map(|item| {
                        let is_group = item["@odata.type"]
                            .as_str()
                            .is_some_and(|kind| kind.eq_ignore_ascii_case("#microsoft.graph.group"));
                        if !is_group {
                            return None;
                        }
                        let id = item["id"].as_str()?.trim();
                        let name = item["displayName"].as_str()?.trim();
                        if id.is_empty() || name.is_empty() {
                            return None;
                        }
                        Some(PeopleGroup {
                            id: id.to_string(),
                            name: name.to_string(),
                            description: item["description"]
                                .as_str()
                                .unwrap_or("")
                                .trim()
                                .to_string(),
                            mail: item["mail"].as_str().unwrap_or("").trim().to_string(),
                            visibility: item["visibility"]
                                .as_str()
                                .unwrap_or("")
                                .trim()
                                .to_string(),
                            member_count: None,
                        })
                    }));
                }
            }
            Ok(resp) if matches!(resp.status().as_u16(), 401 | 403) => {
                result
                    .missing_scopes
                    .push("Directory.Read.All".to_string());
                break;
            }
            Ok(resp) => {
                result
                    .failures
                    .push(format!("Groups: Graph retornou {}", resp.status()));
                break;
            }
            Err(error) => {
                result
                    .failures
                    .push(format!("Groups: falha de rede ({error})"));
                break;
            }
        }
    }

    result
        .groups
        .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result.groups.dedup_by(|a, b| a.id == b.id);
    Ok(result)
}

/// Usuários membros de um grupo M365. Carregado somente ao selecionar o grupo,
/// preservando completude sem fazer uma chamada por grupo no sidebar (#293).
pub fn cr_grupo_membros(
    store: &TokenStore,
    group_id: &str,
) -> Result<PeopleGroupMembersResult, String> {
    let group_id = group_id.trim();
    if group_id.is_empty() {
        return Err("Group id is required.".to_string());
    }

    let token = access_token(store)?;
    let client = cliente();
    let mut records = Vec::new();
    let mut proxima = Some(format!(
        "{GRAPH}/groups/{}/members/microsoft.graph.user?$top=999&$select=id,displayName,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,companyName,department,officeLocation",
        urlencoding::encode(group_id)
    ));

    while let Some(url) = proxima.take() {
        // Segurança (#1068): guarda forte contra next_link fora do Graph (ver cr_grupos).
        if !url_continuacao_graph_valida(&url) {
            return Err("Groups: continuation URL outside Microsoft Graph".to_string());
        }
        let resp = graph_enviar("people:group-members", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        })
        .map_err(|error| format!("Group members: falha de rede ({error})"))?;
        if !resp.status().is_success() {
            return Err(format!("Group members: Graph retornou {}", resp.status()));
        }
        let body = resp
            .json::<serde_json::Value>()
            .map_err(|error| format!("Group members: resposta invalida ({error})"))?;
        proxima = body["@odata.nextLink"].as_str().map(str::to_string);
        if let Some(items) = body["value"].as_array() {
            records.extend(items.iter().filter_map(registro_de_usuario_do_diretorio));
        }
    }

    records.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    records.dedup_by(|a, b| a.id == b.id);
    let member_count = records.len();
    Ok(PeopleGroupMembersResult {
        records,
        member_count,
    })
}

/// Campo individual e revisavel sugerido pelo Enrich (#167).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleEnrichField {
    pub key: String,
    pub value: String,
    pub source: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleEnrichPreview {
    pub fields: Vec<PeopleEnrichField>,
    pub failures: Vec<String>,
    pub write_available: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleEnrichApplyResult {
    pub saved: bool,
    pub write_available: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleContactEdit {
    pub name: String,
    pub emails: Vec<PeopleEmail>,
    pub phones: Vec<PeoplePhone>,
    #[serde(default)]
    pub company: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleInteraction {
    pub id: String,
    pub subject: String,
    pub occurred_at: String,
    pub direction: String,
}

fn token_tem_escopo(store: &TokenStore, alvo: &str) -> Result<bool, String> {
    let guard = store
        .inner
        .lock()
        .map_err(|_| "estado de token corrompido".to_string())?;
    let atual = guard.as_ref().ok_or("nao autenticado")?;
    Ok(escopo_presente(&atual.scopes, alvo))
}

pub fn cr_people_write_available(store: &TokenStore) -> Result<bool, String> {
    token_tem_escopo(store, "Contacts.ReadWrite")
}

/// #186 (Atoms S4): o token carrega `Chat.Read`? Gate do widget de chats do
/// Teams — sem o escopo, o widget mostra o affordance "Conectar o Teams" (consent
/// explícito), nunca dispara consent silencioso nem quebra.
pub fn cr_teams_disponivel(store: &TokenStore) -> Result<bool, String> {
    token_tem_escopo(store, "Chat.Read")
}

/// #206 (Org Admin S1): o token carrega os escopos de settings org-wide? Gate do
/// painel Organization — só habilita pra quem tem admin consent + relogou depois
/// de os escopos entrarem na `config::SCOPES_ORG`. Checa um escopo representativo do
/// conjunto OrgSettings (todos entram/saem juntos no mesmo consent).
pub fn cr_org_admin_available(store: &TokenStore) -> Result<bool, String> {
    token_tem_escopo(store, "OrgSettings-AppsAndServices.Read.All")
}

// ---------------------------------------------------------------------------
// #425 (Org Admin S2): cartões READ-ONLY de OrgSettings. Cada GET é independente
// e degrada sozinho — 403 → "forbidden" (sem o escopo daquele card), rede/parse
// → "error", 200 → "ok". O painel já é gated pelo `cr_org_admin_available` (S1).
// Endpoints (verificados na doc do Graph):
//   • beta/admin/appsAndServices                       (OrgSettings-AppsAndServices.Read.All)
//   • beta/admin/forms                                  (OrgSettings-Forms.Read.All)
//   • v1.0/admin/microsoft365Apps/installationOptions   (OrgSettings-Microsoft365Install.Read.All)
// appsAndServices/forms embrulham em `value.settings`; o M365 Install vem na raiz.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsAndServicesCard {
    /// "ok" | "forbidden" | "error"
    pub status: String,
    pub is_office_store_enabled: Option<bool>,
    pub is_app_and_services_trial_enabled: Option<bool>,
}

impl AppsAndServicesCard {
    fn vazio(status: &str) -> Self {
        Self {
            status: status.to_string(),
            is_office_store_enabled: None,
            is_app_and_services_trial_enabled: None,
        }
    }
    fn dos_settings(s: &serde_json::Value) -> Self {
        Self {
            status: "ok".to_string(),
            is_office_store_enabled: s["isOfficeStoreEnabled"].as_bool(),
            is_app_and_services_trial_enabled: s["isAppAndServicesTrialEnabled"].as_bool(),
        }
    }
}

// #208 (Org Admin): To Do org-wide (OrgSettings-Todo.Read.All). Mesmo padrão dos
// outros cards — GET independente, status próprio de degradação. Endpoint segue a
// nomenclatura dos irmãos (`OrgSettings-Todo` → `/admin/todo`, beta). `todoSettings`:
// push notification / external join / external share.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgTodoCard {
    /// "ok" | "forbidden" | "error"
    pub status: String,
    pub is_push_notification_enabled: Option<bool>,
    pub is_external_join_enabled: Option<bool>,
    pub is_external_share_enabled: Option<bool>,
}

impl OrgTodoCard {
    fn vazio(status: &str) -> Self {
        Self {
            status: status.to_string(),
            is_push_notification_enabled: None,
            is_external_join_enabled: None,
            is_external_share_enabled: None,
        }
    }
    fn dos_settings(s: &serde_json::Value) -> Self {
        Self {
            status: "ok".to_string(),
            is_push_notification_enabled: s["isPushNotificationEnabled"].as_bool(),
            is_external_join_enabled: s["isExternalJoinEnabled"].as_bool(),
            is_external_share_enabled: s["isExternalShareEnabled"].as_bool(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormsCard {
    pub status: String,
    pub is_external_send_form_enabled: Option<bool>,
    pub is_external_share_collaboration_enabled: Option<bool>,
    pub is_external_share_result_enabled: Option<bool>,
    pub is_external_share_template_enabled: Option<bool>,
    pub is_record_identity_by_default_enabled: Option<bool>,
    pub is_bing_image_search_enabled: Option<bool>,
    pub is_in_org_forms_phishing_scan_enabled: Option<bool>,
}

impl FormsCard {
    fn vazio(status: &str) -> Self {
        Self {
            status: status.to_string(),
            is_external_send_form_enabled: None,
            is_external_share_collaboration_enabled: None,
            is_external_share_result_enabled: None,
            is_external_share_template_enabled: None,
            is_record_identity_by_default_enabled: None,
            is_bing_image_search_enabled: None,
            is_in_org_forms_phishing_scan_enabled: None,
        }
    }
    fn dos_settings(s: &serde_json::Value) -> Self {
        Self {
            status: "ok".to_string(),
            is_external_send_form_enabled: s["isExternalSendFormEnabled"].as_bool(),
            is_external_share_collaboration_enabled: s["isExternalShareCollaborationEnabled"]
                .as_bool(),
            is_external_share_result_enabled: s["isExternalShareResultEnabled"].as_bool(),
            is_external_share_template_enabled: s["isExternalShareTemplateEnabled"].as_bool(),
            is_record_identity_by_default_enabled: s["isRecordIdentityByDefaultEnabled"].as_bool(),
            is_bing_image_search_enabled: s["isBingImageSearchEnabled"].as_bool(),
            is_in_org_forms_phishing_scan_enabled: s["isInOrgFormsPhishingScanEnabled"].as_bool(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M365AppsPlataforma {
    pub is_microsoft365_apps_enabled: Option<bool>,
    pub is_project_enabled: Option<bool>,
    pub is_skype_for_business_enabled: Option<bool>,
    pub is_visio_enabled: Option<bool>,
}

impl M365AppsPlataforma {
    fn do_valor(v: &serde_json::Value) -> Option<Self> {
        if !v.is_object() {
            return None;
        }
        Some(Self {
            is_microsoft365_apps_enabled: v["isMicrosoft365AppsEnabled"].as_bool(),
            is_project_enabled: v["isProjectEnabled"].as_bool(),
            is_skype_for_business_enabled: v["isSkypeForBusinessEnabled"].as_bool(),
            is_visio_enabled: v["isVisioEnabled"].as_bool(),
        })
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M365InstallCard {
    pub status: String,
    pub update_channel: Option<String>,
    pub apps_for_windows: Option<M365AppsPlataforma>,
    pub apps_for_mac: Option<M365AppsPlataforma>,
}

impl M365InstallCard {
    fn vazio(status: &str) -> Self {
        Self {
            status: status.to_string(),
            update_channel: None,
            apps_for_windows: None,
            apps_for_mac: None,
        }
    }
    fn da_raiz(body: &serde_json::Value) -> Self {
        Self {
            status: "ok".to_string(),
            update_channel: body["updateChannel"]
                .as_str()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            apps_for_windows: M365AppsPlataforma::do_valor(&body["appsForWindows"]),
            apps_for_mac: M365AppsPlataforma::do_valor(&body["appsForMac"]),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSettingsResult {
    pub apps_and_services: AppsAndServicesCard,
    pub forms: FormsCard,
    pub microsoft365_install: M365InstallCard,
    pub todo: OrgTodoCard,
}

/// Resultado bruto de um GET de OrgSettings, antes de virar card tipado.
enum OrgGetOutcome {
    Ok(serde_json::Value),
    Forbidden,
    Error,
}

fn org_settings_get(
    token: &str,
    client: &reqwest::blocking::Client,
    label: &str,
    url: &str,
) -> OrgGetOutcome {
    match graph_enviar(label, GRAPH_TETO_ESPERA_S, || {
        client.get(url).bearer_auth(token).send()
    }) {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
            Ok(body) => OrgGetOutcome::Ok(body),
            Err(_) => OrgGetOutcome::Error,
        },
        Ok(resp) if resp.status().as_u16() == 403 => OrgGetOutcome::Forbidden,
        Ok(_) => OrgGetOutcome::Error,
        Err(_) => OrgGetOutcome::Error,
    }
}

/// #425: lê os 3 grupos de settings org-wide (read-only) num tiro só. Cada card
/// carrega seu próprio status pra a UI mostrar loading/erro/sem-permissão por card.
pub fn cr_org_settings(store: &TokenStore) -> Result<OrgSettingsResult, String> {
    let token = access_token(store)?;
    let client = cliente();

    let apps_and_services = match org_settings_get(
        &token,
        &client,
        "org:appsAndServices",
        &format!("{GRAPH_BETA}/admin/appsAndServices"),
    ) {
        OrgGetOutcome::Ok(body) => AppsAndServicesCard::dos_settings(&body["value"]["settings"]),
        OrgGetOutcome::Forbidden => AppsAndServicesCard::vazio("forbidden"),
        OrgGetOutcome::Error => AppsAndServicesCard::vazio("error"),
    };

    let forms = match org_settings_get(
        &token,
        &client,
        "org:forms",
        &format!("{GRAPH_BETA}/admin/forms"),
    ) {
        OrgGetOutcome::Ok(body) => FormsCard::dos_settings(&body["value"]["settings"]),
        OrgGetOutcome::Forbidden => FormsCard::vazio("forbidden"),
        OrgGetOutcome::Error => FormsCard::vazio("error"),
    };

    let microsoft365_install = match org_settings_get(
        &token,
        &client,
        "org:m365Install",
        &format!("{GRAPH}/admin/microsoft365Apps/installationOptions"),
    ) {
        OrgGetOutcome::Ok(body) => M365InstallCard::da_raiz(&body),
        OrgGetOutcome::Forbidden => M365InstallCard::vazio("forbidden"),
        OrgGetOutcome::Error => M365InstallCard::vazio("error"),
    };

    // #208: To Do org-wide (mesmo padrão dos 3 acima). `/admin/todo` segue a
    // nomenclatura OrgSettings-Todo; a resposta (como os irmãos) traz os settings
    // em `value.settings`. Sem permissão/erro → card degrada sozinho.
    let todo = match org_settings_get(
        &token,
        &client,
        "org:todo",
        &format!("{GRAPH_BETA}/admin/todo"),
    ) {
        OrgGetOutcome::Ok(body) => OrgTodoCard::dos_settings(&body["value"]["settings"]),
        OrgGetOutcome::Forbidden => OrgTodoCard::vazio("forbidden"),
        OrgGetOutcome::Error => OrgTodoCard::vazio("error"),
    };

    Ok(OrgSettingsResult {
        apps_and_services,
        forms,
        microsoft365_install,
        todo,
    })
}

/// #208 (RW): grava UMA setting org-wide de To Do (OrgSettings-Todo.ReadWrite.All).
/// PATCH `/admin/todo` com `{ "settings": { "<campo>": valor } }` — o shape espelha
/// o GET (que lê `value.settings`). Só aceita os 3 campos conhecidos (nunca PATCH
/// arbitrário). ⚠️ O endpoint/shape do `/admin/todo` ainda NÃO foi confirmado no
/// tenant real (auth-gate) — a UI mantém a escrita TRAVADA atrás de um gate até o
/// live-QA de admin do Wagner validar; este comando fica pronto pra ativar (#208).
/// #1076 (RB16): follow-up formal desta dívida (confirmar endpoint/shape em live-QA
/// de admin) rastreado na auditoria #994. Enquanto não confirmado, a trava da UI
/// permanece — não ativar sem o live-QA fechar.
pub fn cr_org_todo_set(store: &TokenStore, campo: &str, valor: bool) -> Result<(), String> {
    if !matches!(
        campo,
        "isPushNotificationEnabled" | "isExternalJoinEnabled" | "isExternalShareEnabled"
    ) {
        return Err(format!("campo de To Do desconhecido: {campo}"));
    }
    let token = access_token(store)?;
    let client = cliente();
    let body = serde_json::json!({ "settings": { campo: valor } });
    let resp = graph_enviar("org:todo:set", GRAPH_TETO_ESPERA_S, || {
        client
            .patch(format!("{GRAPH_BETA}/admin/todo"))
            .bearer_auth(&token)
            .json(&body)
            .send()
    })
    .map_err(|e| format!("falha ao gravar To Do org-wide: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/admin/todo PATCH retornou {}", resp.status()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// #207 (Org Admin): apps REAIS do tenant. Lê os service principals (enterprise
// apps) via GET /servicePrincipals (Application.Read.All, já no SCOPES do #424).
// Filtro client-side pra só apps lançáveis pelo usuário (habilitado, com URL,
// não escondido). A tela usa isto ADITIVO ao catálogo estático de apps.ts, com
// fallback gracioso pro estático em erro/sem-permissão/vazio.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantApp {
    pub app_id: String,
    pub display_name: String,
    /// homepage ou loginUrl — pra abrir o app no navegador interno.
    pub url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantAppsResult {
    /// "ok" | "forbidden" | "error"
    pub status: String,
    pub apps: Vec<TenantApp>,
}

impl TenantAppsResult {
    fn vazio(status: &str) -> Self {
        Self {
            status: status.to_string(),
            apps: Vec::new(),
        }
    }
}

/// Um service principal vira app da tela quando: está habilitado, é do tipo
/// Application, tem uma URL de lançamento e não está marcado como escondido
/// (tag `HideApp`). Devolve None pros que não passam.
fn tenant_app_do_sp(sp: &serde_json::Value) -> Option<TenantApp> {
    if !sp["accountEnabled"].as_bool().unwrap_or(false) {
        return None;
    }
    if sp["servicePrincipalType"].as_str() != Some("Application") {
        return None;
    }
    // #618: espelha a régua do launcher da Microsoft (myapplications.microsoft.com):
    // só é tile de app quem tem a tag `WindowsAzureActiveDirectoryIntegratedApp`.
    // Service principals consentidos por OAuth (ferramentas de migração/CLI:
    // CodeTwo, EdbMails, Cyberduck, EmailJS…) não têm essa tag → ficam de fora.
    // `HideApp` continua sendo o override manual do admin pra esconder um app.
    let tags = sp["tags"].as_array();
    let eh_launcher = tags
        .map(|t| {
            t.iter()
                .any(|v| v.as_str() == Some("WindowsAzureActiveDirectoryIntegratedApp"))
        })
        .unwrap_or(false);
    if !eh_launcher {
        return None;
    }
    let escondido = tags
        .map(|t| t.iter().any(|v| v.as_str() == Some("HideApp")))
        .unwrap_or(false);
    if escondido {
        return None;
    }
    let url = sp["homepage"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| sp["loginUrl"].as_str().filter(|s| !s.trim().is_empty()))?
        .trim()
        .to_string();
    let display_name = sp["displayName"].as_str().unwrap_or("").trim().to_string();
    if display_name.is_empty() {
        return None;
    }
    let app_id = sp["appId"].as_str().unwrap_or("").trim().to_string();
    Some(TenantApp {
        app_id,
        display_name,
        url,
    })
}

/// #207: apps do tenant (uma página, ordem alfabética). O teto de 100 evita
/// paginar centenas de service principals de infra da Microsoft; a tela é um
/// complemento curado ao catálogo, não um explorador completo de diretório.
pub fn cr_tenant_apps(store: &TokenStore) -> Result<TenantAppsResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/servicePrincipals?$select=appId,displayName,accountEnabled,homepage,loginUrl,tags,servicePrincipalType\
         &$orderby=displayName&$count=true&$top=100"
    );

    match graph_enviar("org:tenantApps", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("ConsistencyLevel", "eventual")
            .send()
    }) {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
            Ok(body) => {
                let apps = body["value"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(tenant_app_do_sp).collect())
                    .unwrap_or_default();
                Ok(TenantAppsResult {
                    status: "ok".to_string(),
                    apps,
                })
            }
            Err(_) => Ok(TenantAppsResult::vazio("error")),
        },
        Ok(resp) if resp.status().as_u16() == 403 => Ok(TenantAppsResult::vazio("forbidden")),
        Ok(_) => Ok(TenantAppsResult::vazio("error")),
        Err(_) => Ok(TenantAppsResult::vazio("error")),
    }
}

// ---------------------------------------------------------------------------
// #541: logo do tenant (Entra organizational branding) pro header do sidebar.
// Busca o squareLogo (claro) e squareLogoDark (escuro) do branding DEFAULT e
// devolve cada um como data URL (padrão do favicon.rs). Degrada gracioso: sem
// branding / 403 / 404 / imagem vazia → None (o front cai no fallback).
// Endpoint (verificado na doc): GET /organization/{id}/branding/localizations/0/{squareLogo|squareLogoDark}
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgBranding {
    /// Logo pra fundo claro (data URL) — None se não configurado.
    pub square_logo: Option<String>,
    /// Logo pra fundo escuro (data URL) — None se não configurado.
    pub square_logo_dark: Option<String>,
}

/// Baixa uma imagem de branding e devolve o data URL, ou None em qualquer
/// falha (status, tipo não-imagem, corpo vazio). Não propaga erro de propósito.
fn baixar_branding_logo(
    client: &reqwest::blocking::Client,
    token: &str,
    label: &str,
    url: &str,
) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let resp = graph_enviar(label, GRAPH_TETO_ESPERA_S, || {
        client.get(url).bearer_auth(token).send()
    })
    .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let tipo = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .unwrap_or_default();
    // Branding não configurado costuma vir 200 com corpo vazio / JSON — só
    // aceitamos imagem de verdade.
    if !tipo.starts_with("image/") {
        return None;
    }
    let bytes = resp.bytes().ok()?;
    if bytes.is_empty() {
        return None;
    }
    let b64 = STANDARD.encode(&bytes);
    Some(format!("data:{tipo};base64,{b64}"))
}

/// #541: logo do tenant (claro + escuro) do branding default do Entra.
pub fn cr_org_branding(store: &TokenStore) -> Result<OrgBranding, String> {
    let token = access_token(store)?;
    let client = cliente();

    // orgId do usuário logado; sem ele não dá pra montar a URL de branding.
    let org_id = match graph_enviar("org:branding:orgId", GRAPH_TETO_ESPERA_S, || {
        client
            .get(format!("{GRAPH}/organization?$select=id"))
            .bearer_auth(&token)
            .send()
    }) {
        Ok(resp) if resp.status().is_success() => resp
            .json::<serde_json::Value>()
            .ok()
            .and_then(|b| b["value"][0]["id"].as_str().map(|s| s.to_string())),
        _ => None,
    };
    let Some(org_id) = org_id.filter(|s| !s.is_empty()) else {
        return Ok(OrgBranding {
            square_logo: None,
            square_logo_dark: None,
        });
    };

    let base = format!("{GRAPH}/organization/{org_id}/branding/localizations/0");
    let square_logo =
        baixar_branding_logo(&client, &token, "org:branding:squareLogo", &format!("{base}/squareLogo"));
    let square_logo_dark = baixar_branding_logo(
        &client,
        &token,
        "org:branding:squareLogoDark",
        &format!("{base}/squareLogoDark"),
    );

    Ok(OrgBranding {
        square_logo,
        square_logo_dark,
    })
}

// ---------------------------------------------------------------------------
// #426 (Org Admin S3): contexto multi-tenant da org (MultiTenantOrganization.Read.All,
// já no SCOPES do #424). Cartão read-only com a org multi-tenant + tenants membros.
// Não-membro vem como 200 `state:"inactive"` (não 404) → status "inactive".
// Endpoints (verificados na doc):
//   GET /tenantRelationships/multiTenantOrganization           (org: id/displayName/state)
//   GET /tenantRelationships/multiTenantOrganization/tenants   (membros: tenantId/displayName/role/state)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiTenantMember {
    pub tenant_id: String,
    pub display_name: String,
    /// "owner" | "member"
    pub role: String,
    /// "active" | "pending" | "removed"
    pub state: String,
}

fn multi_tenant_member(m: &serde_json::Value) -> Option<MultiTenantMember> {
    let tenant_id = m["tenantId"].as_str().unwrap_or("").trim().to_string();
    let display_name = m["displayName"].as_str().unwrap_or("").trim().to_string();
    if tenant_id.is_empty() && display_name.is_empty() {
        return None;
    }
    Some(MultiTenantMember {
        tenant_id,
        display_name,
        role: m["role"].as_str().unwrap_or("").trim().to_string(),
        state: m["state"].as_str().unwrap_or("").trim().to_string(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiTenantCard {
    /// "ok" | "inactive" | "forbidden" | "error"
    pub status: String,
    pub display_name: Option<String>,
    pub members: Vec<MultiTenantMember>,
}

impl MultiTenantCard {
    fn so_status(status: &str) -> Self {
        Self {
            status: status.to_string(),
            display_name: None,
            members: Vec::new(),
        }
    }
}

/// #426: org multi-tenant + tenants membros. Só busca os membros se a org
/// estiver ativa. Degrada gracioso (403 → forbidden, não-membro → inactive).
pub fn cr_multi_tenant(store: &TokenStore) -> Result<MultiTenantCard, String> {
    let token = access_token(store)?;
    let client = cliente();

    let org = match graph_enviar("org:multiTenant", GRAPH_TETO_ESPERA_S, || {
        client
            .get(format!("{GRAPH}/tenantRelationships/multiTenantOrganization"))
            .bearer_auth(&token)
            .send()
    }) {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
            Ok(body) => body,
            Err(_) => return Ok(MultiTenantCard::so_status("error")),
        },
        Ok(resp) if resp.status().as_u16() == 403 => {
            return Ok(MultiTenantCard::so_status("forbidden"))
        }
        Ok(_) => return Ok(MultiTenantCard::so_status("error")),
        Err(_) => return Ok(MultiTenantCard::so_status("error")),
    };

    let estado = org["state"].as_str().unwrap_or("inactive");
    if estado != "active" {
        // Tenant não faz parte de uma organização multi-tenant.
        return Ok(MultiTenantCard::so_status("inactive"));
    }

    let display_name = org["displayName"]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let members = match graph_enviar("org:multiTenant:tenants", GRAPH_TETO_ESPERA_S, || {
        client
            .get(format!(
                "{GRAPH}/tenantRelationships/multiTenantOrganization/tenants"
            ))
            .bearer_auth(&token)
            .send()
    }) {
        Ok(resp) if resp.status().is_success() => resp
            .json::<serde_json::Value>()
            .ok()
            .and_then(|b| b["value"].as_array().cloned())
            .map(|arr| arr.iter().filter_map(multi_tenant_member).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    Ok(MultiTenantCard {
        status: "ok".to_string(),
        display_name,
        members,
    })
}

#[cfg(test)]
mod org_settings_testes {
    use super::*;

    #[test]
    fn parse_apps_and_services_do_exemplo_da_doc() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{"value":{"id":"c079","settings":{"isOfficeStoreEnabled":false,"isAppAndServicesTrialEnabled":true}}}"#,
        )
        .unwrap();
        let card = AppsAndServicesCard::dos_settings(&body["value"]["settings"]);
        assert_eq!(card.status, "ok");
        assert_eq!(card.is_office_store_enabled, Some(false));
        assert_eq!(card.is_app_and_services_trial_enabled, Some(true));
    }

    #[test]
    fn parse_forms_do_exemplo_da_doc() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{"value":{"settings":{"isExternalSendFormEnabled":true,"isExternalShareCollaborationEnabled":false,"isExternalShareResultEnabled":false,"isExternalShareTemplateEnabled":true,"isRecordIdentityByDefaultEnabled":true,"isBingImageSearchEnabled":true,"isInOrgFormsPhishingScanEnabled":false}}}"#,
        )
        .unwrap();
        let card = FormsCard::dos_settings(&body["value"]["settings"]);
        assert_eq!(card.status, "ok");
        assert_eq!(card.is_external_send_form_enabled, Some(true));
        assert_eq!(card.is_external_share_collaboration_enabled, Some(false));
        assert_eq!(card.is_in_org_forms_phishing_scan_enabled, Some(false));
    }

    #[test]
    fn parse_m365_install_do_exemplo_da_doc() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{"updateChannel":"current","appsForWindows":{"isMicrosoft365AppsEnabled":true,"isProjectEnabled":true,"isSkypeForBusinessEnabled":false,"isVisioEnabled":false},"appsForMac":{"isMicrosoft365AppsEnabled":false,"isSkypeForBusinessEnabled":true}}"#,
        )
        .unwrap();
        let card = M365InstallCard::da_raiz(&body);
        assert_eq!(card.status, "ok");
        assert_eq!(card.update_channel.as_deref(), Some("current"));
        let win = card.apps_for_windows.expect("appsForWindows");
        assert_eq!(win.is_microsoft365_apps_enabled, Some(true));
        assert_eq!(win.is_visio_enabled, Some(false));
        let mac = card.apps_for_mac.expect("appsForMac");
        assert_eq!(mac.is_skype_for_business_enabled, Some(true));
        // campo ausente no Mac (isProjectEnabled) → None, sem panic
        assert_eq!(mac.is_project_enabled, None);
    }

    #[test]
    fn cards_vazios_carregam_status() {
        assert_eq!(AppsAndServicesCard::vazio("forbidden").status, "forbidden");
        assert_eq!(FormsCard::vazio("error").status, "error");
        assert!(M365InstallCard::vazio("error").apps_for_windows.is_none());
    }

    // --- #207: filtro de service principal → app do tenant ---

    #[test]
    fn tenant_app_aceita_sp_lancavel() {
        let sp: serde_json::Value = serde_json::from_str(
            r#"{"appId":"abc","displayName":"Contoso HR","accountEnabled":true,"servicePrincipalType":"Application","homepage":"https://hr.contoso.com","tags":["WindowsAzureActiveDirectoryIntegratedApp"]}"#,
        )
        .unwrap();
        let app = tenant_app_do_sp(&sp).expect("deveria aceitar");
        assert_eq!(app.display_name, "Contoso HR");
        assert_eq!(app.url, "https://hr.contoso.com");
        assert_eq!(app.app_id, "abc");
    }

    #[test]
    fn tenant_app_cai_em_loginurl_sem_homepage() {
        let sp: serde_json::Value = serde_json::from_str(
            // #747: pós-#618 o SP PRECISA da tag `WindowsAzureActiveDirectoryIntegratedApp`
            // pra ser tile de app (senão `tenant_app_do_sp` retorna None antes da URL). O
            // teste é do FALLBACK homepage→loginUrl, então o SP tem a tag + só loginUrl.
            r#"{"appId":"x","displayName":"App","accountEnabled":true,"servicePrincipalType":"Application","loginUrl":"https://login.app.com","tags":["WindowsAzureActiveDirectoryIntegratedApp"]}"#,
        )
        .unwrap();
        assert_eq!(tenant_app_do_sp(&sp).unwrap().url, "https://login.app.com");
    }

    // --- #426: parse de membro multi-tenant ---

    #[test]
    fn multi_tenant_member_do_exemplo_da_doc() {
        let m: serde_json::Value = serde_json::from_str(
            r#"{"tenantId":"1fd6544e","displayName":"Contoso","role":"owner","state":"active"}"#,
        )
        .unwrap();
        let membro = multi_tenant_member(&m).expect("deveria parsear");
        assert_eq!(membro.tenant_id, "1fd6544e");
        assert_eq!(membro.display_name, "Contoso");
        assert_eq!(membro.role, "owner");
        assert_eq!(membro.state, "active");
    }

    #[test]
    fn multi_tenant_member_rejeita_vazio() {
        let m: serde_json::Value = serde_json::from_str(r#"{"role":"member"}"#).unwrap();
        assert!(multi_tenant_member(&m).is_none());
    }

    #[test]
    fn multi_tenant_card_so_status() {
        let c = MultiTenantCard::so_status("inactive");
        assert_eq!(c.status, "inactive");
        assert!(c.display_name.is_none());
        assert!(c.members.is_empty());
    }

    #[test]
    fn tenant_app_rejeita_desabilitado_escondido_managed_e_sem_url() {
        // desabilitado
        let desab: serde_json::Value = serde_json::from_str(
            r#"{"displayName":"A","accountEnabled":false,"servicePrincipalType":"Application","homepage":"https://a.com"}"#,
        ).unwrap();
        assert!(tenant_app_do_sp(&desab).is_none());
        // marcado HideApp
        let escondido: serde_json::Value = serde_json::from_str(
            r#"{"displayName":"B","accountEnabled":true,"servicePrincipalType":"Application","homepage":"https://b.com","tags":["HideApp"]}"#,
        ).unwrap();
        assert!(tenant_app_do_sp(&escondido).is_none());
        // ManagedIdentity (não é app de usuário)
        let mi: serde_json::Value = serde_json::from_str(
            r#"{"displayName":"C","accountEnabled":true,"servicePrincipalType":"ManagedIdentity","homepage":"https://c.com"}"#,
        ).unwrap();
        assert!(tenant_app_do_sp(&mi).is_none());
        // sem URL de lançamento
        let sem_url: serde_json::Value = serde_json::from_str(
            r#"{"displayName":"D","accountEnabled":true,"servicePrincipalType":"Application"}"#,
        ).unwrap();
        assert!(tenant_app_do_sp(&sem_url).is_none());
    }
}

fn valor_texto(item: &serde_json::Value, campo: &str) -> String {
    item[campo].as_str().unwrap_or("").trim().to_string()
}

fn campo_ja_proposto(fields: &[PeopleEnrichField], key: &str) -> bool {
    fields.iter().any(|field| field.key == key)
}

fn adicionar_scalar(
    fields: &mut Vec<PeopleEnrichField>,
    contato: &serde_json::Value,
    key: &str,
    valor: Option<String>,
    source: &str,
) {
    if !valor_texto(contato, key).is_empty() || campo_ja_proposto(fields, key) {
        return;
    }
    if let Some(value) = valor.filter(|value| !value.trim().is_empty()) {
        fields.push(PeopleEnrichField {
            key: key.to_string(),
            value,
            source: source.to_string(),
            label: None,
        });
    }
}

fn normalizar_telefone(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '+')
        .collect()
}

fn emails_existentes(contato: &serde_json::Value) -> std::collections::HashSet<String> {
    contato["emailAddresses"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|email| email["address"].as_str())
        .map(|email| email.trim().to_lowercase())
        .filter(|email| !email.is_empty())
        .collect()
}

fn telefones_existentes(contato: &serde_json::Value) -> std::collections::HashSet<String> {
    let mut telefones = std::collections::HashSet::new();
    for campo in ["businessPhones", "homePhones"] {
        for value in contato[campo].as_array().into_iter().flatten() {
            if let Some(number) = value.as_str() {
                telefones.insert(normalizar_telefone(number));
            }
        }
    }
    if let Some(number) = contato["mobilePhone"].as_str() {
        telefones.insert(normalizar_telefone(number));
    }
    telefones
}

fn adicionar_email(
    fields: &mut Vec<PeopleEnrichField>,
    existentes: &mut std::collections::HashSet<String>,
    address: &str,
    source: &str,
    label: Option<String>,
) {
    let key = address.trim().to_lowercase();
    if key.is_empty() || !existentes.insert(key) {
        return;
    }
    fields.push(PeopleEnrichField {
        key: "email".to_string(),
        value: address.trim().to_string(),
        source: source.to_string(),
        label,
    });
}

fn adicionar_telefone(
    fields: &mut Vec<PeopleEnrichField>,
    existentes: &mut std::collections::HashSet<String>,
    number: &str,
    phone_type: &str,
    source: &str,
) {
    let normalized = normalizar_telefone(number);
    if normalized.is_empty() || !existentes.insert(normalized) {
        return;
    }
    let mobile = phone_type.to_lowercase().contains("mobile");
    fields.push(PeopleEnrichField {
        key: if mobile {
            "mobilePhone".to_string()
        } else {
            "businessPhone".to_string()
        },
        value: number.trim().to_string(),
        source: source.to_string(),
        label: Some(if mobile { "mobile" } else { "work" }.to_string()),
    });
}

fn buscar_foto_data_uri(
    client: &reqwest::blocking::Client,
    token: &str,
    url: &str,
    operacao: &'static str,
) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose, Engine as _};

    let resp = graph_enviar(operacao, GRAPH_TETO_ESPERA_S, || {
        client.get(url).bearer_auth(token).send()
    })
    .map_err(|error| format!("falha de rede ({error})"))?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("Graph retornou {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().map_err(|error| error.to_string())?;
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    )))
}

fn pessoa_por_email<'a>(
    items: &'a [serde_json::Value],
    email_alvo: &str,
) -> Option<&'a serde_json::Value> {
    items.iter().find(|item| {
        item["userPrincipalName"]
            .as_str()
            .is_some_and(|value| value.eq_ignore_ascii_case(email_alvo))
            || item["scoredEmailAddresses"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|email| email["address"].as_str())
                .any(|value| value.eq_ignore_ascii_case(email_alvo))
    })
}

/// Busca fontes do Enrich sem alterar o contato. People tem prioridade e o
/// diretorio apenas preenche o que continuou vazio. Falhas sao por fonte.
pub fn cr_people_enrich_preview(
    store: &TokenStore,
    contact_id: Option<&str>,
    email: &str,
    directory_user: bool,
) -> Result<PeopleEnrichPreview, String> {
    let email = email.trim();
    if email.is_empty() {
        return Err("e-mail do contato ausente".into());
    }

    let token = access_token(store)?;
    let client = cliente();
    let mut failures = Vec::new();
    let mut contato = serde_json::json!({});

    if let Some(id) = contact_id.filter(|id| !id.trim().is_empty()) {
        let url = format!(
            "{GRAPH}/me/contacts/{}?$select=id,displayName,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle,department,officeLocation,manager",
            urlencoding::encode(id.trim())
        );
        match graph_enviar("people:enrich-contact", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
                Ok(body) => contato = body,
                Err(error) => failures.push(format!("Contacts: resposta invalida ({error})")),
            },
            Ok(resp) => failures.push(format!("Contacts: Graph retornou {}", resp.status())),
            Err(error) => failures.push(format!("Contacts: falha de rede ({error})")),
        }
    }

    let mut fields = Vec::new();
    let mut existing_emails = emails_existentes(&contato);
    let mut existing_phones = telefones_existentes(&contato);
    let mut pessoa_match: Option<serde_json::Value> = None;

    if !directory_user {
        let people_url = format!(
            "{GRAPH}/me/people?$top=250&$select=id,displayName,scoredEmailAddresses,phones,companyName,jobTitle,personType,userPrincipalName"
        );
        match graph_enviar("people:enrich-people", GRAPH_TETO_ESPERA_S, || {
            client.get(&people_url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
                Ok(body) => {
                    if let Some(items) = body["value"].as_array() {
                        if let Some(person) = pessoa_por_email(items, email) {
                            adicionar_scalar(
                                &mut fields,
                                &contato,
                                "jobTitle",
                                texto_opcional(person, "jobTitle"),
                                "people",
                            );
                            adicionar_scalar(
                                &mut fields,
                                &contato,
                                "companyName",
                                texto_opcional(person, "companyName"),
                                "people",
                            );
                            for address in person["scoredEmailAddresses"]
                                .as_array()
                                .into_iter()
                                .flatten()
                            {
                                if let Some(value) = address["address"].as_str() {
                                    adicionar_email(
                                        &mut fields,
                                        &mut existing_emails,
                                        value,
                                        "people",
                                        None,
                                    );
                                }
                            }
                            for phone in person["phones"].as_array().into_iter().flatten() {
                                if let Some(number) = phone["number"].as_str() {
                                    adicionar_telefone(
                                        &mut fields,
                                        &mut existing_phones,
                                        number,
                                        phone["type"].as_str().unwrap_or("work"),
                                        "people",
                                    );
                                }
                            }
                            pessoa_match = Some(person.clone());
                        }
                    }
                }
                Err(error) => failures.push(format!("People: resposta invalida ({error})")),
            },
            Ok(resp) => failures.push(format!("People: Graph retornou {}", resp.status())),
            Err(error) => failures.push(format!("People: falha de rede ({error})")),
        }
    }

    let organization = directory_user
        || pessoa_match.as_ref().is_some_and(|person| {
            let person_type = &person["personType"];
            person_type["subclass"]
                .as_str()
                .or_else(|| person_type["class"].as_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("OrganizationUser"))
        });

    let mut directory_user_id: Option<String> = None;
    if organization {
        let identifier = if directory_user {
            email
        } else {
            pessoa_match
                .as_ref()
                .and_then(|person| person["userPrincipalName"].as_str())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(email)
        };
        let user_url = format!(
            "{GRAPH}/users/{}?$select=id,displayName,mail,userPrincipalName,jobTitle,companyName,department,officeLocation,mobilePhone,businessPhones",
            urlencoding::encode(identifier)
        );
        match graph_enviar("people:enrich-directory", GRAPH_TETO_ESPERA_S, || {
            client.get(&user_url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
                Ok(user) => {
                    adicionar_scalar(
                        &mut fields,
                        &contato,
                        "jobTitle",
                        texto_opcional(&user, "jobTitle"),
                        "directory",
                    );
                    adicionar_scalar(
                        &mut fields,
                        &contato,
                        "companyName",
                        texto_opcional(&user, "companyName"),
                        "directory",
                    );
                    adicionar_scalar(
                        &mut fields,
                        &contato,
                        "department",
                        texto_opcional(&user, "department"),
                        "directory",
                    );
                    adicionar_scalar(
                        &mut fields,
                        &contato,
                        "officeLocation",
                        texto_opcional(&user, "officeLocation"),
                        "directory",
                    );
                    if let Some(address) = user["mail"]
                        .as_str()
                        .filter(|value| !value.trim().is_empty())
                        .or_else(|| user["userPrincipalName"].as_str())
                    {
                        adicionar_email(
                            &mut fields,
                            &mut existing_emails,
                            address,
                            "directory",
                            None,
                        );
                    }
                    for phone in user["businessPhones"].as_array().into_iter().flatten() {
                        if let Some(number) = phone.as_str() {
                            adicionar_telefone(
                                &mut fields,
                                &mut existing_phones,
                                number,
                                "work",
                                "directory",
                            );
                        }
                    }
                    if let Some(number) = user["mobilePhone"].as_str() {
                        adicionar_telefone(
                            &mut fields,
                            &mut existing_phones,
                            number,
                            "mobile",
                            "directory",
                        );
                    }

                    let user_id = user["id"]
                        .as_str()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or(identifier);
                    directory_user_id = Some(user_id.to_string());
                    let manager_url = format!(
                        "{GRAPH}/users/{}/manager?$select=id,displayName,mail,userPrincipalName",
                        urlencoding::encode(user_id)
                    );
                    match graph_enviar("people:enrich-manager", GRAPH_TETO_ESPERA_S, || {
                        client.get(&manager_url).bearer_auth(&token).send()
                    }) {
                        Ok(resp) if resp.status().is_success() => {
                            if let Ok(manager) = resp.json::<serde_json::Value>() {
                                adicionar_scalar(
                                    &mut fields,
                                    &contato,
                                    "manager",
                                    texto_opcional(&manager, "displayName"),
                                    "directory",
                                );
                            }
                        }
                        Ok(resp) if resp.status().as_u16() == 404 => {}
                        Ok(resp) => failures
                            .push(format!("Directory manager: Graph retornou {}", resp.status())),
                        Err(error) => failures
                            .push(format!("Directory manager: falha de rede ({error})")),
                    }
                }
                Err(error) => failures.push(format!("Directory: resposta invalida ({error})")),
            },
            Ok(resp) if resp.status().as_u16() == 404 => {}
            Ok(resp) => failures.push(format!("Directory: Graph retornou {}", resp.status())),
            Err(error) => failures.push(format!("Directory: falha de rede ({error})")),
        }
    }

    // Foto e a terceira fonte: primeiro o proprio contato, depois o usuario do
    // diretorio. Ela entra no mesmo preview e continua sem qualquer mutacao.
    let mut photo_found = false;
    if let Some(id) = contact_id.filter(|id| !id.trim().is_empty()) {
        let photo_url = format!(
            "{GRAPH}/me/contacts/{}/photo/$value",
            urlencoding::encode(id.trim())
        );
        match buscar_foto_data_uri(
            &client,
            &token,
            &photo_url,
            "people:enrich-contact-photo",
        ) {
            Ok(Some(value)) => {
                photo_found = true;
                fields.push(PeopleEnrichField {
                    key: "photo".to_string(),
                    value,
                    source: "contacts".to_string(),
                    label: None,
                });
            }
            Ok(None) => {}
            Err(error) => failures.push(format!("Contacts photo: {error}")),
        }
    }
    if !directory_user && !photo_found {
        if let Some(user_id) = directory_user_id {
            let photo_url = format!(
                "{GRAPH}/users/{}/photo/$value",
                urlencoding::encode(&user_id)
            );
            match buscar_foto_data_uri(
                &client,
                &token,
                &photo_url,
                "people:enrich-directory-photo",
            ) {
                Ok(Some(value)) => fields.push(PeopleEnrichField {
                    key: "photo".to_string(),
                    value,
                    source: "directory".to_string(),
                    label: None,
                }),
                Ok(None) => {}
                Err(error) => failures.push(format!("Directory photo: {error}")),
            }
        }
    }

    let write_available =
        contact_id.is_some() && token_tem_escopo(store, "Contacts.ReadWrite")?;
    Ok(PeopleEnrichPreview {
        fields,
        failures,
        write_available,
    })
}

fn campo_patch_valido(key: &str) -> bool {
    matches!(
        key,
        "photo"
            | "email"
            | "businessPhone"
            | "mobilePhone"
            | "jobTitle"
            | "companyName"
            | "department"
            | "officeLocation"
            | "manager"
    )
}

/// Persiste somente os campos explicitamente aceitos. O escopo e conferido no
/// token antes de qualquer GET/PATCH; sem ele o comando retorna read-only e nao
/// tenta escrita nem consentimento.
pub fn cr_people_enrich_apply(
    store: &TokenStore,
    contact_id: &str,
    fields: Vec<PeopleEnrichField>,
) -> Result<PeopleEnrichApplyResult, String> {
    let token = access_token(store)?;
    let write_available = token_tem_escopo(store, "Contacts.ReadWrite")?;
    if !write_available || contact_id.trim().is_empty() {
        return Ok(PeopleEnrichApplyResult {
            saved: false,
            write_available: false,
        });
    }

    let fields: Vec<PeopleEnrichField> = fields
        .into_iter()
        .filter(|field| {
            campo_patch_valido(&field.key)
                && !field.value.trim().is_empty()
                && if field.key == "photo" {
                    field.value.len() <= 5_000_000
                } else {
                    field.value.len() <= 512
                }
        })
        .collect();
    if fields.is_empty() {
        return Ok(PeopleEnrichApplyResult {
            saved: true,
            write_available: true,
        });
    }

    let client = cliente();
    let contact_url = format!(
        "{GRAPH}/me/contacts/{}",
        urlencoding::encode(contact_id.trim())
    );
    let get_url = format!(
        "{contact_url}?$select=id,displayName,emailAddresses,businessPhones,homePhones,mobilePhone"
    );
    let resp = graph_enviar("people:enrich-current", GRAPH_TETO_ESPERA_S, || {
        client.get(&get_url).bearer_auth(&token).send()
    })
    .map_err(|error| format!("falha ao reler o contato: {error}"))?;
    if !resp.status().is_success() {
        return Err(format!("Contacts: Graph retornou {}", resp.status()));
    }
    let current: serde_json::Value = resp.json().map_err(|error| error.to_string())?;
    let mut body = serde_json::Map::new();
    if let Some(display_name) = current["displayName"].as_str() {
        body.insert(
            "displayName".to_string(),
            serde_json::Value::String(display_name.to_string()),
        );
    }

    let mut email_addresses = current["emailAddresses"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut known_emails: std::collections::HashSet<String> = email_addresses
        .iter()
        .filter_map(|item| item["address"].as_str())
        .map(|value| value.trim().to_lowercase())
        .collect();
    let mut business_phones: Vec<String> = current["businessPhones"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect();
    let mut known_phones: std::collections::HashSet<String> = business_phones
        .iter()
        .map(|value| normalizar_telefone(value))
        .collect();
    let mut changed_emails = false;
    let mut changed_business_phones = false;
    let mut accepted = 0usize;
    let mut photo_to_write: Option<String> = None;

    for field in fields {
        let value = field.value.trim();
        match field.key.as_str() {
            "photo" => {
                if !field.source.eq_ignore_ascii_case("contacts") {
                    photo_to_write = Some(value.to_string());
                }
            }
            "email" => {
                let normalized = value.to_lowercase();
                if known_emails.insert(normalized) {
                    email_addresses.push(serde_json::json!({
                        "address": value,
                        "name": field.label.unwrap_or_default()
                    }));
                    changed_emails = true;
                    accepted += 1;
                }
            }
            "businessPhone" => {
                if known_phones.insert(normalizar_telefone(value)) {
                    business_phones.push(value.to_string());
                    changed_business_phones = true;
                    accepted += 1;
                }
            }
            "mobilePhone" => {
                body.insert(
                    "mobilePhone".to_string(),
                    serde_json::Value::String(value.to_string()),
                );
                accepted += 1;
            }
            "jobTitle"
            | "companyName"
            | "department"
            | "officeLocation"
            | "manager" => {
                body.insert(
                    field.key,
                    serde_json::Value::String(value.to_string()),
                );
                accepted += 1;
            }
            _ => {}
        }
    }
    if changed_emails {
        body.insert(
            "emailAddresses".to_string(),
            serde_json::Value::Array(email_addresses),
        );
    }
    if changed_business_phones {
        body.insert(
            "businessPhones".to_string(),
            serde_json::json!(business_phones),
        );
    }
    if accepted == 0 && photo_to_write.is_none() {
        return Ok(PeopleEnrichApplyResult {
            saved: true,
            write_available: true,
        });
    }

    if accepted > 0 {
        let resp = graph_enviar("people:enrich-apply", GRAPH_TETO_ESPERA_S, || {
            client
                .patch(&contact_url)
                .bearer_auth(&token)
                .json(&body)
                .send()
        })
        .map_err(|error| format!("falha ao salvar o contato: {error}"))?;
        if !resp.status().is_success() {
            return Err(format!("Contacts: Graph retornou {}", resp.status()));
        }
    }

    if let Some(photo) = photo_to_write {
        use base64::{engine::general_purpose, Engine as _};
        let (meta, encoded) = photo
            .split_once(',')
            .ok_or("formato de foto invalido")?;
        let content_type = meta
            .strip_prefix("data:")
            .and_then(|value| value.strip_suffix(";base64"))
            .filter(|value| value.starts_with("image/"))
            .ok_or("tipo de foto invalido")?;
        let bytes = general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "foto base64 invalida")?;
        let photo_url = format!("{contact_url}/photo/$value");
        let resp = graph_enviar("people:enrich-apply-photo", GRAPH_TETO_ESPERA_S, || {
            client
                .patch(&photo_url)
                .bearer_auth(&token)
                .header(reqwest::header::CONTENT_TYPE, content_type)
                .body(bytes.clone())
                .send()
        })
        .map_err(|error| format!("falha ao salvar a foto: {error}"))?;
        if !resp.status().is_success() {
            return Err(format!("Contacts photo: Graph retornou {}", resp.status()));
        }
    }

    Ok(PeopleEnrichApplyResult {
        saved: true,
        write_available: true,
    })
}

fn rotulo_telefone(label: &str) -> &'static str {
    let label = label.trim().to_lowercase();
    if matches!(label.as_str(), "mobile" | "cell" | "celular") {
        "mobile"
    } else if matches!(label.as_str(), "home" | "casa") {
        "home"
    } else {
        "business"
    }
}

/// Valida os campos editáveis e projeta o corpo JSON de um contato para o Graph
/// (POST/PATCH /me/contacts). Compartilhado por update, create e a recriação do
/// Undo do merge (#379) — mantém a mesma classificação de telefones.
fn contato_body(input: PeopleContactEdit) -> Result<serde_json::Value, String> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 256 {
        return Err("Invalid display name.".to_string());
    }
    if input.company.as_deref().unwrap_or("").trim().len() > 256 {
        return Err("Invalid company name.".to_string());
    }
    if input.emails.len() > 50
        || input.emails.iter().any(|email| {
            let address = email.address.trim();
            address.is_empty()
                || address.len() > 320
                || !address.contains('@')
                || email.label.as_deref().unwrap_or("").len() > 128
        })
    {
        return Err("Invalid email address.".to_string());
    }
    if input.phones.len() > 50
        || input.phones.iter().any(|phone| {
            phone.number.trim().is_empty()
                || phone.number.len() > 64
                || phone.label.len() > 128
        })
    {
        return Err("Invalid phone number.".to_string());
    }

    let mut business_phones = Vec::new();
    let mut home_phones = Vec::new();
    let mut mobile_phone: Option<String> = None;
    for phone in input.phones {
        let number = phone.number.trim().to_string();
        match rotulo_telefone(&phone.label) {
            "mobile" if mobile_phone.is_none() => mobile_phone = Some(number),
            "home" => home_phones.push(number),
            _ => business_phones.push(number),
        }
    }
    let email_addresses: Vec<serde_json::Value> = input
        .emails
        .into_iter()
        .map(|email| {
            serde_json::json!({
                "address": email.address.trim(),
                "name": email.label.unwrap_or_default().trim()
            })
        })
        .collect();
    let company = input
        .company
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(serde_json::json!({
        "displayName": name,
        "emailAddresses": email_addresses,
        "businessPhones": business_phones,
        "homePhones": home_phones,
        "mobilePhone": mobile_phone,
        "companyName": company,
    }))
}

/// Atualiza todos os valores editáveis do formulário em um único PATCH. A UI
/// preserva quantidade e rótulos; o backend mantém essa mesma classificação ao
/// projetar os telefones para os campos suportados por Microsoft Contacts.
pub fn cr_people_contact_update(
    store: &TokenStore,
    contact_id: &str,
    input: PeopleContactEdit,
) -> Result<(), String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to edit contacts.".to_string());
    }
    let contact_id = contact_id.trim();
    if contact_id.is_empty() {
        return Err("Invalid contact.".to_string());
    }
    let body = contato_body(input)?;
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/me/contacts/{}",
        urlencoding::encode(contact_id)
    );
    let resp = graph_enviar("people:contact-update", GRAPH_TETO_ESPERA_S, || {
        client
            .patch(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
    })
    .map_err(|error| format!("Failed to update contact: {error}"))?;
    if !resp.status().is_success() {
        return Err(format!("Contacts: Graph returned {}", resp.status()));
    }
    Ok(())
}

/// Atribui as categorias do Outlook a um contato (#278 S3b): PATCH parcial só
/// do campo `categories` em /me/contacts/{id}. Parcial de propósito — não mexe
/// em nome/emails/telefones (serve tanto pro detalhe quanto pro bulk). As
/// categorias são os NOMES das masterCategories (multi-valor), como no #211.
pub fn cr_people_contact_categories(
    store: &TokenStore,
    contact_id: &str,
    categorias: Vec<String>,
) -> Result<(), String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to edit contacts.".to_string());
    }
    let contact_id = contact_id.trim();
    if contact_id.is_empty() {
        return Err("Invalid contact.".to_string());
    }
    let body = serde_json::json!({ "categories": categorias });
    let token = access_token(store)?;
    let client = cliente();
    let url = format!("{GRAPH}/me/contacts/{}", urlencoding::encode(contact_id));
    let resp = graph_enviar("people:contact-categories", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|error| format!("Failed to update categories: {error}"))?;
    if !resp.status().is_success() {
        return Err(format!("Contacts: Graph returned {}", resp.status()));
    }
    Ok(())
}

/// Cria um contato completo (POST /me/contacts) e devolve o id do Graph criado.
/// Necessário pro Undo do merge (#379): recria os absorvidos deletados e
/// registra o novo id. O `cr_salvar_contatos` legado deduplica por email e não
/// devolve id, inadequado aqui.
pub fn cr_people_contact_create(
    store: &TokenStore,
    input: PeopleContactEdit,
) -> Result<String, String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to create contacts.".to_string());
    }
    let body = contato_body(input)?;
    let token = access_token(store)?;
    let client = cliente();
    let url = format!("{GRAPH}/me/contacts");
    let resp = graph_enviar("people:contact-create", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|error| format!("Failed to create contact: {error}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita("me/contacts", "criar contato", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(v["id"].as_str().unwrap_or("").to_string())
}

/// Exclui um contato (DELETE /me/contacts/{id}). 404 conta como sucesso
/// (idempotente — já removido). Contacts.ReadWrite. Usado na execução do
/// merge (#379), com resultado por item tratado no chamador.
pub fn cr_people_contact_delete(store: &TokenStore, contact_id: &str) -> Result<(), String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to delete contacts.".to_string());
    }
    let contact_id = contact_id.trim();
    if contact_id.is_empty() {
        return Err("Invalid contact.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/me/contacts/{}",
        urlencoding::encode(contact_id)
    );
    let resp = graph_enviar("people:contact-delete", GRAPH_TETO_ESPERA_S, || {
        client.delete(&url).bearer_auth(&token).send()
    })
    .map_err(|error| format!("Failed to delete contact: {error}"))?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(erro_escrita("me/contacts", "excluir contato", resp.status()))
    }
}

// ===== #562: grupos de contato PESSOAIS via /me/contactFolders (Contacts.ReadWrite)
// Distintos dos grupos M365 read-only (cr_grupos / /me/memberOf): estes são pastas
// editáveis privadas do usuário — CRUD de pasta + mover contato entre pastas. =====

/// Pasta de contatos pessoal (Graph contactFolder) — grupo editável do usuário.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactFolder {
    pub id: String,
    pub name: String,
    pub parent_folder_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactFoldersResult {
    pub folders: Vec<ContactFolder>,
    pub missing_scopes: Vec<String>,
    pub failures: Vec<String>,
}

/// Lista as pastas de contato pessoais (GET /me/contactFolders). Leitura só exige
/// Contacts.Read (subset do ReadWrite já concedido). Ordena por nome.
pub fn cr_contact_folders(store: &TokenStore) -> Result<ContactFoldersResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let mut result = ContactFoldersResult {
        folders: Vec::new(),
        missing_scopes: Vec::new(),
        failures: Vec::new(),
    };
    let mut proxima = Some(format!(
        "{GRAPH}/me/contactFolders?$top=200&$select=id,displayName,parentFolderId"
    ));
    while let Some(url) = proxima.take() {
        // Segurança (#1068): guarda forte contra next_link fora do Graph (ver cr_grupos).
        if !url_continuacao_graph_valida(&url) {
            result
                .failures
                .push("ContactFolders: continuation URL outside Microsoft Graph".to_string());
            break;
        }
        match graph_enviar("people:contact-folders", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = match resp.json() {
                    Ok(b) => b,
                    Err(e) => {
                        result
                            .failures
                            .push(format!("ContactFolders: resposta invalida ({e})"));
                        break;
                    }
                };
                proxima = body["@odata.nextLink"].as_str().map(str::to_string);
                if let Some(items) = body["value"].as_array() {
                    result.folders.extend(items.iter().filter_map(|item| {
                        let id = item["id"].as_str()?.trim();
                        if id.is_empty() {
                            return None;
                        }
                        Some(ContactFolder {
                            id: id.to_string(),
                            name: item["displayName"].as_str().unwrap_or("").trim().to_string(),
                            parent_folder_id: item["parentFolderId"]
                                .as_str()
                                .unwrap_or("")
                                .trim()
                                .to_string(),
                        })
                    }));
                }
            }
            Ok(resp) if matches!(resp.status().as_u16(), 401 | 403) => {
                result.missing_scopes.push("Contacts.Read".to_string());
                break;
            }
            Ok(resp) => {
                result
                    .failures
                    .push(format!("ContactFolders: Graph retornou {}", resp.status()));
                break;
            }
            Err(error) => {
                result
                    .failures
                    .push(format!("ContactFolders: falha de rede ({error})"));
                break;
            }
        }
    }
    result
        .folders
        .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(result)
}

/// Contatos dentro de uma pasta (GET /me/contactFolders/{id}/contacts). Devolve o
/// MESMO PeopleListResult do cr_people_list (source=contacts) → cai direto no
/// mergePeopleRecords do front, sem mudança de shape.
pub fn cr_pasta_contatos(
    store: &TokenStore,
    folder_id: &str,
    next_links: Vec<String>,
) -> Result<PeopleListResult, String> {
    let token = access_token(store)?;
    let client = cliente();
    let folder_id = folder_id.trim();
    let mut result = PeopleListResult {
        records: Vec::new(),
        missing_scopes: Vec::new(),
        failures: Vec::new(),
        next_links: Vec::new(),
    };
    if folder_id.is_empty() {
        return Ok(result);
    }
    let base = format!(
        "{GRAPH}/me/contactFolders/{}/contacts",
        urlencoding::encode(folder_id)
    );
    let urls: Vec<String> = if next_links.is_empty() {
        vec![format!(
            "{base}?$top=100&$select=id,displayName,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle,department,officeLocation,manager,categories"
        )]
    } else {
        // Segurança (#1068): guarda forte por next_link (ver cr_grupos) — descarta
        // qualquer continuação fora do Graph antes do bearer_auth.
        next_links
            .into_iter()
            .filter(|u| url_continuacao_graph_valida(u) && u.contains("/contactFolders/"))
            .collect()
    };
    for url in urls {
        match graph_enviar("people:folder-contacts", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>() {
                Ok(body) => {
                    if let Some(next_link) = body["@odata.nextLink"].as_str() {
                        result.next_links.push(next_link.to_string());
                    }
                    if let Some(items) = body["value"].as_array() {
                        result.records.extend(items.iter().filter_map(|item| {
                            let emails = emails_de_contato(item);
                            if emails.is_empty() {
                                return None;
                            }
                            Some(PeopleRecord {
                                id: item["id"].as_str().unwrap_or("").to_string(),
                                source: "contacts".to_string(),
                                name: item["displayName"].as_str().unwrap_or("").trim().to_string(),
                                emails,
                                phones: telefones_de_contato(item),
                                job_title: texto_opcional(item, "jobTitle"),
                                company: texto_opcional(item, "companyName"),
                                department: texto_opcional(item, "department"),
                                office_location: texto_opcional(item, "officeLocation"),
                                manager: texto_opcional(item, "manager"),
                                organization: false,
                                people_rank: None,
                                categories: item["categories"]
                                    .as_array()
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|c| c.as_str().map(|s| s.to_string()))
                                            .collect()
                                    })
                                    .unwrap_or_default(),
                            })
                        }));
                    }
                }
                Err(error) => result
                    .failures
                    .push(format!("FolderContacts: resposta invalida ({error})")),
            },
            Ok(resp) if matches!(resp.status().as_u16(), 401 | 403) => {
                result.missing_scopes.push("Contacts.Read".to_string());
            }
            Ok(resp) => result
                .failures
                .push(format!("FolderContacts: Graph retornou {}", resp.status())),
            Err(error) => result
                .failures
                .push(format!("FolderContacts: falha de rede ({error})")),
        }
    }
    Ok(result)
}

/// Cria uma pasta de contatos (POST /me/contactFolders). Devolve a pasta criada
/// (com o id do Graph, pro front trocar o otimista pelo real).
pub fn cr_criar_pasta_contato(store: &TokenStore, nome: &str) -> Result<ContactFolder, String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to manage contact folders.".to_string());
    }
    let nome = nome.trim();
    if nome.is_empty() {
        return Err("Invalid folder name.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!("{GRAPH}/me/contactFolders");
    let body = serde_json::json!({ "displayName": nome });
    let resp = graph_enviar("people:folder-create", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("Failed to create contact folder: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita("me/contactFolders", "criar pasta", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(ContactFolder {
        id: v["id"].as_str().unwrap_or("").to_string(),
        name: v["displayName"].as_str().unwrap_or(nome).trim().to_string(),
        parent_folder_id: v["parentFolderId"].as_str().unwrap_or("").trim().to_string(),
    })
}

/// Renomeia uma pasta de contatos (PATCH /me/contactFolders/{id} {displayName}).
pub fn cr_renomear_pasta_contato(
    store: &TokenStore,
    folder_id: &str,
    nome: &str,
) -> Result<(), String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to manage contact folders.".to_string());
    }
    let folder_id = folder_id.trim();
    let nome = nome.trim();
    if folder_id.is_empty() || nome.is_empty() {
        return Err("Invalid folder.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/me/contactFolders/{}",
        urlencoding::encode(folder_id)
    );
    let body = serde_json::json!({ "displayName": nome });
    let resp = graph_enviar("people:folder-rename", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("Failed to rename contact folder: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita("me/contactFolders", "renomear pasta", resp.status()));
    }
    Ok(())
}

/// Exclui uma pasta de contatos (DELETE /me/contactFolders/{id}). 404 = sucesso
/// (idempotente). Os contatos dentro dela são removidos junto pelo Graph.
pub fn cr_excluir_pasta_contato(store: &TokenStore, folder_id: &str) -> Result<(), String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to manage contact folders.".to_string());
    }
    let folder_id = folder_id.trim();
    if folder_id.is_empty() {
        return Err("Invalid folder.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!(
        "{GRAPH}/me/contactFolders/{}",
        urlencoding::encode(folder_id)
    );
    let resp = graph_enviar("people:folder-delete", GRAPH_TETO_ESPERA_S, || {
        client.delete(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("Failed to delete contact folder: {e}"))?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(erro_escrita("me/contactFolders", "excluir pasta", resp.status()))
    }
}

/// Move um contato para outra pasta (PATCH /me/contacts/{id} {parentFolderId}).
/// Graph v1.0 NÃO tem action /move pra contato; `parentFolderId` é atualizável no
/// PATCH e mantém o id do contato estável (sem remap de cache no front).
pub fn cr_mover_contato(
    store: &TokenStore,
    contact_id: &str,
    folder_id: &str,
) -> Result<(), String> {
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Err("Contacts.ReadWrite is required to move contacts.".to_string());
    }
    let contact_id = contact_id.trim();
    let folder_id = folder_id.trim();
    if contact_id.is_empty() || folder_id.is_empty() {
        return Err("Invalid contact or folder.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let url = format!("{GRAPH}/me/contacts/{}", urlencoding::encode(contact_id));
    let body = serde_json::json!({ "parentFolderId": folder_id });
    let resp = graph_enviar("people:contact-move", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("Failed to move contact: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita("me/contacts", "mover contato", resp.status()));
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleCompanyWriteResult {
    pub write_available: bool,
    pub saved_contact_ids: Vec<String>,
    pub failed_contact_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PeopleBulkDetailsField {
    CompanyName,
    Department,
    OfficeLocation,
}

impl PeopleBulkDetailsField {
    fn graph_key(self) -> &'static str {
        match self {
            Self::CompanyName => "companyName",
            Self::Department => "department",
            Self::OfficeLocation => "officeLocation",
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleBulkDetailsChange {
    pub field: PeopleBulkDetailsField,
    #[serde(deserialize_with = "deserialize_required_nullable_string")]
    pub value: Option<String>,
}

fn deserialize_required_nullable_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    <Option<String> as serde::Deserialize>::deserialize(deserializer)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleBulkDetailsWriteResult {
    pub write_available: bool,
    pub saved_contact_ids: Vec<String>,
    pub failed_contact_ids: Vec<String>,
}

fn people_bulk_details_body(
    changes: Vec<PeopleBulkDetailsChange>,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if changes.is_empty() {
        return Err("At least one details change is required.".to_string());
    }

    let mut seen = std::collections::HashSet::new();
    let mut body = serde_json::Map::new();
    for change in changes {
        if !seen.insert(change.field) {
            return Err(format!(
                "Duplicate bulk details field: {}.",
                change.field.graph_key()
            ));
        }
        let value = match change.value {
            Some(value) => {
                let value = value.trim();
                if value.is_empty() || value.len() > 256 {
                    return Err(format!(
                        "Invalid value for bulk details field: {}.",
                        change.field.graph_key()
                    ));
                }
                serde_json::Value::String(value.to_string())
            }
            None => serde_json::Value::Null,
        };
        body.insert(change.field.graph_key().to_string(), value);
    }
    Ok(body)
}

/// Persiste a Organization escolhida explicitamente como `companyName`.
/// O Graph limita JSON batches a 20 sub-requisições; cada envelope é casado
/// pelo `id`, pois a ordem das respostas não é garantida.
pub fn cr_people_company_write(
    store: &TokenStore,
    contact_ids: Vec<String>,
    company_name: &str,
) -> Result<PeopleCompanyWriteResult, String> {
    let company_name = company_name.trim();
    if company_name.is_empty() || company_name.len() > 256 {
        return Err("Invalid company name.".to_string());
    }

    let mut seen = std::collections::HashSet::new();
    let contact_ids: Vec<String> = contact_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && id.len() <= 512 && seen.insert(id.clone()))
        .collect();
    if contact_ids.is_empty() {
        return Ok(PeopleCompanyWriteResult {
            write_available: token_tem_escopo(store, "Contacts.ReadWrite")?,
            saved_contact_ids: Vec::new(),
            failed_contact_ids: Vec::new(),
        });
    }
    if !token_tem_escopo(store, "Contacts.ReadWrite")? {
        return Ok(PeopleCompanyWriteResult {
            write_available: false,
            saved_contact_ids: Vec::new(),
            failed_contact_ids: contact_ids,
        });
    }

    let token = access_token(store)?;
    let client = cliente();
    let mut saved_contact_ids = Vec::new();
    let mut failed_contact_ids = Vec::new();

    for chunk in contact_ids.chunks(20) {
        let requests: Vec<serde_json::Value> = chunk
            .iter()
            .enumerate()
            .map(|(index, contact_id)| {
                serde_json::json!({
                    "id": index.to_string(),
                    "method": "PATCH",
                    "url": format!(
                        "/me/contacts/{}",
                        urlencoding::encode(contact_id)
                    ),
                    "headers": { "Content-Type": "application/json" },
                    "body": { "companyName": company_name },
                })
            })
            .collect();
        let body = serde_json::json!({ "requests": requests });
        let url = format!("{GRAPH}/$batch");
        let response = match graph_enviar("people:company-write", GRAPH_TETO_ESPERA_S, || {
            client.post(&url).bearer_auth(&token).json(&body).send()
        }) {
            Ok(response) => response,
            Err(_) => {
                failed_contact_ids.extend(chunk.iter().cloned());
                continue;
            }
        };
        if !response.status().is_success() {
            failed_contact_ids.extend(chunk.iter().cloned());
            continue;
        }

        let value: serde_json::Value = match response.json() {
            Ok(value) => value,
            Err(_) => {
                failed_contact_ids.extend(chunk.iter().cloned());
                continue;
            }
        };
        let mut successful_indexes = std::collections::HashSet::new();
        for item in value["responses"].as_array().into_iter().flatten() {
            let Some(index) = item["id"]
                .as_str()
                .and_then(|id| id.parse::<usize>().ok())
            else {
                continue;
            };
            let status = item["status"].as_u64().unwrap_or_default();
            if index < chunk.len() && (200..300).contains(&status) {
                successful_indexes.insert(index);
            }
        }
        for (index, contact_id) in chunk.iter().enumerate() {
            if successful_indexes.contains(&index) {
                saved_contact_ids.push(contact_id.clone());
            } else {
                failed_contact_ids.push(contact_id.clone());
            }
        }
    }

    Ok(PeopleCompanyWriteResult {
        write_available: true,
        saved_contact_ids,
        failed_contact_ids,
    })
}

/// Aplica a mesma alteração de detalhes seguros a vários contatos pessoais.
/// O Graph limita JSON batches a 20 sub-requisições; falhas de transporte ou
/// sub-respostas não-2xx são isoladas nos IDs correspondentes.
pub fn cr_people_details_write(
    store: &TokenStore,
    contact_ids: Vec<String>,
    changes: Vec<PeopleBulkDetailsChange>,
) -> Result<PeopleBulkDetailsWriteResult, String> {
    let body = people_bulk_details_body(changes)?;

    let mut seen = std::collections::HashSet::new();
    let mut normalized_contact_ids = Vec::new();
    for contact_id in contact_ids {
        let contact_id = contact_id.trim();
        if contact_id.is_empty() || contact_id.len() > 512 {
            return Err("Invalid contact ID.".to_string());
        }
        if seen.insert(contact_id.to_string()) {
            normalized_contact_ids.push(contact_id.to_string());
        }
    }

    let write_available = token_tem_escopo(store, "Contacts.ReadWrite")?;
    if normalized_contact_ids.is_empty() {
        return Ok(PeopleBulkDetailsWriteResult {
            write_available,
            saved_contact_ids: Vec::new(),
            failed_contact_ids: Vec::new(),
        });
    }
    if !write_available {
        return Ok(PeopleBulkDetailsWriteResult {
            write_available: false,
            saved_contact_ids: Vec::new(),
            failed_contact_ids: normalized_contact_ids,
        });
    }

    let token = access_token(store)?;
    let client = cliente();
    let batch_url = format!("{GRAPH}/$batch");
    let mut saved_contact_ids = Vec::new();
    let mut failed_contact_ids = Vec::new();

    for chunk in normalized_contact_ids.chunks(20) {
        let requests: Vec<serde_json::Value> = chunk
            .iter()
            .enumerate()
            .map(|(index, contact_id)| {
                serde_json::json!({
                    "id": index.to_string(),
                    "method": "PATCH",
                    "url": format!(
                        "/me/contacts/{}",
                        urlencoding::encode(contact_id)
                    ),
                    "headers": { "Content-Type": "application/json" },
                    "body": body.clone(),
                })
            })
            .collect();
        let batch_body = serde_json::json!({ "requests": requests });
        let response = match graph_enviar("people:details-write", GRAPH_TETO_ESPERA_S, || {
            client
                .post(&batch_url)
                .bearer_auth(&token)
                .json(&batch_body)
                .send()
        }) {
            Ok(response) => response,
            Err(_) => {
                failed_contact_ids.extend(chunk.iter().cloned());
                continue;
            }
        };
        if !response.status().is_success() {
            failed_contact_ids.extend(chunk.iter().cloned());
            continue;
        }

        let value: serde_json::Value = match response.json() {
            Ok(value) => value,
            Err(_) => {
                failed_contact_ids.extend(chunk.iter().cloned());
                continue;
            }
        };
        let mut successful_indexes = std::collections::HashSet::new();
        for item in value["responses"].as_array().into_iter().flatten() {
            let Some(index) = item["id"].as_str().and_then(|id| id.parse::<usize>().ok()) else {
                continue;
            };
            let status = item["status"].as_u64().unwrap_or_default();
            if index < chunk.len() && (200..300).contains(&status) {
                successful_indexes.insert(index);
            }
        }
        for (index, contact_id) in chunk.iter().enumerate() {
            if successful_indexes.contains(&index) {
                saved_contact_ids.push(contact_id.clone());
            } else {
                failed_contact_ids.push(contact_id.clone());
            }
        }
    }

    Ok(PeopleBulkDetailsWriteResult {
        write_available: true,
        saved_contact_ids,
        failed_contact_ids,
    })
}

#[cfg(test)]
mod people_bulk_details_tests {
    use super::*;

    #[test]
    fn normalizes_values_and_represents_explicit_clear_as_null() {
        let body = people_bulk_details_body(vec![
            PeopleBulkDetailsChange {
                field: PeopleBulkDetailsField::CompanyName,
                value: Some("  Galaxie Works  ".to_string()),
            },
            PeopleBulkDetailsChange {
                field: PeopleBulkDetailsField::Department,
                value: None,
            },
        ])
        .expect("valid changes");

        assert_eq!(body["companyName"], serde_json::json!("Galaxie Works"));
        assert_eq!(body["department"], serde_json::Value::Null);
    }

    #[test]
    fn rejects_empty_duplicate_and_invalid_values() {
        assert!(people_bulk_details_body(Vec::new()).is_err());
        assert!(people_bulk_details_body(vec![
            PeopleBulkDetailsChange {
                field: PeopleBulkDetailsField::OfficeLocation,
                value: Some("London".to_string()),
            },
            PeopleBulkDetailsChange {
                field: PeopleBulkDetailsField::OfficeLocation,
                value: None,
            },
        ])
        .is_err());
        assert!(people_bulk_details_body(vec![PeopleBulkDetailsChange {
            field: PeopleBulkDetailsField::Department,
            value: Some("   ".to_string()),
        }])
        .is_err());
        assert!(people_bulk_details_body(vec![PeopleBulkDetailsChange {
            field: PeopleBulkDetailsField::Department,
            value: Some("x".repeat(257)),
        }])
        .is_err());
    }

    #[test]
    fn serde_field_whitelist_is_exact() {
        let valid: PeopleBulkDetailsChange = serde_json::from_value(serde_json::json!({
            "field": "officeLocation",
            "value": "London"
        }))
        .expect("whitelisted field");
        assert_eq!(valid.field, PeopleBulkDetailsField::OfficeLocation);

        let explicit_clear: PeopleBulkDetailsChange = serde_json::from_value(serde_json::json!({
            "field": "department",
            "value": null
        }))
        .expect("explicit null is a valid clear");
        assert_eq!(explicit_clear.value, None);

        let missing_value = serde_json::from_value::<PeopleBulkDetailsChange>(serde_json::json!({
            "field": "department"
        }));
        assert!(missing_value.is_err());

        let invalid = serde_json::from_value::<PeopleBulkDetailsChange>(serde_json::json!({
            "field": "jobTitle",
            "value": "Director"
        }));
        assert!(invalid.is_err());
    }
}

fn destinatario_tem_email(item: &serde_json::Value, email: &str) -> bool {
    item["toRecipients"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|recipient| recipient["emailAddress"]["address"].as_str())
        .any(|address| address.trim().eq_ignore_ascii_case(email))
}

/// Carrega, somente quando o detalhe abre, as mensagens recentes de/para o
/// contato. Usa Mail.Read já concedido e não cria nenhum novo requisito de
/// consentimento para o módulo People.
pub fn cr_people_interactions(
    store: &TokenStore,
    email: &str,
) -> Result<Vec<PeopleInteraction>, String> {
    let email = email.trim();
    if email.is_empty() || email.len() > 320 || !email.contains('@') {
        return Err("Invalid email address.".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let search_expression = format!("from:{email} OR to:{email}");
    let search = urlencoding::encode(&search_expression);
    let url = format!(
        "{GRAPH}/me/messages?$search=\"{search}\"\
         &$select=id,subject,receivedDateTime,sentDateTime,from,toRecipients\
         &$top=15"
    );
    let resp = graph_enviar("people:interactions", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("ConsistencyLevel", "eventual")
            .send()
    })
    .map_err(|error| format!("Failed to load interactions: {error}"))?;
    if !resp.status().is_success() {
        return Err(format!("Mail: Graph returned {}", resp.status()));
    }
    let value: serde_json::Value = resp.json().map_err(|error| error.to_string())?;
    let mut interactions: Vec<PeopleInteraction> = value["value"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let from = item["from"]["emailAddress"]["address"]
                .as_str()
                .unwrap_or("");
            let direction = if from.trim().eq_ignore_ascii_case(email) {
                "inbound"
            } else if destinatario_tem_email(item, email) {
                "outbound"
            } else {
                return None;
            };
            let occurred_at = if direction == "outbound" {
                item["sentDateTime"]
                    .as_str()
                    .or_else(|| item["receivedDateTime"].as_str())
            } else {
                item["receivedDateTime"]
                    .as_str()
                    .or_else(|| item["sentDateTime"].as_str())
            }?;
            Some(PeopleInteraction {
                id: item["id"].as_str().unwrap_or(occurred_at).to_string(),
                subject: item["subject"]
                    .as_str()
                    .filter(|subject| !subject.trim().is_empty())
                    .unwrap_or("(no subject)")
                    .to_string(),
                occurred_at: occurred_at.to_string(),
                direction: direction.to_string(),
            })
        })
        .collect();
    interactions.sort_by(|left, right| right.occurred_at.cmp(&left.occurred_at));
    interactions.truncate(15);
    Ok(interactions)
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

/// Busca pessoas para o autocomplete do compositor. Combina os contatos PESSOAIS
/// do usuario (/me/contacts) com um $search no diretorio do tenant (/users). Se um
/// dos dois falhar, usa so o que veio do outro; erro so quando AMBOS falham.
///
/// "Seus contatos" = /me/contacts (contatos que o usuario salvou — e onde
/// `cr_salvar_contatos` grava quem ele envia e-mail). "De sua organizacao" =
/// diretorio /users. Antes usavamos /me/people ("relevant people"), que retorna
/// sobretudo COLEGAS da organizacao — por isso o PO via gente do tenant sob "Seus
/// contatos" (#40). Escopos: Contacts.Read + User.Read.All.
pub fn cr_pessoas(store: &TokenStore, query: &str) -> Result<Vec<Pessoa>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // #803: gate por provider/conta (interno, provider-aware). Google não tem MS
    // Graph people → [] sem tocar Graph. MS PESSOAL não tem diretório da org
    // (/users) → busca só em /me/contacts. Evita o 401 spam e o Err do fim.
    let (eh_google, eh_org) = {
        let guard = store
            .inner
            .lock()
            .map_err(|_| "estado de token corrompido".to_string())?;
        match guard.as_ref() {
            Some(t) => (
                t.account.provider == crate::auth::Provider::Google,
                crate::config::eh_org(&t.tenant),
            ),
            None => (false, true), // sem sessão em memória: comporta como antes.
        }
    };
    if eh_google {
        return Ok(Vec::new());
    }
    let token = access_token(store)?;
    let client = cliente();
    let enc = urlencoding::encode(q);

    let mut resultados: Vec<Pessoa> = Vec::new();
    let mut algum_ok = false;

    // 1) Contatos PESSOAIS do usuario (/me/contacts) — a agenda dele de verdade.
    let url = format!(
        "{GRAPH}/me/contacts?$search=\"{enc}\"&$top=8&$select=displayName,emailAddresses,jobTitle"
    );
    // Sob o pool + retry central (#64): Retry-After + jitter. GET idempotente.
    match graph_enviar("pessoas:people", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    }) {
        Ok(resp) if resp.status().is_success() => {
            algum_ok = true;
            if let Ok(v) = resp.json::<serde_json::Value>() {
                if let Some(items) = v["value"].as_array() {
                    for it in items {
                        let nome = it["displayName"].as_str().unwrap_or("").to_string();
                        let email = it["emailAddresses"][0]["address"]
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
        Ok(resp) => log::warn!("[pessoas] /me/contacts retornou {}", resp.status()),
        Err(e) => log::warn!("[pessoas] /me/contacts falhou: {e}"),
    }

    // 2) Diretorio da organizacao (/users) — ORG-ONLY (#803): MS pessoal não tem
    // diretório, então só a conta work bate aqui. $search exige ConsistencyLevel.
    if eh_org {
    let url = format!(
        "{GRAPH}/users?$search=\"displayName:{enc}\"&$top=8&$select=displayName,mail,userPrincipalName,jobTitle"
    );
    // Sob o pool + retry central (#64): Retry-After + jitter. GET idempotente.
    match graph_enviar("pessoas:diretorio", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(&token)
            .header("ConsistencyLevel", "eventual")
            .send()
    }) {
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
    } // fim do gate eh_org (#803)

    // #803: conta MS pessoal só busca /me/contacts — se ele respondeu (mesmo
    // vazio), é sucesso; não é "falha" por não ter diretório de org.
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
    mailbox: Option<&str>,
) -> Result<(), String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

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

    // Sob o pool + retry central (#64): concorrência + Retry-After + jitter.
    // ⚠️ sendMail NÃO é idempotente, mas o retry aqui é SEGURO porque
    // `graph_enviar` só re-tenta em 429 — e um 429 é rejeição ANTES de processar
    // (a mensagem não chegou a ser enviada), então reenviar não duplica o envio.
    // Erro de transporte/timeout (envio AMBÍGUO, que pode ter aplicado) NÃO é
    // re-tentado: `graph_enviar` propaga o erro do reqwest na hora. 5xx também não
    // re-tenta (devolve a resposta e o chamador vira erro). Ou seja: cega
    // reemissão de um sendMail já potencialmente aplicado nunca acontece.
    let url = format!("{GRAPH}/{prefix}/sendMail");
    let resp = graph_enviar("mail:enviar", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao enviar o e-mail: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_envio(&prefix, "envio", resp.status()));
    }
    Ok(())
}

/// Salva os contatos informados na pasta pessoal do usuario, sem duplicar.
/// Retorna quantos foram efetivamente criados. Contacts.ReadWrite.
pub fn cr_salvar_contatos(store: &TokenStore, pessoas: Vec<Pessoa>) -> Result<u64, String> {
    let token = access_token(store)?;
    let client = cliente();

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
        // Sob o pool + retry central (#64): Retry-After + jitter. GET idempotente.
        let existe = match graph_enviar("contatos:existe", GRAPH_TETO_ESPERA_S, || {
            client.get(&url).bearer_auth(&token).send()
        }) {
            Ok(resp) if resp.status().is_success() => resp
                .json::<serde_json::Value>()
                .ok()
                .and_then(|v| v["value"].as_array().map(|a| !a.is_empty()))
                .unwrap_or(false),
            Ok(resp) => {
                // #1076 (RB48/LGPD): e-mail do contato mascarado no log (PII).
                log::warn!("[contatos] filtro '{}' retornou {}", mascarar_email(email), resp.status());
                // Nao da pra ter certeza: pula para nao arriscar duplicar.
                true
            }
            Err(e) => {
                log::warn!("[contatos] filtro '{}' falhou: {e}", mascarar_email(email));
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
        // Sob o pool + retry central (#64): Retry-After + jitter. ⚠️ Criar contato
        // NÃO é idempotente, mas é seguro aqui: (a) só criamos DEPOIS de o filtro
        // acima não achar duplicado, e (b) o retry do pool só dispara em 429
        // (rejeitado antes de criar) — reenviar não gera contato em dobro. Erro de
        // transporte/timeout e 5xx não re-tentam (propaga/retorna ao chamador).
        let criar_url = format!("{GRAPH}/me/contacts");
        match graph_enviar("contatos:criar", GRAPH_TETO_ESPERA_S, || {
            client.post(&criar_url).bearer_auth(&token).json(&body).send()
        }) {
            Ok(resp) if resp.status().is_success() => criados += 1,
            // #1076 (RB48/LGPD): e-mail do contato mascarado no log (PII).
            Ok(resp) => log::warn!("[contatos] criar '{}' retornou {}", mascarar_email(email), resp.status()),
            Err(e) => log::warn!("[contatos] criar '{}' falhou: {e}", mascarar_email(email)),
        }
    }
    Ok(criados)
}

/// Subpastas de uma pasta de e-mail. O id do filho serve direto no endpoint de
/// mensagens, entao o caminho existente de carga funciona sem mudanca. Mail.Read.
pub fn cr_subpastas(
    store: &TokenStore,
    folder_id: &str,
    mailbox: Option<&str>,
) -> Result<Vec<PastaEmail>, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!(
        "{GRAPH}/{prefix}/mailFolders/{folder_id}/childFolders\
         ?$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount&$top=50"
    );
    // Sob o pool + retry central (#64): Retry-After + jitter. GET idempotente.
    let resp = graph_enviar("mail:subpastas", GRAPH_TETO_ESPERA_S, || {
        client.get(&url).bearer_auth(&token).send()
    })
    .map_err(|e| format!("falha ao ler as subpastas: {e}"))?;
    if !resp.status().is_success() {
        if resp.status().as_u16() == 403 {
            return Err("acesso parcial: sem permissão para abrir esta pasta".to_string());
        }
        return Err(format!(
            "/{prefix}/mailFolders/childFolders retornou {}",
            resp.status()
        ));
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
                acesso_negado: false,
            });
        }
    }
    Ok(pastas)
}

// ----------------------------------------------------------------------------
// CRUD de PASTAS (#90) — criar / renomear / excluir / mover subpastas.
//
// Todas as chamadas passam pelo `graph_enviar` (pool de concorrência + retry no
// 429 respeitando Retry-After + jitter, #64) — nada de retry ad-hoc aqui.
// Escopo: Mail.ReadWrite (o mesmo já concedido; nenhum re-consent novo).
//
// O front só oferece essas ações em pasta CUSTOM (`tipo == "child"`), fora
// "Criar subpasta", que também vale em inbox/archive — mas o backend aceita
// qualquer id: quem decide o que aparece é a UI (decisão do PO na #71/S4:
// esconder as ações inválidas em well-known, não desabilitar).
// ----------------------------------------------------------------------------

/// Converte a resposta de um mailFolder do Graph no `PastaEmail` do front.
/// `tipo` é sempre "child": tudo que este CRUD cria/altera é subpasta custom
/// (well-known não passa por aqui) — é essa chave que o front usa pro ícone e
/// para liberar as ações do menu de contexto.
fn pasta_de_json(v: &serde_json::Value) -> PastaEmail {
    PastaEmail {
        id: v["id"].as_str().unwrap_or("").to_string(),
        tipo: "child".to_string(),
        nome: v["displayName"].as_str().unwrap_or("").to_string(),
        nao_lidos: v["unreadItemCount"].as_u64().unwrap_or(0),
        total: v["totalItemCount"].as_u64().unwrap_or(0),
        filhos: v["childFolderCount"].as_u64().unwrap_or(0),
        acesso_negado: false,
    }
}

/// Cria uma subpasta dentro de `pai_id` (`POST /me/mailFolders/{pai}/childFolders`
/// com `{displayName}`). `pai_id` aceita well-known ("inbox", "archive") ou o id
/// real de uma pasta custom. Retorna a pasta criada.
///
/// Nome duplicado: o Graph responde 409 (ErrorFolderExists) e a mensagem de erro
/// sobe pro front — que já barra o duplicado *antes* de chamar, comparando com
/// as irmãs conhecidas. O 409 é a rede de segurança pro caso de a pasta ter sido
/// criada em outro cliente (Outlook Web) desde o último carregamento.
/// Mail.ReadWrite.
pub fn cr_criar_subpasta(
    store: &TokenStore,
    pai_id: &str,
    nome: &str,
    mailbox: Option<&str>,
) -> Result<PastaEmail, String> {
    let nome = nome.trim();
    if nome.is_empty() {
        return Err("o nome da pasta não pode ficar vazio".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!("{GRAPH}/{prefix}/mailFolders/{pai_id}/childFolders");
    let body = serde_json::json!({ "displayName": nome });
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let resp = graph_enviar("mail:criar-subpasta", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao criar a subpasta: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        return Err(erro_escrita(&prefix, "criar subpasta", st));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(pasta_de_json(&v))
}

/// Renomeia uma pasta (`PATCH /me/mailFolders/{id}` com `{displayName}`).
/// Retorna a pasta já com o nome novo. Mail.ReadWrite.
pub fn cr_renomear_pasta(
    store: &TokenStore,
    id: &str,
    nome: &str,
    mailbox: Option<&str>,
) -> Result<PastaEmail, String> {
    let nome = nome.trim();
    if nome.is_empty() {
        return Err("o nome da pasta não pode ficar vazio".to_string());
    }
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    let url = format!("{GRAPH}/{prefix}/mailFolders/{id}");
    let body = serde_json::json!({ "displayName": nome });
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let resp = graph_enviar("mail:renomear-pasta", GRAPH_TETO_ESPERA_S, || {
        client.patch(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao renomear a pasta: {e}"))?;
    if !resp.status().is_success() {
        return Err(erro_escrita(&prefix, "renomear pasta", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(pasta_de_json(&v))
}

/// Move uma pasta INTEIRA (com mensagens e subpastas) para dentro de outra:
/// `POST /me/mailFolders/{id}/move` com `{destinationId}`. `destino` aceita
/// well-known ("archive", "deleteditems") ou id real. Retorna a pasta no novo
/// lugar. Mail.ReadWrite.
///
/// É o mesmo endpoint que o "excluir pasta" usa (destino = "deleteditems"), daí
/// o helper compartilhado.
fn mover_pasta_graph(
    client: &reqwest::blocking::Client,
    token: &str,
    prefix: &str,
    id: &str,
    destino: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{GRAPH}/{prefix}/mailFolders/{id}/move");
    let body = serde_json::json!({ "destinationId": destino });
    // Sob o pool + retry central (#64): Retry-After + jitter.
    let resp = graph_enviar("mail:mover-pasta", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(token).json(&body).send()
    })
    .map_err(|e| format!("falha ao mover a pasta: {e}"))?;
    let st = resp.status();
    if !st.is_success() {
        return Err(erro_escrita(prefix, "mover pasta", st));
    }
    resp.json::<serde_json::Value>().map_err(|e| e.to_string())
}

/// Move uma pasta para dentro de `novo_pai` (#90). O front impede escolher a
/// própria pasta ou uma descendente como destino (isso o Graph rejeitaria, mas
/// barrar na UI evita a viagem e dá mensagem melhor). Mail.ReadWrite.
pub fn cr_mover_pasta(
    store: &TokenStore,
    id: &str,
    novo_pai: &str,
    mailbox: Option<&str>,
) -> Result<PastaEmail, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);
    let v = mover_pasta_graph(&client, &token, &prefix, id, novo_pai)?;
    Ok(pasta_de_json(&v))
}

/// Exclui uma pasta — **movendo para a Lixeira**, não apagando de vez.
///
/// Decisão do PO na #71/D3: exclusão de pasta é REVERSÍVEL. Então a via
/// primária é `POST /me/mailFolders/{id}/move` com `destinationId:"deleteditems"`
/// — a pasta (com o conteúdo) vira subpasta de Itens Excluídos e o usuário pode
/// arrastar de volta no Outlook.
///
/// `DELETE /me/mailFolders/{id}` só entra como FALLBACK, e apenas quando o move
/// falhou por não ser suportado naquele item (4xx que não seja 429 — o 429 já é
/// tratado pelo `graph_enviar`). Isso cobre o caso de o tenant/pasta recusar o
/// move; o DELETE é definitivo, por isso nunca é a primeira escolha.
/// Retorna `true` quando foi para a lixeira e `false` quando caiu no DELETE —
/// o front usa isso para escolher o texto do toast (reversível vs definitivo).
/// Mail.ReadWrite.
pub fn cr_excluir_pasta(
    store: &TokenStore,
    id: &str,
    mailbox: Option<&str>,
) -> Result<bool, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    match mover_pasta_graph(&client, &token, &prefix, id, "deleteditems") {
        Ok(_) => Ok(true),
        Err(e) if eh_erro_permissao(&e) => Err(e),
        Err(e) => {
            log::warn!(
                "[mail] excluir pasta '{id}': move p/ lixeira falhou ({e}); tentando DELETE"
            );
            let url = format!("{GRAPH}/{prefix}/mailFolders/{id}");
            // Sob o pool + retry central (#64): Retry-After + jitter.
            let resp = graph_enviar("mail:excluir-pasta", GRAPH_TETO_ESPERA_S, || {
                client.delete(&url).bearer_auth(&token).send()
            })
            .map_err(|e| format!("falha ao excluir a pasta: {e}"))?;
            // 404 = a pasta já não existe: idempotente.
            if resp.status().is_success() || resp.status().as_u16() == 404 {
                Ok(false)
            } else {
                let erro_delete = erro_escrita(&prefix, "excluir pasta", resp.status());
                Err(format!("{erro_delete} (move p/ lixeira antes: {e})"))
            }
        }
    }
}

/// Os dois contadores por-pasta que a UI mostra nas abas (Sinalizados / Com
/// anexos), buscados juntos.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Contadores {
    pub flagged: u64,
    pub anexos: u64,
}

/// Conta, em UMA chamada `$batch`, os dois contadores por-pasta que a UI exibe
/// nas abas: Sinalizados (flagged) e Com anexos (files). Substitui as DUAS
/// chamadas `/$count` separadas (`cr_contar` ×2) que a carga inicial disparava em
/// paralelo — parte da rajada de 429 que o #64/#87 ataca. 2 requests → 1.
///
/// O contador de NÃO LIDOS de propósito NÃO entra aqui: ele já chega coalescido
/// (uma request para TODAS as pastas) em `cr_mail_folders` e carrega os ajustes
/// otimistas do front (marcar lido/excluir). Recontá-lo por pasta aqui seria
/// redundante e reintroduziria a divergência/piscar que o front evita.
///
/// Cada sub-requisição é um GET `/$count` com `$filter` (exige
/// `ConsistencyLevel: eventual`, setado por sub-requisição). O `$batch` inteiro
/// passa pelo `graph_enviar` (pool + Retry-After + jitter, #64): o 429 costuma
/// vir no ENVELOPE e é re-tentado ali. Se ainda assim uma SUB-resposta falhar, o
/// contador daquela aba cai no fallback 0 (degradação graciosa aceita pelo AC —
/// a lista nunca fica vazia por causa de um contador). Mail.Read.
pub fn cr_contadores(
    store: &TokenStore,
    folder_id: &str,
    mailbox: Option<&str>,
) -> Result<Contadores, String> {
    let token = access_token(store)?;
    let client = cliente();
    let prefix = mailbox_prefix(mailbox);

    // O `id` de cada sub-requisição casa a resposta de volta (o Graph não garante
    // a ordem das sub-respostas). Mesmas expressões OData do `cr_contar`.
    let filtros: [(&str, &str); 2] = [
        ("flagged", "flag/flagStatus eq 'flagged'"),
        ("anexos", "hasAttachments eq true"),
    ];
    let requests: Vec<serde_json::Value> = filtros
        .iter()
        .map(|(id, odata)| {
            serde_json::json!({
                "id": id,
                "method": "GET",
                "url": format!(
                    "/{prefix}/mailFolders/{folder_id}/messages/$count?$filter={}",
                    urlencoding::encode(odata)
                ),
                "headers": { "ConsistencyLevel": "eventual" },
            })
        })
        .collect();
    let body = serde_json::json!({ "requests": requests });
    let url = format!("{GRAPH}/$batch");

    let resp = graph_enviar("mail:contadores", GRAPH_TETO_ESPERA_S, || {
        client.post(&url).bearer_auth(&token).json(&body).send()
    })
    .map_err(|e| format!("falha ao contar: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/$batch (contadores) retornou {}", resp.status()));
    }

    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(contadores_de_batch(&v))
}

/// Extrai `Contadores` do JSON de resposta do `$batch` — lógica PURA (sem rede),
/// para ser exercitada em teste. Casa cada sub-resposta pelo `id` (o Graph não
/// garante a ordem), aceita o corpo do `/$count` como número JSON (42) OU string
/// ("42"), e trata qualquer sub-resposta que não seja 200 como 0 (degradação
/// graciosa: um contador que falhou não zera a lista nem estoura a chamada toda).
fn contadores_de_batch(v: &serde_json::Value) -> Contadores {
    let mut out = Contadores::default();
    if let Some(items) = v["responses"].as_array() {
        for it in items {
            if it["status"].as_u64().unwrap_or(0) != 200 {
                continue; // sub-falha → mantém 0 (degradação graciosa)
            }
            let n = it["body"]
                .as_u64()
                .or_else(|| it["body"].as_str().and_then(|s| s.trim().parse().ok()))
                .unwrap_or(0);
            match it["id"].as_str().unwrap_or("") {
                "flagged" => out.flagged = n,
                "anexos" => out.anexos = n,
                _ => {}
            }
        }
    }
    out
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

    /// SEGURANÇA DAS ESCRITAS (#97): o pool só re-tenta em 429. Um 5xx (ou
    /// qualquer status != 429) é devolvido ao chamador SEM re-tentar. É essa
    /// propriedade que torna seguro envolver operações NÃO-idempotentes
    /// (`cr_enviar_novo`/sendMail, `cr_salvar_contatos`/criar contato) no
    /// `graph_enviar`: só o 429 — rejeição ANTES de aplicar — dispara reenvio;
    /// um 5xx ambíguo (que PODE ter aplicado) nunca é reemitido cegamente.
    #[test]
    fn erro_5xx_nao_re_tenta() {
        let _t = trava_pool();
        for status in [500u16, 502, 503, 400, 404] {
            let mut tentativas = 0u8;
            let r: Result<RespostaFake, ()> = executar_com_pool("qa-5xx", 5, || {
                tentativas += 1;
                Ok(RespostaFake { status, retry_after: None })
            });
            assert_eq!(r.unwrap().status_u16(), status);
            assert_eq!(tentativas, 1, "status {status} NAO devia ter re-tentado");
        }
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
// Testes do $batch dos contadores (#87) — prova de que 1 request devolve os
// dois contadores certos, casando por id (ordem não garantida), aceitando corpo
// número OU string, e degradando pra 0 numa sub-resposta que falhou.
//
// Rodar: cargo test --lib graph::testes_contadores
// ---------------------------------------------------------------------------
#[cfg(test)]
mod testes_contadores {
    use super::*;

    #[test]
    fn casa_por_id_fora_de_ordem_e_aceita_numero_ou_string() {
        // Sub-respostas propositalmente FORA de ordem (anexos antes de flagged) e
        // com corpos de tipos diferentes: número JSON e string — os dois válidos.
        let v = serde_json::json!({
            "responses": [
                { "id": "anexos",  "status": 200, "body": "42" },
                { "id": "flagged", "status": 200, "body": 7 }
            ]
        });
        let c = contadores_de_batch(&v);
        assert_eq!(c.flagged, 7, "flagged casou pelo id, não pela posição");
        assert_eq!(c.anexos, 42, "anexos aceitou o corpo em string");
    }

    #[test]
    fn sub_resposta_com_erro_degrada_para_zero() {
        // flagged OK; anexos tomou 429 (raro, mas possível numa sub-resposta): o
        // contador que falhou vira 0 em vez de derrubar a chamada inteira (AC:
        // "degradação graciosa dos contadores é aceitável").
        let v = serde_json::json!({
            "responses": [
                { "id": "flagged", "status": 200, "body": 3 },
                { "id": "anexos",  "status": 429, "body": { "error": {} } }
            ]
        });
        let c = contadores_de_batch(&v);
        assert_eq!(c.flagged, 3);
        assert_eq!(c.anexos, 0, "sub-falha não pode virar lixo — cai em 0");
    }

    #[test]
    fn respostas_ausentes_viram_zero() {
        let c = contadores_de_batch(&serde_json::json!({}));
        assert_eq!(c.flagged, 0);
        assert_eq!(c.anexos, 0);
    }
}

// ---------------------------------------------------------------------------
// #440 (Atoms A1): o parse do $batch de e-mail do dashboard. Garante que casa por
// id (ordem não garantida), que o não-lido é sinal-chave (sub-falha → Err, nada
// de "0 mentiroso"), e que sinalizados/recentes degradam graciosamente.
//
// Rodar: cargo test --lib graph::testes_atoms_email
// ---------------------------------------------------------------------------
#[cfg(test)]
mod testes_atoms_email {
    use super::*;

    #[test]
    fn casa_por_id_fora_de_ordem() {
        // Sub-respostas fora de ordem; corpo do /$count como número e como string.
        let v = serde_json::json!({
            "responses": [
                { "id": "recentes", "status": 200, "body": { "value": [
                    { "subject": "Fatura", "from": { "emailAddress": { "name": "Financeiro" } }, "receivedDateTime": "2026-08-02T10:00:00Z" }
                ] } },
                { "id": "sinalizados", "status": 200, "body": "3" },
                { "id": "naoLidos", "status": 200, "body": { "unreadItemCount": 429 } }
            ]
        });
        let e = atoms_email_de_batch(&v).expect("naoLidos 200 → Ok");
        assert_eq!(e.nao_lidos, 429, "não-lido casou pelo id");
        assert_eq!(e.sinalizados, 3, "sinalizados aceitou corpo em string");
        assert_eq!(e.recentes.len(), 1);
        assert_eq!(e.recentes[0].assunto, "Fatura");
        assert_eq!(e.recentes[0].de, "Financeiro");
    }

    #[test]
    fn nao_lido_com_erro_propaga() {
        // O não-lido é o sinal-chave: se a sub-resposta dele falhar, a função
        // inteira falha (AC4 — nada de "0 não-lidos" falso sob 429).
        let v = serde_json::json!({
            "responses": [
                { "id": "naoLidos", "status": 429, "body": { "error": {} } },
                { "id": "sinalizados", "status": 200, "body": 2 }
            ]
        });
        assert!(atoms_email_de_batch(&v).is_err(), "sub-falha do não-lido → Err");
    }

    #[test]
    fn sinalizados_e_recentes_degradam() {
        // Não-lido OK; sinalizados e recentes falharam: caem no default sem
        // derrubar a chamada (são enriquecimento, não sinal-chave).
        let v = serde_json::json!({
            "responses": [
                { "id": "naoLidos", "status": 200, "body": { "unreadItemCount": 5 } },
                { "id": "sinalizados", "status": 429, "body": { "error": {} } },
                { "id": "recentes", "status": 503, "body": { "error": {} } }
            ]
        });
        let e = atoms_email_de_batch(&v).expect("não-lido OK → Ok mesmo com o resto falho");
        assert_eq!(e.nao_lidos, 5);
        assert_eq!(e.sinalizados, 0, "sub-falha vira 0, não lixo");
        assert!(e.recentes.is_empty());
    }

    #[test]
    fn sem_nao_lidos_e_erro() {
        // Envelope sem a sub-resposta do não-lido = não dá pra afirmar "0": Err.
        let v = serde_json::json!({ "responses": [
            { "id": "sinalizados", "status": 200, "body": 1 }
        ] });
        assert!(atoms_email_de_batch(&v).is_err());
    }

    #[test]
    fn chave_por_minuto_trunca_e_coalesce() {
        // Dois instantes no MESMO minuto → mesma chave (coalesce o boot); ms
        // diferentes não geram chaves novas (o que vazaria o mapa).
        let a = chave_por_minuto("2026-08-03T10:23:45.123Z");
        let b = chave_por_minuto("2026-08-03T10:23:59.998Z");
        assert_eq!(a, "2026-08-03T10:23");
        assert_eq!(a, b, "mesmo minuto → mesma chave");
        // Minuto seguinte → chave diferente (dado fresco após o TTL).
        assert_ne!(a, chave_por_minuto("2026-08-03T10:24:00.000Z"));
        // Robusto a string curta/inesperada: devolve a própria entrada.
        assert_eq!(chave_por_minuto("curto"), "curto");
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
// Escopo: User.Read.All (admin consent já concedido; ver config::SCOPES_ORG). Só faz
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
    let client = cliente();

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

// ---------------------------------------------------------------------------
// Insights do remetente (#94)
// ---------------------------------------------------------------------------

/// Resumo do relacionamento com um endereço, exibido no popover do leitor do
/// Bridge. Todos os campos são `Option`: cada parte é buscada de forma
/// independente e best-effort, então uma sub-chamada que falhe vira `None` sem
/// derrubar o painel (insights são secundários).
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InsightsRemetente {
    /// Nº de e-mails RECEBIDOS deste endereço (filtro por `from`).
    pub recebidos: Option<u64>,
    /// Nº de e-mails ENVIADOS a este endereço (pasta Enviados). Best-effort:
    /// `None` quando o tenant não aceita o filtro por destinatário ou a chamada
    /// falha — nesse caso a UI mostra só os recebidos.
    pub enviados: Option<u64>,
    /// Data (ISO) do e-mail recebido mais ANTIGO deste remetente (1º contato).
    pub primeiro: Option<String>,
    /// Data (ISO) do e-mail recebido mais RECENTE deste remetente (último contato).
    pub ultimo: Option<String>,
}

/// Insights do remetente (#94): quantos e-mails recebidos deste endereço,
/// quantos enviados a ele, e a data do 1º e do último e-mail recebido.
///
/// CUSTO (chamadas Graph, todas sob o pool + retry #64; disparadas LAZY, só
/// quando o usuário abre o popover): até 4 GET por endereço.
///   1. recebidos: `/me/messages/$count?$filter=from/emailAddress/address eq '{addr}'`
///   2. último:    `/me/messages?$filter=(receivedDateTime ge <epoch>) and (from…)`
///                 `&$orderby=receivedDateTime desc&$top=1&$select=receivedDateTime`
///   3. primeiro:  idem, `$orderby=receivedDateTime asc`
///   4. enviados:  `/me/mailFolders/sentitems/messages/$count`
///                 `?$filter=toRecipients/any(r:r/emailAddress/address eq '{addr}')`
/// As chamadas 2 e 3 só rodam quando `recebidos > 0` (poupa 2 GET no 1º contato).
///
/// Notas de API: `/$count` e o combo `$filter`+`$orderby` exigem o header
/// `ConsistencyLevel: eventual`. O Graph só aceita `$filter` junto de `$orderby`
/// quando a propriedade ordenada (`receivedDateTime`) TAMBÉM aparece no filtro —
/// por isso a cláusula `receivedDateTime ge <epoch>` (sempre verdadeira), que é
/// o workaround documentado pela Microsoft — E precisa vir ANTES da cláusula
/// `from` (senão o Graph devolve 400 "restriction or sort order too complex";
/// era o bug do #94). Ver `data_extrema_recebido`.
///
/// Só propaga erro se a contagem de recebidos — a âncora — falhar de fato
/// (rede/auth/permissão), para o front mostrar o estado de erro discreto. As
/// demais partes degradam para `None`. Mail.Read.
pub fn cr_insights_remetente(
    store: &TokenStore,
    endereco: &str,
) -> Result<InsightsRemetente, String> {
    let token = access_token(store)?;
    let client = cliente();

    let addr = endereco.trim().to_lowercase();
    if addr.is_empty() {
        return Err("endereço vazio".into());
    }
    // Aspas simples no OData escapam duplicando (' → '').
    let addr_odata = addr.replace('\'', "''");

    // 1. Recebidos (âncora). Falha aqui = erro real → propaga.
    let filtro_from = format!("from/emailAddress/address eq '{addr_odata}'");
    let recebidos = contar_mensagens(&client, &token, "me/messages", &filtro_from)
        .map_err(|e| format!("falha ao contar recebidos: {e}"))?;

    // 2/3. Datas do 1º e do último recebido — só fazem sentido se há recebidos.
    let (mut primeiro, mut ultimo) = (None, None);
    if recebidos > 0 {
        ultimo = data_extrema_recebido(&client, &token, &addr_odata, false);
        primeiro = data_extrema_recebido(&client, &token, &addr_odata, true);
    }

    // 4. Enviados (best-effort): conta na pasta Enviados por destinatário.
    let filtro_to =
        format!("toRecipients/any(r:r/emailAddress/address eq '{addr_odata}')");
    let enviados =
        contar_mensagens(&client, &token, "me/mailFolders/sentitems/messages", &filtro_to)
            .ok();

    Ok(InsightsRemetente {
        recebidos: Some(recebidos),
        enviados,
        primeiro,
        ultimo,
    })
}

/// `GET {caminho}/$count?$filter=…` com `ConsistencyLevel: eventual`. O `/$count`
/// devolve o total como texto puro. Sob o pool + retry (#64).
fn contar_mensagens(
    client: &reqwest::blocking::Client,
    token: &str,
    caminho: &str,
    filtro_odata: &str,
) -> Result<u64, String> {
    let url = format!(
        "{GRAPH}/{caminho}/$count?$filter={}",
        urlencoding::encode(filtro_odata)
    );
    let resp = graph_enviar("mail:insights:contar", GRAPH_TETO_ESPERA_S, || {
        client
            .get(&url)
            .bearer_auth(token)
            .header("ConsistencyLevel", "eventual")
            .send()
    })
    .map_err(|e| format!("falha ao contar: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/$count retornou {}", resp.status()));
    }
    let corpo = resp.text().map_err(|e| e.to_string())?;
    corpo
        .trim()
        .parse::<u64>()
        .map_err(|e| format!("resposta do /$count não é número ('{corpo}'): {e}"))
}

/// Data (`receivedDateTime`) do e-mail recebido mais antigo (`asc=true`) ou mais
/// recente (`asc=false`) de um endereço. Best-effort: devolve `None` se a chamada
/// ou o parse falharem. Ver as notas de API em `cr_insights_remetente` sobre o
/// combo `$filter`+`$orderby`.
///
/// BUG #94 (corrigido): a ORDEM das cláusulas no `$filter` importa. Quando o
/// Graph combina `$filter`+`$orderby`, a propriedade ordenada
/// (`receivedDateTime`) precisa aparecer no `$filter` ANTES das que NÃO estão no
/// `$orderby` (`from/emailAddress/address`). Com a ordem invertida o Graph
/// devolve 400 *"The restriction or sort order is too complex for this
/// operation."* — a chamada virava `None` e sumiam 1º/último contato e a
/// frequência (mesmo com `recebidos > 0`), exatamente o que o PO reprovou no
/// remetente unidirecional "VOAZ | SERVER". Por isso `receivedDateTime ge …` vem
/// PRIMEIRO no filtro agora.
///
/// Robustez extra: se a query combinada ainda falhar, o caso "último" (desc) cai
/// num fallback sem `$orderby` — `/me/messages` já vem ordenado por
/// `receivedDateTime desc`, então `$top=1` filtrado pelo remetente dá o mais
/// recente. Não há fallback barato p/ "primeiro" (asc) sem varrer tudo.
fn data_extrema_recebido(
    client: &reqwest::blocking::Client,
    token: &str,
    addr_odata: &str,
    asc: bool,
) -> Option<String> {
    let dir = if asc { "asc" } else { "desc" };
    // Ordem correta: a propriedade do $orderby (receivedDateTime) ANTES do from.
    let filtro = format!(
        "(receivedDateTime ge 1970-01-01T00:00:00Z) and \
         (from/emailAddress/address eq '{addr_odata}')"
    );
    let url = format!(
        "{GRAPH}/me/messages?$filter={}&$orderby=receivedDateTime%20{dir}\
         &$top=1&$select=receivedDateTime",
        urlencoding::encode(&filtro)
    );
    if let Some(data) = buscar_data(client, token, &url) {
        return Some(data);
    }

    // Fallback só p/ o "último" recebido: sem $orderby (evita o combo frágil),
    // aproveitando a ordem default de /me/messages (receivedDateTime desc).
    if !asc {
        let filtro_from = format!("from/emailAddress/address eq '{addr_odata}'");
        let url = format!(
            "{GRAPH}/me/messages?$filter={}&$top=1&$select=receivedDateTime",
            urlencoding::encode(&filtro_from)
        );
        return buscar_data(client, token, &url);
    }
    None
}

/// GET numa URL de mensagens e extrai `value[0].receivedDateTime`. `None` em
/// qualquer falha de rede/status/parse. Sob o pool + retry (#64).
fn buscar_data(
    client: &reqwest::blocking::Client,
    token: &str,
    url: &str,
) -> Option<String> {
    let resp = graph_enviar("mail:insights:data", GRAPH_TETO_ESPERA_S, || {
        client
            .get(url)
            .bearer_auth(token)
            .header("ConsistencyLevel", "eventual")
            .send()
    })
    .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().ok()?;
    v["value"][0]["receivedDateTime"]
        .as_str()
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{Account, AccountKind, OrgStatus, Provider, TokenStore, Tokens};

    /// Sessao com token vencido e SEM refresh: `access_token` falha na hora, sem
    /// rede. E isso que torna os testes abaixo testes de COMPORTAMENTO e nao de
    /// texto — se o gate do #803 sumir, a chamada escorrega ate o `access_token`
    /// e o resultado vira `Err`.
    fn store_sem_token(provider: Provider, tenant: &str) -> TokenStore {
        let conta = Account {
            display_name: "Teste".to_string(),
            email: "teste@exemplo.com".to_string(),
            initials: "T".to_string(),
            photo: None,
            organizacao: None,
            provider,
            account_kind: AccountKind::Personal,
            org_status: OrgStatus::None,
            domain: None,
            tenant_id: None,
            capabilities: Vec::new(),
        };
        TokenStore {
            inner: std::sync::Mutex::new(Some(Tokens {
                access_token: String::new(),
                refresh_token: None,
                expires_at: 0,
                account: conta,
                tenant: tenant.to_string(),
                scopes: String::new(),
            })),
        }
    }

    /// #803 (gate perdido no PR #818): conta Google nao tem MS Graph People. O
    /// gate tem que devolver lista vazia ANTES de pedir token — nunca tocar o
    /// Graph nem gerar erro na cara do usuario.
    #[test]
    fn cr_pessoas_com_google_devolve_vazio_sem_pedir_token() {
        let store = store_sem_token(Provider::Google, "common");
        match cr_pessoas(&store, "ana") {
            Ok(pessoas) => assert!(pessoas.is_empty(), "Google nao pode devolver pessoa"),
            Err(e) => panic!("Google deveria sair pelo gate, veio erro: {e}"),
        }
    }

    /// Controle adversarial do teste acima: se alguem "consertar" o gate
    /// devolvendo vazio pra todo mundo, este teste quebra. Microsoft PRECISA
    /// passar do gate e chegar no `access_token` (que aqui falha por falta de
    /// sessao valida).
    #[test]
    fn cr_pessoas_com_microsoft_passa_do_gate_e_exige_token() {
        let store = store_sem_token(Provider::Microsoft, crate::config::MS_PERSONAL_TENANT);
        assert!(
            cr_pessoas(&store, "ana").is_err(),
            "Microsoft nao pode sair pelo gate do Google — tem que chegar no token"
        );
    }
}
