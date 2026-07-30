//! Busca de favicon do PROPRIO dominio via HTTP (#276 abas do Navigator; base
//! reutilizavel pro #289 favicon de Organizations no Contacts).
//!
//! Regra de privacidade: SO o proprio site (`{origem}/favicon.ico`). NUNCA um
//! servico de favicon de terceiros (Google s2, DuckDuckGo, etc.) — isso vazaria
//! a lista de dominios visitados/clientes para um terceiro. Sem rede alem do
//! dominio pedido.
//!
//! Devolve um data URI (base64) pronto pra `<img src>`, ou `None` (sem favicon,
//! erro de rede, timeout, nao-imagem). Cache em memoria por origem para nao
//! refazer o request a cada render.

use base64::Engine;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

/// Cache origem → resultado (inclui `None` negativo, pra nao insistir num site
/// sem favicon a cada chamada). Vive pela sessao do app.
static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

const LIMITE_BYTES: usize = 512 * 1024;

/// Origem `scheme://host` de uma URL http(s). Outros esquemas → `None`.
fn origem(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    let host = u.host_str()?;
    Some(format!("{}://{}", u.scheme(), host))
}

/// Dado uma URL (ou dominio http(s)), devolve o favicon do PROPRIO site como
/// data URI, ou `None`. Resultado cacheado por origem.
pub fn buscar(url: &str) -> Option<String> {
    let origem = origem(url)?;

    if let Ok(mut guard) = CACHE.lock() {
        let mapa = guard.get_or_insert_with(HashMap::new);
        if let Some(cacheado) = mapa.get(&origem) {
            return cacheado.clone();
        }
    }

    let resultado = buscar_sem_cache(&origem);

    if let Ok(mut guard) = CACHE.lock() {
        let mapa = guard.get_or_insert_with(HashMap::new);
        mapa.insert(origem, resultado.clone());
    }
    resultado
}

fn buscar_sem_cache(origem: &str) -> Option<String> {
    let cliente = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("GalaxieToolbox")
        .build()
        .ok()?;

    // SO o favicon.ico do proprio dominio. Nada de terceiros.
    let resp = cliente.get(format!("{origem}/favicon.ico")).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let tipo = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| "image/x-icon".to_string());

    // Muitos sites devolvem 200 + HTML (pagina de erro) no lugar do icone —
    // aceita so `image/*`.
    if !tipo.starts_with("image/") {
        return None;
    }

    let bytes = resp.bytes().ok()?;
    if bytes.is_empty() || bytes.len() > LIMITE_BYTES {
        return None;
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{tipo};base64,{b64}"))
}
