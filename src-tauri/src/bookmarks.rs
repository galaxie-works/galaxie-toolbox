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

/// Resultado da importacao automatica: o que deu pra ler + diagnostico honesto.
/// `bloqueados` distingue "navegador presente mas leitura NEGADA" (tipico de
/// antivirus/EDR corporativo protegendo a pasta de perfil) de "nao instalado" ou
/// "sem favoritos" — o front decide a mensagem e oferece import por arquivo HTML.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportarResultado {
    /// Navegadores lidos com sucesso (com favoritos).
    pub navegadores: Vec<BrowserBookmarks>,
    /// Navegadores cujo diretorio `User Data` existe (instalado).
    pub detectados: Vec<String>,
    /// Detectados mas com o `Bookmarks` ilegivel (acesso negado / bloqueio de
    /// seguranca). NAO forcamos a leitura — respeitamos a protecao anti-roubo.
    pub bloqueados: Vec<String>,
}

#[cfg(windows)]
pub fn importar() -> ImportarResultado {
    use std::path::PathBuf;

    let mut res = ImportarResultado::default();
    let local: PathBuf = match std::env::var_os("LOCALAPPDATA") {
        Some(v) => PathBuf::from(v),
        None => return res,
    };

    let alvos = [
        ("chrome", local.join(r"Google\Chrome\User Data")),
        ("edge", local.join(r"Microsoft\Edge\User Data")),
    ];

    for (navegador, user_data) in alvos {
        if !user_data.is_dir() {
            continue; // navegador nao instalado
        }
        res.detectados.push(navegador.to_string());
        let mut bloqueado = false;
        for perfil in perfis_com_bookmarks(&user_data) {
            // SO o arquivo `Bookmarks`. Jamais `Login Data` ou vizinhos.
            let arquivo = user_data.join(&perfil).join("Bookmarks");
            match std::fs::read_to_string(&arquivo) {
                Ok(bruto) => {
                    if let Some(roots) = parse_bookmarks(&bruto) {
                        if !roots.is_empty() {
                            res.navegadores.push(BrowserBookmarks {
                                navegador: navegador.to_string(),
                                perfil,
                                roots,
                            });
                        }
                    }
                }
                // Arquivo listado (existe) mas nao leu → acesso bloqueado
                // (EDR/antivirus). Sinaliza para o front oferecer import por HTML.
                Err(_) => bloqueado = true,
            }
        }
        if bloqueado {
            res.bloqueados.push(navegador.to_string());
        }
    }

    res
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

/// Converte o JSON de um arquivo `Bookmarks` nas pastas de topo (bookmark_bar,
/// other, synced) que tiverem conteudo. JSON invalido → `None`. A LEITURA do
/// arquivo fica no `importar`, para distinguir "nao leu" (bloqueio) de "sem
/// favoritos".
#[cfg(windows)]
fn parse_bookmarks(bruto: &str) -> Option<Vec<BookmarkNode>> {
    let json: serde_json::Value = serde_json::from_str(bruto).ok()?;
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

#[cfg(all(test, windows))]
mod tests {
    //! #1045 (TST-03): o allowlist de URL do parser de bookmarks é a ÚNICA barreira
    //! entre um arquivo `Bookmarks` de terceiro (conteúdo controlado fora do app) e
    //! uma URL aberta pelo WebView2 embutido. Antes deste módulo, `bookmarks.rs`
    //! tinha 0 `#[cfg(test)]` — um refactor podia deixar passar `javascript:`/
    //! `file://`/`chrome://` sem ninguém perceber.
    use super::{converter, parse_bookmarks};
    use serde_json::json;

    fn url_node(url: &str) -> serde_json::Value {
        json!({ "type": "url", "name": "x", "url": url, "guid": "g1" })
    }

    /// AC1 (SEGURANÇA): esquemas perigosos são DESCARTADOS pelo allowlist.
    #[test]
    fn converter_allowlist_barra_esquemas_perigosos() {
        let mut c = 0;
        for perigoso in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "chrome://settings",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "about:blank",
            "HTTPS://maiusculo.example", // starts_with é case-sensitive → barrado (defensivo)
            " https://espaco-a-frente.example", // espaço quebra o starts_with → barrado
        ] {
            assert!(
                converter(&url_node(perigoso), &mut c).is_none(),
                "esquema perigoso passou pelo allowlist: {perigoso}"
            );
        }
    }

    /// AC2: `http://`/`https://` são ACEITOS, com a url preservada.
    #[test]
    fn converter_allowlist_aceita_http_e_https() {
        let mut c = 0;
        for ok in ["http://exemplo.com", "https://exemplo.com/x?y=1#z"] {
            let no = converter(&url_node(ok), &mut c).expect("http(s) deveria ser aceito");
            assert_eq!(no.url.as_deref(), Some(ok));
            assert!(no.filhos.is_empty());
        }
    }

    /// AC3: JSON malformado / sem `roots` / `roots` não-objeto → `None`, SEM panic.
    #[test]
    fn parse_bookmarks_json_invalido_ou_sem_roots_nao_paniqueia() {
        assert!(parse_bookmarks("{ not json").is_none());
        assert!(parse_bookmarks(r#"{"version":1}"#).is_none());
        assert!(parse_bookmarks(r#"{"roots": 42}"#).is_none());
        assert!(parse_bookmarks("").is_none());
    }

    /// AC4: nó sem `guid` nem `id` recebe id de reserva `bm-{contador}`; `guid`
    /// tem precedência sobre `id`, e `id` sobre o fallback.
    #[test]
    fn converter_id_fallback_e_precedencia() {
        let mut c = 0;
        let sem = converter(&json!({ "type":"url","name":"x","url":"https://a.b" }), &mut c)
            .expect("url válida");
        assert_eq!(sem.id, "bm-1");
        let com_guid =
            converter(&json!({ "type":"url","name":"x","url":"https://a.b","guid":"G","id":"I" }), &mut c)
                .unwrap();
        assert_eq!(com_guid.id, "G");
        let com_id =
            converter(&json!({ "type":"url","name":"x","url":"https://a.b","id":"I" }), &mut c).unwrap();
        assert_eq!(com_id.id, "I");
    }

    /// AC5 + prova ponta-a-ponta: pasta de topo vazia NÃO entra na lista final, e o
    /// allowlist barra `javascript:` mesmo aninhado dentro de uma pasta com conteúdo.
    #[test]
    fn parse_bookmarks_descarta_pasta_vazia_e_filtra_link_perigoso_aninhado() {
        let bruto = json!({
            "roots": {
                "bookmark_bar": { "type": "folder", "name": "Barra", "children": [] },
                "other": { "type": "folder", "name": "Outros", "children": [
                    { "type": "url", "name": "Site", "url": "https://ok.example", "guid": "u1" },
                    { "type": "url", "name": "Ruim", "url": "javascript:void(0)", "guid": "u2" }
                ] }
            }
        })
        .to_string();
        let saida = parse_bookmarks(&bruto).expect("json válido");
        // bookmark_bar vazia é descartada; sobra só "Outros"…
        assert_eq!(saida.len(), 1);
        assert_eq!(saida[0].nome, "Outros");
        // …e dentro dela, só o link http(s) — o javascript: foi barrado na conversão.
        assert_eq!(saida[0].filhos.len(), 1);
        assert_eq!(saida[0].filhos[0].url.as_deref(), Some("https://ok.example"));
    }
}

// --- Stub para plataformas nao-Windows (dev/CI) ---
#[cfg(not(windows))]
pub fn importar() -> ImportarResultado {
    ImportarResultado::default()
}
