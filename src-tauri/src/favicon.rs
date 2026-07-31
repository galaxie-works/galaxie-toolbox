//! Busca de favicon do PROPRIO site via HTTP (#276 abas do Navigator; base
//! compartilhada com o #289 favicon de Organizations no Contacts).
//!
//! Contrato (estavel pros dois consumidores — comando `fetch_favicon`):
//!   `buscar(url) -> Option<String>`  →  data URI (base64) pronto pra `<img src>`,
//!   ou `None` (sem favicon / erro / timeout / nao-imagem).
//!
//! Resolucao (#276): a home so com `/favicon.ico` falhava em muitos sites (ex.:
//! globo.com). Agora:
//!   1. baixa o HTML da pagina (seguindo os redirects DO PROPRIO site — ex.:
//!      apex→www), e faz parse dos `<link rel="icon"/"shortcut icon"/
//!      "apple-touch-icon">`;
//!   2. resolve os hrefs contra a URL final e mantem so os do MESMO host
//!      (privacidade — nunca um terceiro);
//!   3. fallback `{origem-final}/favicon.ico`.
//!
//! Regra de privacidade: NUNCA um servico de favicon de terceiros (Google s2,
//! DuckDuckGo, etc.) — isso vazaria os dominios visitados/clientes. So o proprio
//! site e o que o HTML dele referencia no mesmo host.
//!
//! Cache em memoria por ORIGEM (scheme://host:porta). Positivo dura a sessao;
//! NEGATIVO tem TTL curto — um erro transitorio (rede/timeout) nao "queima" o
//! site para sempre (bug apontado na auditoria do #289).

use base64::Engine;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Entrada do cache: o resultado + quando expira (`None` = nunca, usado pro
/// positivo). O negativo recebe um TTL curto.
struct Entrada {
    valor: Option<String>,
    expira: Option<Instant>,
}

static CACHE: Mutex<Option<HashMap<String, Entrada>>> = Mutex::new(None);

const LIMITE_BYTES: usize = 512 * 1024;
const LIMITE_HTML: usize = 256 * 1024;
/// TTL do cache NEGATIVO — um erro transitorio nao queima o site pra sempre.
const TTL_NEGATIVO: Duration = Duration::from_secs(300);

/// Origem `scheme://host:porta` de uma URL http(s) (INCLUI a porta — o cache do
/// front tambem chaveia por host+porta). Outros esquemas → `None`.
fn origem(u: &reqwest::Url) -> Option<String> {
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    let host = u.host_str()?;
    match u.port() {
        Some(p) => Some(format!("{}://{}:{}", u.scheme(), host, p)),
        None => Some(format!("{}://{}", u.scheme(), host)),
    }
}

/// Dado uma URL (ou dominio http(s)), devolve o favicon do PROPRIO site como
/// data URI, ou `None`. Resultado cacheado por origem (negativo com TTL).
pub fn buscar(url: &str) -> Option<String> {
    let alvo = reqwest::Url::parse(url).ok()?;
    let origem = origem(&alvo)?;

    if let Ok(mut guard) = CACHE.lock() {
        let mapa = guard.get_or_insert_with(HashMap::new);
        if let Some(e) = mapa.get(&origem) {
            let valido = match e.expira {
                None => true,
                Some(quando) => quando > Instant::now(),
            };
            if valido {
                return e.valor.clone();
            }
            mapa.remove(&origem); // negativo expirado → tenta de novo
        }
    }

    let resultado = buscar_sem_cache(&alvo);

    if let Ok(mut guard) = CACHE.lock() {
        let mapa = guard.get_or_insert_with(HashMap::new);
        let expira = if resultado.is_some() {
            None // positivo: vale a sessao toda
        } else {
            Some(Instant::now() + TTL_NEGATIVO) // negativo: TTL curto
        };
        mapa.insert(
            origem,
            Entrada {
                valor: resultado.clone(),
                expira,
            },
        );
    }
    resultado
}

fn cliente() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("GalaxieToolbox")
        // Segue os redirects do PROPRIO site (ex.: apex→www), com teto.
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .ok()
}

