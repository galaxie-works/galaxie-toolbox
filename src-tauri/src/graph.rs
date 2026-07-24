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
                web_url,
            });
        }
    }
    sites.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(sites)
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
