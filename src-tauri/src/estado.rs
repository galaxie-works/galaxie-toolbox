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

/// Mapa siteGuid -> atalho criado. Nao e segredo (sao ids), entao JSON puro.
pub fn carregar() -> HashMap<String, Conectado> {
    caminho()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn gravar(mapa: &HashMap<String, Conectado>) {
    if let Some(p) = caminho() {
        if let Ok(txt) = serde_json::to_vec_pretty(mapa) {
            if let Err(e) = std::fs::write(&p, txt) {
                log::error!("[estado] falha ao gravar conectados.json: {e}");
            }
        }
    }
}

pub fn marcar(site_guid: &str, item_id: &str, nome: &str) {
    let mut m = carregar();
    m.insert(
        site_guid.to_string(),
        Conectado { item_id: item_id.to_string(), nome: nome.to_string() },
    );
    log::info!("[estado] atalho registrado: {nome} (site={site_guid})");
    gravar(&m);
}

pub fn desmarcar(site_guid: &str) {
    let mut m = carregar();
    if m.remove(site_guid).is_some() {
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
