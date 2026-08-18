//! Estado local dos atalhos criados pelo app.
//!
//! POR QUE ISSO EXISTE: o Graph nao expoe atalhos do OneDrive. Testado e
//! confirmado em 5 consultas (/drive/root/children app-only e delegado,
//! /drive/root/delta nos dois, /drive/sharedWithMe): todas devolvem 0 itens
//! com remoteItem, mesmo com o atalho visivel no OneDrive web.
//!
//! Como o POST que cria o atalho DEVOLVE o id do item, guardamos esse id aqui.
//! Com ele da pra saber o que ja foi conectado (estado do botao) e remover
//! depois (DELETE /me/drive/items/{id}).
//!
//! Limite honesto: so conhece atalhos criados POR ESTE APP. Atalho que a
//! pessoa adicionou pelo site nao aparece aqui - nao ha como descobrir.

use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct Conectado {
    pub item_id: String,
    pub nome: String,
}

fn caminho() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::Path::new(&base).join("GALAXIE");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("conectados.json"))
}

// --- Funcoes puras (testaveis sem tocar disco) ------------------------------
// A logica de (des)serializacao e mutacao do mapa vive aqui, sem env/IO. Os
// wrappers publicos abaixo apenas ligam essas funcoes ao arquivo em disco.

/// Desserializa o mapa dos bytes lidos. Em QUALQUER erro (JSON invalido,
/// truncado, vazio) devolve mapa vazio — nunca panica. Espelha o antigo
/// `from_slice(...).ok().unwrap_or_default()`.
pub(crate) fn desserializar(bytes: &[u8]) -> HashMap<String, Conectado> {
    serde_json::from_slice(bytes).unwrap_or_default()
}

/// Serializa o mapa em JSON pretty. Espelha o antigo `to_vec_pretty`.
pub(crate) fn serializar(mapa: &HashMap<String, Conectado>) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec_pretty(mapa)
}

/// Insere/atualiza o atalho no mapa. Ultima escrita vence (semantica do insert).
pub(crate) fn aplicar_marcar(
    mapa: &mut HashMap<String, Conectado>,
    site_guid: &str,
    item_id: &str,
    nome: &str,
) {
    mapa.insert(
        site_guid.to_string(),
        Conectado { item_id: item_id.to_string(), nome: nome.to_string() },
    );
}

/// Remove o atalho do mapa; devolve se algo foi removido.
pub(crate) fn aplicar_desmarcar(mapa: &mut HashMap<String, Conectado>, site_guid: &str) -> bool {
    mapa.remove(site_guid).is_some()
}

/// Mapa siteGuid -> atalho criado. Nao e segredo (sao ids), entao JSON puro.
pub fn carregar() -> HashMap<String, Conectado> {
    caminho()
        .and_then(|p| std::fs::read(p).ok())
        .map(|b| desserializar(&b))
        .unwrap_or_default()
}

fn gravar(mapa: &HashMap<String, Conectado>) {
    if let Some(p) = caminho() {
        if let Ok(txt) = serializar(mapa) {
            if let Err(e) = std::fs::write(&p, txt) {
                log::error!("[estado] falha ao gravar conectados.json: {e}");
            }
        }
    }
}

pub fn marcar(site_guid: &str, item_id: &str, nome: &str) {
    let mut m = carregar();
    aplicar_marcar(&mut m, site_guid, item_id, nome);
    log::info!("[estado] atalho registrado: {nome} (site={site_guid})");
    gravar(&m);
}

pub fn desmarcar(site_guid: &str) {
    let mut m = carregar();
    if aplicar_desmarcar(&mut m, site_guid) {
        log::info!("[estado] atalho removido do registro (site={site_guid})");
    }
    gravar(&m);
}

pub fn buscar(site_guid: &str) -> Option<Conectado> {
    carregar().get(site_guid).cloned()
}

// --- Identidade em cache ----------------------------------------------------
// Guarda foto/iniciais em disco pra tela de "Retomando sessao" ja mostrar o
// usuario, antes de qualquer chamada de rede terminar.

fn caminho_arquivo(nome: &str) -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::Path::new(&base).join("GALAXIE");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(nome))
}

pub fn salvar_foto(data_uri: &str) {
    if let Some(p) = caminho_arquivo("avatar.txt") {
        let _ = std::fs::write(p, data_uri);
    }
}

