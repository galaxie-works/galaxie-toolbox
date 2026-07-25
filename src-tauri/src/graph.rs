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
