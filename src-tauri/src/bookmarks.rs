//! Importacao de favoritos do Chrome/Edge (#176).
//!
//! Le SOMENTE o arquivo `Bookmarks` (JSON simples) de cada perfil do usuario e
//! converte a arvore para a estrutura do app. NUNCA toca em `Login Data` nem em
//! qualquer arquivo de credenciais — apenas `Bookmarks`. Sem rede, sem
//! automacao, sem scraping: e um `std::fs::read_to_string` + parse JSON.
//!
//! Caminhos (Windows):
//!   %LOCALAPPDATA%\Google\Chrome\User Data\<perfil>\Bookmarks
//!   %LOCALAPPDATA%\Microsoft\Edge\User Data\<perfil>\Bookmarks
//!
//! Ausencia (navegador nao instalado, perfil sem favoritos, JSON corrompido)
//! degrada em silencio: a entrada some da lista, sem panico.

use serde::Serialize;

/// Um no da arvore de favoritos: pasta (sem `url`, com `filhos`) ou link (com
/// `url`, sem `filhos`).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkNode {
    pub id: String,
    pub nome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub filhos: Vec<BookmarkNode>,
}

/// Favoritos de um perfil de um navegador (Chrome/Edge).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBookmarks {
    /// "chrome" | "edge".
    pub navegador: String,
    /// Nome da pasta do perfil ("Default", "Profile 1", ...).
    pub perfil: String,
    /// Pastas de topo do perfil (barra de favoritos, outros, sincronizados).
    pub roots: Vec<BookmarkNode>,
}

#[cfg(windows)]
pub fn importar() -> Vec<BrowserBookmarks> {
    use std::path::PathBuf;

    let mut saida = Vec::new();
    let local: PathBuf = match std::env::var_os("LOCALAPPDATA") {
        Some(v) => PathBuf::from(v),
        None => return saida,
    };

    let alvos = [
        ("chrome", local.join(r"Google\Chrome\User Data")),
        ("edge", local.join(r"Microsoft\Edge\User Data")),
    ];

    for (navegador, user_data) in alvos {
        if !user_data.is_dir() {
            continue; // navegador nao instalado / sem perfil
        }
        for perfil in perfis_com_bookmarks(&user_data) {
            // SO o arquivo `Bookmarks`. Jamais `Login Data` ou vizinhos.
            let arquivo = user_data.join(&perfil).join("Bookmarks");
            match ler_arquivo_bookmarks(&arquivo) {
                Some(roots) if !roots.is_empty() => saida.push(BrowserBookmarks {
                    navegador: navegador.to_string(),
                    perfil,
                    roots,
                }),
                _ => {}
            }
        }
    }

    saida
}

/// Lista as pastas de perfil que tem um arquivo `Bookmarks`, com "Default"
/// primeiro. Ignora "System Profile"/"Guest Profile" (nao sao perfis do
/// usuario). So consulta a existencia do arquivo `Bookmarks` — nao abre mais
/// nada dentro do perfil.
#[cfg(windows)]
fn perfis_com_bookmarks(user_data: &std::path::Path) -> Vec<String> {
    let mut perfis: Vec<String> = Vec::new();
    let Ok(entradas) = std::fs::read_dir(user_data) else {
        return perfis;
    };
    for entrada in entradas.flatten() {
        let Ok(tipo) = entrada.file_type() else { continue };
        if !tipo.is_dir() {
            continue;
        }
        let nome = entrada.file_name().to_string_lossy().to_string();
        if nome.eq_ignore_ascii_case("System Profile")
            || nome.eq_ignore_ascii_case("Guest Profile")
        {
            continue;
        }
        if entrada.path().join("Bookmarks").is_file() {
            perfis.push(nome);
        }
    }
    perfis.sort_by(|a, b| {
        let peso = |n: &str| if n.eq_ignore_ascii_case("Default") { 0 } else { 1 };
        peso(a).cmp(&peso(b)).then_with(|| a.cmp(b))
    });
    perfis
}

/// Le e converte um arquivo `Bookmarks`. Devolve as pastas de topo
/// (bookmark_bar, other, synced) que tiverem conteudo. Erro de I/O ou JSON
/// invalido → `None` (a entrada simplesmente nao aparece).
#[cfg(windows)]
fn ler_arquivo_bookmarks(arquivo: &std::path::Path) -> Option<Vec<BookmarkNode>> {
    let bruto = std::fs::read_to_string(arquivo).ok()?;
    let json: serde_json::Value = serde_json::from_str(&bruto).ok()?;
    let roots = json.get("roots")?.as_object()?;

    let mut contador: usize = 0;
    let mut saida = Vec::new();
    // Ordem estavel e previsivel das pastas de topo.
    for chave in ["bookmark_bar", "other", "synced"] {
        if let Some(no) = roots.get(chave) {
            if let Some(convertido) = converter(no, &mut contador) {
                // So inclui pasta de topo com algum conteudo aproveitavel.
                if !convertido.filhos.is_empty() {
                    saida.push(convertido);
                }
            }
        }
    }
    Some(saida)
}

/// Converte um no do JSON do Chrome/Edge para `BookmarkNode`. Links so entram se
/// forem http(s) — `javascript:`, `chrome://`, `file://` etc. sao descartados
/// (seguranca: o navegador embutido so abre https mesmo). `contador` gera ids
/// unicos de reserva quando o no nao traz `guid`/`id`.
#[cfg(windows)]
fn converter(v: &serde_json::Value, contador: &mut usize) -> Option<BookmarkNode> {
    let tipo = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let nome = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();

    *contador += 1;
    let id = v
        .get("guid")
        .and_then(|g| g.as_str())
        .or_else(|| v.get("id").and_then(|g| g.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("bm-{contador}"));

    match tipo {
        "url" => {
            let url = v.get("url").and_then(|u| u.as_str())?;
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                return None;
            }
            Some(BookmarkNode {
                id,
                nome,
                url: Some(url.to_string()),
                filhos: Vec::new(),
            })
        }
        "folder" => {
            let filhos = v
                .get("children")
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|f| converter(f, contador))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(BookmarkNode {
                id,
                nome,
                url: None,
                filhos,
            })
        }
        _ => None,
    }
}

// --- Stub para plataformas nao-Windows (dev/CI) ---
#[cfg(not(windows))]
pub fn importar() -> Vec<BrowserBookmarks> {
    Vec::new()
}
