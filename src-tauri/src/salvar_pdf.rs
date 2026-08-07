//! Salvar como… — S4 PDF (#639). Renderiza o corpo HTML do e-mail (+ cabeçalho)
//! em PDF via **WebView2 `PrintToPdf`** (motor já em uso no app), sem lib externa
//! de HTML→PDF.
//!
//! Via A (aprovada pelo Polaris): o backend busca o corpo (`cr_email_corpo`),
//! compõe um HTML próprio (cabeçalho de/para/assunto/data + corpo) e imprime numa
//! **webview Tauri oculta** — travada com `IsScriptEnabled(false)` + scrub de
//! conteúdo ativo (script/iframe/handlers/`javascript:`). Lote resiliente igual ao
//! `.eml` (#637): a falha de um item não aborta os demais.

use crate::auth::TokenStore;
use crate::graph::{self, SalvarEmailFalha, SalvarEmailResultado};

/// Escapa texto para inserir com segurança em contexto HTML (cabeçalho).
fn escapar_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Remove um par `<tag …>…</tag>` (case-insensitive) do HTML, repetidamente.
/// Scrub conservador de conteúdo ativo — o `IsScriptEnabled(false)` na webview é
/// a garantia principal; isto é cinto-e-suspensório (a view é oculta, efêmera e
/// não-interativa, então o risco residual é baixo).
fn remover_bloco(html: &str, tag: &str) -> String {
    let baixo = html.to_ascii_lowercase();
    let abre = format!("<{tag}");
    let fecha = format!("</{tag}>");
    let mut saida = String::with_capacity(html.len());
    let mut i = 0usize;
    while i < html.len() {
        if baixo[i..].starts_with(&abre) {
            // Acha o fim do bloco (ou o fim da string se não fechar).
            if let Some(rel) = baixo[i..].find(&fecha) {
                i += rel + fecha.len();
                continue;
            } else {
                break; // tag aberta sem fechamento — descarta o resto.
            }
        }
        // Copia o char corrente (respeitando limites UTF-8).
        let ch = html[i..].chars().next().unwrap();
        saida.push(ch);
        i += ch.len_utf8();
    }
    saida
}

/// Remove atributos de handler inline (`on...="..."`/`on...='...'`) e ocorrências
/// de `javascript:` do HTML. Best-effort textual (a garantia real é a webview
/// travada); mira os vetores óbvios de conteúdo ativo.
fn remover_handlers(html: &str) -> String {
    let mut s = html.replace("javascript:", "blocked:");
    // Remove ` on<algo>="..."` e ` on<algo>='...'` — varredura simples.
    for aspa in ['"', '\''] {
        loop {
            let baixo = s.to_ascii_lowercase();
            let Some(pos) = acha_handler(&baixo) else { break };
            // A partir de `pos` (índice do " on"), acha a aspa de abertura e a de
            // fechamento e remove o intervalo.
            let resto = &s[pos..];
            let Some(eq) = resto.find('=') else { break };
            let apos_eq = &resto[eq + 1..];
            let Some(a1) = apos_eq.find(aspa) else { break };
            let depois = &apos_eq[a1 + 1..];
            let Some(a2) = depois.find(aspa) else { break };
            let fim = pos + eq + 1 + a1 + 1 + a2 + 1;
            s.replace_range(pos..fim, "");
        }
    }
    s
}