fn buscar_sem_cache(alvo: &reqwest::Url) -> Option<String> {
    let cliente = cliente()?;

    // 1) Candidatos vindos do HTML da pagina (<link rel=icon ...>), resolvidos
    //    contra a URL FINAL e filtrados ao mesmo host (privacidade).
    let mut candidatos: Vec<reqwest::Url> = Vec::new();
    let mut base_final = alvo.clone();
    if let Ok(resp) = cliente.get(alvo.clone()).send() {
        if resp.status().is_success() {
            base_final = resp.url().clone();
            let eh_html = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.contains("text/html"))
                .unwrap_or(false);
            if eh_html {
                if let Ok(bytes) = resp.bytes() {
                    let fatia = &bytes[..bytes.len().min(LIMITE_HTML)];
                    let html = String::from_utf8_lossy(fatia);
                    for href in extrair_hrefs_icone(&html) {
                        if let Ok(u) = base_final.join(&href) {
                            if u.host_str() == base_final.host_str() {
                                candidatos.push(u);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2) Fallback classico: /favicon.ico da origem FINAL.
    if let Ok(fav) = base_final.join("/favicon.ico") {
        candidatos.push(fav);
    }

    // Primeiro candidato que devolver uma imagem valida vence.
    for cand in candidatos {
        if let Some(data_uri) = baixar_icone(&cliente, cand) {
            return Some(data_uri);
        }
    }
    None
}

/// Baixa um candidato a icone; devolve o data URI se for uma imagem valida (tipo
/// `image/*`, nao-vazia, dentro do limite). `None` caso contrario.
fn baixar_icone(cliente: &reqwest::blocking::Client, url: reqwest::Url) -> Option<String> {
    let resp = cliente.get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let tipo = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| "image/x-icon".to_string());
    // Muitos sites devolvem 200 + HTML (pagina de erro) no lugar do icone.
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

/// Extrai os `href` de `<link>` cujo `rel` contem "icon" (icon / shortcut icon /
/// apple-touch-icon). Parser leve, sem dependencia de HTML — varre as tags
/// `<link ...>` e le os atributos `rel`/`href`. Case-insensitive.
fn extrair_hrefs_icone(html: &str) -> Vec<String> {
    let lower = html.to_lowercase();
    let mut hrefs = Vec::new();
    let mut i = 0;
    while let Some(p) = lower[i..].find("<link") {
        let inicio = i + p;
        let fim = lower[inicio..]
            .find('>')
            .map(|e| inicio + e)
            .unwrap_or(lower.len());
        let tag = &html[inicio..fim];
        let tag_lower = &lower[inicio..fim];
        // O `rel` precisa CONTER "icon" (evita casar link canonical/stylesheet
        // cujo href por acaso tenha "icon").
        if let Some(rel) = extrair_attr(tag, tag_lower, "rel") {
            if rel.to_lowercase().contains("icon") {
                if let Some(href) = extrair_attr(tag, tag_lower, "href") {
                    if !href.trim().is_empty() {
                        hrefs.push(href);
                    }
                }
            }
        }
        i = (fim + 1).min(lower.len());
        if i >= lower.len() {
            break;
        }
    }
    hrefs
}

/// Le o valor de um atributo `nome=...` de uma tag. Aceita valor entre aspas
/// (simples/duplas) ou sem aspas. `tag` preserva o case do valor; `tag_lower` e
/// usado so pra achar a posicao do nome.
fn extrair_attr(tag: &str, tag_lower: &str, nome: &str) -> Option<String> {
    let alvo = format!("{nome}=");
    let mut de = 0;
    // Procura uma ocorrencia de `nome=` que seja limite de atributo (precedida
    // por espaco ou pelo inicio da tag), pra nao casar sufixo de outro atributo.
    let pos = loop {
        let rel = tag_lower[de..].find(&alvo)?;
        let abs = de + rel;
        let antes = tag[..abs].chars().last();
        if abs == 0 || antes.map(|c| c.is_whitespace()).unwrap_or(false) {
            break abs;
        }
        de = abs + alvo.len();
        if de >= tag_lower.len() {
            return None;
        }
    };
    let resto = tag[pos + alvo.len()..].trim_start();
    let mut chars = resto.chars();
    let primeiro = chars.next()?;
    let valor = if primeiro == '"' || primeiro == '\'' {
        let fim = resto[1..].find(primeiro)?;
        &resto[1..1 + fim]
    } else {
        // Sem aspas: vai ate espaco ou '>'. NAO usar '/' como terminador — paths
        // comecam com '/' (ex.: href=/fav.png). O `>` cobre o self-closing `/>`.
        let bruto = resto
            .find(|c: char| c.is_whitespace() || c == '>')
            .map(|f| &resto[..f])
            .unwrap_or(resto);
        // Apara um '/' final de tag self-closing (href=/fav.png/>).
        bruto.strip_suffix('/').unwrap_or(bruto)
    };
    Some(valor.to_string())
}

#[cfg(test)]
mod tests {
    use super::{extrair_attr, extrair_hrefs_icone};

    fn attr(tag: &str, nome: &str) -> Option<String> {
        extrair_attr(tag, &tag.to_lowercase(), nome)
    }

    #[test]
    fn attr_aspas_duplas_simples_e_sem_aspas() {
        assert_eq!(attr(r#"<link href="/a.png">"#, "href").as_deref(), Some("/a.png"));
        assert_eq!(attr("<link href='/b.png'>", "href").as_deref(), Some("/b.png"));
        assert_eq!(attr("<link href=/c.png >", "href").as_deref(), Some("/c.png"));
    }

    #[test]
    fn attr_nao_casa_sufixo_de_outro_atributo() {
        // "data-href" nao deve casar como "href".
        assert_eq!(attr(r#"<link data-href="/x">"#, "href"), None);
    }

    #[test]
    fn preserva_case_do_valor() {
        assert_eq!(
            attr(r#"<link href="/Icons/Fav.PNG">"#, "href").as_deref(),
            Some("/Icons/Fav.PNG"),
        );
    }

    #[test]
    fn icone_basico_e_variantes_de_rel() {
        assert_eq!(
            extrair_hrefs_icone(r#"<link rel="icon" href="/fav.png">"#),
            vec!["/fav.png"],
        );
        assert_eq!(
            extrair_hrefs_icone(r#"<link rel="shortcut icon" href="/f.ico">"#),
            vec!["/f.ico"],
        );
        assert_eq!(
            extrair_hrefs_icone(r#"<link rel="apple-touch-icon" href="/a.png">"#),
            vec!["/a.png"],
        );
    }

    #[test]
    fn ordem_dos_atributos_nao_importa() {
        assert_eq!(
            extrair_hrefs_icone(r#"<link href="/fav.png" rel="icon">"#),
            vec!["/fav.png"],
        );
    }

    #[test]
    fn ignora_link_sem_icon_no_rel() {
        // stylesheet cujo href por acaso tem "icon" nao pode casar.
        assert_eq!(
            extrair_hrefs_icone(r#"<link rel="stylesheet" href="/icons.css">"#),
            Vec::<String>::new(),
        );
        assert_eq!(
            extrair_hrefs_icone(r#"<link rel="canonical" href="/x">"#),
            Vec::<String>::new(),
        );
    }

    #[test]
    fn varios_links_numa_head() {
        let html = r#"
            <head>
              <link rel="stylesheet" href="/s.css">
              <link rel="icon" type="image/png" href="/fav-32.png">
              <link rel="apple-touch-icon" href="/apple.png">
            </head>"#;
        assert_eq!(
            extrair_hrefs_icone(html),
            vec!["/fav-32.png", "/apple.png"],
        );
    }
}