pub fn ler_foto() -> Option<String> {
    let p = caminho_arquivo("avatar.txt")?;
    let s = std::fs::read_to_string(p).ok()?;
    if s.trim().is_empty() { None } else { Some(s) }
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Identidade {
    pub display_name: String,
    pub initials: String,
    pub photo: Option<String>,
}

pub fn salvar_identidade(display_name: &str, initials: &str) {
    if let Some(p) = caminho_arquivo("identidade.json") {
        let id = Identidade {
            display_name: display_name.to_string(),
            initials: initials.to_string(),
            photo: None,
        };
        if let Ok(txt) = serde_json::to_vec(&id) {
            let _ = std::fs::write(p, txt);
        }
    }
}

/// Identidade pra pintar a tela de carregamento (sem rede).
pub fn ler_identidade() -> Option<Identidade> {
    let p = caminho_arquivo("identidade.json")?;
    let b = std::fs::read(p).ok()?;
    let mut id: Identidade = serde_json::from_slice(&b).ok()?;
    id.photo = ler_foto();
    Some(id)
}

/// Limpa identidade e foto (usado no logout).
pub fn limpar_identidade() {
    for f in ["avatar.txt", "identidade.json"] {
        if let Some(p) = caminho_arquivo(f) {
            let _ = std::fs::remove_file(p);
        }
    }
}

// --- Conta dona da sessao do navegador interno ------------------------------
// Os webviews internos (Cruiser + apps do M365) dividem UM cookie jar da
// WebView2. Guardamos aqui de quem sao os cookies atuais; quando a conta ativa
// do app muda, limpamos os dados de navegacao pra nao vazar sessao entre contas.
// NAO e apagado no logout de proposito: representa o dono dos cookies em disco.

pub fn ler_conta_navegador() -> Option<String> {
    let p = caminho_arquivo("navegador-conta.txt")?;
    let s = std::fs::read_to_string(p).ok()?;
    let s = s.trim();
    if s.is_empty() { None } else { Some(s.to_string()) }
}

pub fn salvar_conta_navegador(upn: &str) {
    if let Some(p) = caminho_arquivo("navegador-conta.txt") {
        let _ = std::fs::write(p, upn);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conectado(item_id: &str, nome: &str) -> Conectado {
        Conectado { item_id: item_id.to_string(), nome: nome.to_string() }
    }

    #[test]
    fn round_trip_serializa_e_desserializa_igual() {
        let mut m = HashMap::new();
        m.insert("site-a".to_string(), conectado("id-a", "Financeiro"));
        m.insert("site-b".to_string(), conectado("id-b", "Engenharia"));

        let bytes = serializar(&m).expect("serializar");
        let volta = desserializar(&bytes);

        assert_eq!(volta.len(), 2);
        assert_eq!(volta["site-a"].item_id, "id-a");
        assert_eq!(volta["site-a"].nome, "Financeiro");
        assert_eq!(volta["site-b"].item_id, "id-b");
        assert_eq!(volta["site-b"].nome, "Engenharia");
    }

    #[test]
    fn desserializar_lixo_ou_vazio_devolve_mapa_vazio_sem_panic() {
        // JSON truncado, bytes binarios e vazio -> mapa vazio, nunca panica.
        assert!(desserializar(b"{ truncado").is_empty());
        assert!(desserializar(b"\x00\x01lixo").is_empty());
        assert!(desserializar(b"").is_empty());
    }

    #[test]
    fn aplicar_marcar_no_mesmo_site_mantem_len_1_ultima_vence() {
        let mut m = HashMap::new();
        aplicar_marcar(&mut m, "site-x", "id-1", "Antigo");
        aplicar_marcar(&mut m, "site-x", "id-2", "Novo");

        assert_eq!(m.len(), 1);
        assert_eq!(m["site-x"].item_id, "id-2");
        assert_eq!(m["site-x"].nome, "Novo");
    }

    #[test]
    fn aplicar_desmarcar_remove_presente_e_ignora_ausente() {
        let mut m = HashMap::new();
        aplicar_marcar(&mut m, "site-y", "id-9", "Qualquer");

        assert!(aplicar_desmarcar(&mut m, "site-y")); // removeu -> true
        assert!(m.is_empty());
        assert!(!aplicar_desmarcar(&mut m, "site-y")); // ausente -> false
    }

    #[test]
    fn identidade_round_trip_serde() {
        let id = Identidade {
            display_name: "Wagner Narde".to_string(),
            initials: "WN".to_string(),
            photo: None,
        };
        let bytes = serde_json::to_vec(&id).expect("serializar identidade");
        let volta: Identidade = serde_json::from_slice(&bytes).expect("desserializar identidade");
        assert_eq!(volta.display_name, "Wagner Narde");
        assert_eq!(volta.initials, "WN");
        assert!(volta.photo.is_none());
    }
}