/// Acha ` on<letras>=` (um handler inline) numa string já em minúsculas.
fn acha_handler(baixo: &str) -> Option<usize> {
    let bytes = baixo.as_bytes();
    let mut i = 0usize;
    while i + 3 < bytes.len() {
        if bytes[i] == b' ' && bytes[i + 1] == b'o' && bytes[i + 2] == b'n' {
            let mut j = i + 3;
            while j < bytes.len() && bytes[j].is_ascii_alphabetic() {
                j += 1;
            }
            if j > i + 3 && j < bytes.len() && bytes[j] == b'=' {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

/// Scrub de conteúdo ativo do corpo HTML do e-mail.
fn scrub_corpo(html: &str) -> String {
    let mut s = remover_bloco(html, "script");
    s = remover_bloco(&s, "iframe");
    s = remover_bloco(&s, "object");
    s = remover_bloco(&s, "embed");
    remover_handlers(&s)
}

/// Monta o HTML final (cabeçalho + corpo) para imprimir em PDF. CSS com `@page`,
/// `table-layout:fixed` e `word-break` pra o conteúdo largo não cortar (AC3).
pub fn compor_html(d: &graph::EmailDetalhe) -> String {
    let assunto = escapar_html(if d.assunto.trim().is_empty() {
        "(sem assunto)"
    } else {
        &d.assunto
    });
    let de = {
        let nome = escapar_html(&d.de);
        let email = escapar_html(&d.de_email);
        if email.is_empty() || email == d.de {
            nome
        } else {
            format!("{nome} &lt;{email}&gt;")
        }
    };
    let para = escapar_html(&d.para.join(", "));
    let cc_linha = if d.cc.is_empty() {
        String::new()
    } else {
        format!(
            "<p class=\"l\"><b>Cc:</b> {}</p>",
            escapar_html(&d.cc.join(", "))
        )
    };
    let data = escapar_html(&d.recebido);

    let corpo = if d.corpo_tipo == "html" {
        scrub_corpo(&d.corpo)
    } else {
        format!(
            "<pre style=\"white-space:pre-wrap;word-break:break-word;font:inherit\">{}</pre>",
            escapar_html(&d.corpo)
        )
    };

    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">\
<style>\
@page{{size:A4;margin:14mm}}\
html,body{{margin:0}}\
body{{font:13px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111}}\
.gx-cab{{border-bottom:1px solid #ddd;padding-bottom:10px;margin-bottom:14px}}\
.gx-cab h1{{font-size:16px;margin:0 0 8px}}\
.gx-cab .l{{color:#555;font-size:12px;margin:2px 0}}\
.gx-corpo{{max-width:100%}}\
.gx-corpo img{{max-width:100%;height:auto}}\
.gx-corpo table{{max-width:100%;table-layout:fixed;border-collapse:collapse}}\
.gx-corpo td,.gx-corpo th{{word-break:break-word;overflow-wrap:anywhere}}\
</style></head><body>\
<div class=\"gx-cab\">\
<h1>{assunto}</h1>\
<p class=\"l\"><b>De:</b> {de}</p>\
<p class=\"l\"><b>Para:</b> {para}</p>\
{cc_linha}\
<p class=\"l\"><b>Data:</b> {data}</p>\
</div>\
<div class=\"gx-corpo\">{corpo}</div>\
</body></html>"
    )
}

/// Salva um ou vários e-mails como PDF na `pasta`. Para cada id: busca o corpo
/// (Graph), compõe o HTML e imprime via `render_html_para_pdf`. Lote resiliente.
pub fn cr_salvar_email_pdf(
    app: &tauri::AppHandle,
    store: &TokenStore,
    ids: &[String],
    pasta: &str,
    mailbox: Option<&str>,
) -> Result<SalvarEmailResultado, String> {
    let dir = std::path::Path::new(pasta);
    if !dir.is_dir() {
        return Err(format!("pasta invalida: {pasta}"));
    }

    let mut salvos: Vec<String> = Vec::new();
    let mut falhas: Vec<SalvarEmailFalha> = Vec::new();

    for id in ids {
        let detalhe = match graph::cr_email_corpo(store, id, mailbox) {
            Ok(d) => d,
            Err(e) => {
                falhas.push(SalvarEmailFalha {
                    assunto: "(sem assunto)".to_string(),
                    erro: e,
                });
                continue;
            }
        };
        let rotulo = if detalhe.assunto.trim().is_empty() {
            "(sem assunto)".to_string()
        } else {
            detalhe.assunto.clone()
        };
        let nome = graph::sanitizar_nome_arquivo(&detalhe.assunto, "(sem assunto)");
        let html = compor_html(&detalhe);
        let destino = graph::caminho_livre(dir, &format!("{nome}.pdf"));

        match render_html_para_pdf(app, &html, &destino) {
            Ok(()) => salvos.push(destino.to_string_lossy().to_string()),
            Err(e) => falhas.push(SalvarEmailFalha {
                assunto: rotulo,
                erro: e,
            }),
        }
    }

    Ok(SalvarEmailResultado { salvos, falhas })
}

// ----------------------------------------------------------------------------
// Engine de render — WebView2 PrintToPdf numa janela Tauri oculta (#639).
// ----------------------------------------------------------------------------

/// Renderiza `html` em PDF gravado em `destino`, via uma webview Tauri oculta que
/// carrega o HTML e chama `PrintToPdf`. Síncrono (bloqueia até imprimir/timeout).
#[cfg(windows)]
fn render_html_para_pdf(
    app: &tauri::AppHandle,
    html: &str,
    destino: &std::path::Path,
) -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // 1. Grava o HTML num arquivo temp (evita o limite ~2 MB do NavigateToString
    //    e resolve `file://` sem servidor). Nome único por conteúdo/destino.
    let temp = std::env::temp_dir().join(format!(
        "gx-salvar-pdf-{}.html",
        destino
            .file_stem()
            .and_then(|s| s.to_str())
            .map(sanitizar_temp)
            .unwrap_or_else(|| "email".to_string())
    ));
    std::fs::write(&temp, html).map_err(|e| format!("falha ao preparar o HTML: {e}"))?;
    let temp_url = url_de_arquivo(&temp)?;

    // Rótulo de janela válido ([a-zA-Z0-9-_/:#]) e único.
    let rotulo = format!(
        "gx-pdf-{}",
        temp.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("job")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>()
    );

    let (tx_load, rx_load) = mpsc::channel::<()>();
    let janela = WebviewWindowBuilder::new(app, &rotulo, WebviewUrl::External(
        temp_url.parse().map_err(|_| "URL de arquivo invalida".to_string())?,
    ))
    .visible(false)
    .inner_size(920.0, 1200.0)
    .on_page_load(move |_w, payload| {
        // A janela oculta carrega exatamente 1 URL (o temp), então qualquer
        // `Finished` é o nosso — evita fragilidade de casar a URL (encoding).
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            let _ = tx_load.send(());
        }
    })
    .build()
    .map_err(|e| format!("falha ao criar a webview de impressao: {e}"))?;

    // Best-effort: desliga script assim que a webview existe (defesa em profund.
    // junto do scrub). Aplica na proxima navegacao; o scrub cobre a atual.
    travar_webview(&janela);

    // 2. Espera o carregamento (ou timeout).
    let carregou = rx_load.recv_timeout(Duration::from_secs(20)).is_ok();
    let resultado = if !carregou {
        Err("tempo esgotado ao carregar o e-mail para impressao".to_string())
    } else {
        imprimir_pdf(&janela, destino)
    };

    // 3. Limpeza: fecha a janela e apaga o temp (best-effort).
    let _ = janela.close();
    let _ = std::fs::remove_file(&temp);
    resultado
}

/// Roda `PrintToPdf` na webview (já carregada) e espera concluir, via o mesmo
/// pump síncrono do `capturar_snapshot` (browser.rs). Corre no thread da webview.
#[cfg(windows)]
fn imprimir_pdf(janela: &tauri::WebviewWindow, destino: &std::path::Path) -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, PCWSTR};

    let destino_w: Vec<u16> = destino
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let (tx, rx) = mpsc::channel::<Result<bool, String>>();
    let enviou = janela.with_webview(move |pw| {
        let r = (|| -> Result<bool, String> {
            let core = unsafe { pw.controller().CoreWebView2() }
                .map_err(|e| format!("CoreWebView2 indisponivel: {e}"))?;
            let core7: ICoreWebView2_7 = core
                .cast()
                .map_err(|e| format!("ICoreWebView2_7 (PrintToPdf) indisponivel: {e}"))?;
            let ptr = PCWSTR(destino_w.as_ptr());
            // O completed-callback do webview2-com precisa devolver Result<()>; o
            // BOOL de sucesso é capturado num cell (padrão do capturar_snapshot).
            let sucesso = std::sync::Arc::new(std::sync::Mutex::new(false));
            let sucesso_cb = sucesso.clone();
            PrintToPdfCompletedHandler::wait_for_async_operation(
                Box::new(move |handler| {
                    unsafe { core7.PrintToPdf(ptr, None, &handler) }?;
                    Ok(())
                }),
                Box::new(move |hr, ok| {
                    hr?;
                    if let Ok(mut g) = sucesso_cb.lock() {
                        *g = ok;
                    }
                    Ok(())
                }),
            )
            .map_err(|e| format!("PrintToPdf falhou: {e}"))?;
            let ok = *sucesso.lock().map_err(|_| "estado de impressao corrompido".to_string())?;
            Ok(ok)
        })();
        let _ = tx.send(r);
    });
    if enviou.is_err() {
        return Err("nao consegui acessar a webview de impressao".to_string());
    }

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err("o motor reportou falha ao gerar o PDF".to_string()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("tempo esgotado ao gerar o PDF".to_string()),
    }
}

/// Desliga JavaScript na webview oculta (defesa em profundidade). Best-effort.
#[cfg(windows)]
fn travar_webview(janela: &tauri::WebviewWindow) {
    let _ = janela.with_webview(|pw| unsafe {
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetIsScriptEnabled(false);
            }
        }
    });
}

/// Nome de arquivo temp seguro (só alfanumérico/hífen), evitando colisão/escape.
#[cfg(windows)]
fn sanitizar_temp(s: &str) -> String {
    let base: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .take(48)
        .collect();
    if base.is_empty() {
        "email".to_string()
    } else {
        base
    }
}

/// Converte um caminho local num `file:///C:/...` URL (barras normais, sem
/// depender de crate externo).
#[cfg(windows)]
fn url_de_arquivo(p: &std::path::Path) -> Result<String, String> {
    let bruto = p.to_string_lossy().replace('\\', "/");
    // Percent-encode o mínimo (espaço e #) pra não quebrar a URL.
    let escapado = bruto.replace('%', "%25").replace(' ', "%20").replace('#', "%23");
    Ok(format!("file:///{escapado}"))
}

// --- Stub não-Windows (dev/CI) ---

#[cfg(not(windows))]
fn render_html_para_pdf(
    _app: &tauri::AppHandle,
    _html: &str,
    _destino: &std::path::Path,
) -> Result<(), String> {
    Err("exportar PDF disponivel apenas no Windows".into())
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::graph::{AnexoEmail, EmailDetalhe};

    fn detalhe(assunto: &str, corpo: &str, corpo_tipo: &str) -> EmailDetalhe {
        EmailDetalhe {
            assunto: assunto.to_string(),
            de: "Fulano".to_string(),
            de_email: "fulano@x.com".to_string(),
            para: vec!["Ciclano".to_string()],
            cc: vec![],
            para_emails: vec!["ciclano@x.com".to_string()],
            cc_emails: vec![],
            recebido: "2026-08-07T12:00:00Z".to_string(),
            corpo: corpo.to_string(),
            corpo_tipo: corpo_tipo.to_string(),
            anexos: Vec::<AnexoEmail>::new(),
            web_link: String::new(),
        }
    }

    #[test]
    fn scrub_remove_script_iframe_e_handlers() {
        let sujo = r#"<p onclick="steal()">oi</p><script>evil()</script><iframe src="http://x"></iframe><a href="javascript:bad()">x</a>"#;
        let limpo = scrub_corpo(sujo);
        assert!(!limpo.to_ascii_lowercase().contains("<script"));
        assert!(!limpo.to_ascii_lowercase().contains("<iframe"));
        assert!(!limpo.contains("onclick"));
        assert!(!limpo.contains("javascript:"));
        assert!(limpo.contains("oi")); // conteúdo legítimo preservado
    }

    #[test]
    fn compor_escapa_cabecalho_e_inclui_assunto() {
        let d = detalhe("Olá <b>&", "<p>corpo</p>", "html");
        let html = compor_html(&d);
        assert!(html.contains("Olá &lt;b&gt;&amp;")); // assunto escapado
        assert!(html.contains("<p>corpo</p>")); // corpo html preservado
        assert!(html.contains("@page")); // wrapper de impressão presente
    }

    #[test]
    fn compor_assunto_vazio_vira_placeholder() {
        let d = detalhe("   ", "x", "text");
        let html = compor_html(&d);
        assert!(html.contains("(sem assunto)"));
    }

    #[test]
    fn compor_corpo_texto_e_escapado_em_pre() {
        let d = detalhe("t", "a < b & c", "text");
        let html = compor_html(&d);
        assert!(html.contains("<pre"));
        assert!(html.contains("a &lt; b &amp; c"));
    }

    #[test]
    fn compor_omite_cc_quando_vazio() {
        let d = detalhe("t", "x", "text");
        let html = compor_html(&d);
        assert!(!html.contains("<b>Cc:</b>"));
    }
}
