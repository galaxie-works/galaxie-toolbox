//! Salvar como… — S4 PDF (#639). Renderiza o corpo HTML do e-mail (+ cabeçalho)
//! em PDF via **WebView2 `PrintToPdf`** (motor já em uso no app), sem lib externa
//! de HTML→PDF.
//!
//! Via A (aprovada pelo Polaris): o backend busca o corpo (`cr_email_corpo`),
//! compõe um HTML próprio (cabeçalho de/para/assunto/data + corpo) e imprime numa
//! **webview Tauri oculta** — travada com `IsScriptEnabled(false)`, **CSP
//! `default-src 'none'`** no HTML impresso e **sanitização de árvore** do corpo via
//! `ammonia` (#1044 SEC8: remove script/iframe/handlers/`javascript:` no DOM real, não
//! por texto). Lote resiliente igual ao `.eml` (#637): a falha de um item não aborta
//! os demais.

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

/// #1044 SEC8: sanitiza o corpo HTML do e-mail com um sanitizador de ÁRVORE
/// (`ammonia`/html5ever), no lugar do scrub textual frágil anterior. Faz o parse do
/// DOM real e REMOVE conteúdo ativo de forma confiável — `<script>`/`<iframe>`/
/// `<object>`/`<embed>`/`<form>`, atributos `on*` (handlers) e URLs `javascript:` —
/// sem depender de casar texto (que dá pra burlar com `<scr<script>ipt>` etc.).
/// Preserva o que um e-mail precisa pra não sair quebrado no PDF: tabelas, imagens
/// (inclusive `cid:`/`data:` embutidas), links e o `style` inline (o Outlook gera
/// layout majoritariamente inline). Combinado com a CSP `default-src 'none'` do HTML
/// composto, um script no corpo não executa nem que passasse.
fn sanitizar_corpo(html: &str) -> String {
    use std::collections::HashSet;
    // Esquemas de URL permitidos: os seguros de link/imagem + `cid:`/`data:` das
    // imagens embutidas de e-mail (o default do ammonia dropa esses dois).
    let esquemas: HashSet<&str> = ["http", "https", "mailto", "tel", "cid", "data"]
        .into_iter()
        .collect();
    ammonia::Builder::default()
        .url_schemes(esquemas)
        // Atributos de apresentação que o layout de e-mail usa (o default do ammonia
        // tira o `style`). Não reintroduz risco ativo: com script off + CSP, CSS não
        // executa.
        .add_generic_attributes([
            "style",
            "class",
            "align",
            "valign",
            "bgcolor",
            "color",
            "width",
            "height",
            "cellpadding",
            "cellspacing",
            "border",
            "colspan",
            "rowspan",
        ])
        .clean(html)
        .to_string()
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
        sanitizar_corpo(&d.corpo)
    } else {
        format!(
            "<pre style=\"white-space:pre-wrap;word-break:break-word;font:inherit\">{}</pre>",
            escapar_html(&d.corpo)
        )
    };

    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; \
img-src data: cid: https: http:; style-src 'unsafe-inline'; font-src data:\">\
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

/// Imprime o e-mail ATIVO no leitor (#640): abre o preview do Chromium
/// (`ShowPrintUI(BROWSER)`) na webview **PRINCIPAL**, in-place (sem janela nova).
/// É COM (não `iframe.print()` via JS, que a sandbox do leitor bloqueia sem
/// `allow-modals`), e `KIND_BROWSER` é garantidamente o preview do Chromium (não o
/// diálogo legado). O `@media print` do front escopa a impressão pro corpo do
/// leitor (esconde sidebar/lista/toolbar). Fire-and-forget: abre o preview e volta.
pub fn cr_imprimir_email(app: &tauri::AppHandle) -> Result<(), String> {
    imprimir_webview_principal(app)
}

#[cfg(windows)]
fn imprimir_webview_principal(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let janela = app
        .get_webview_window("main")
        .ok_or("janela principal indisponivel")?;
    mostrar_print_ui(&janela)
}

#[cfg(not(windows))]
fn imprimir_webview_principal(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("imprimir disponivel apenas no Windows".into())
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
    //    e resolve `file://` sem servidor). #1044 SEC8: nome ALEATÓRIO (não derivado
    //    do assunto) — não vaza o assunto do e-mail no temp dir e é anti-colisão.
    use rand::Rng;
    let seed: u64 = rand::thread_rng().gen();
    let temp = std::env::temp_dir().join(format!("gx-salvar-pdf-{seed:016x}.html"));
    std::fs::write(&temp, html).map_err(|e| format!("falha ao preparar o HTML: {e}"))?;
    // #1044 SEC8: apaga o temp em QUALQUER saída (os `?` abaixo OU pânico). Antes, um
    // erro entre aqui e o fim vazava o HTML do e-mail no temp dir.
    struct LimpaTemp<'a>(&'a std::path::Path);
    impl Drop for LimpaTemp<'_> {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0);
        }
    }
    let _limpa_temp = LimpaTemp(&temp);
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

    // 3. Limpeza: fecha a janela (o temp cai no `Drop` do `LimpaTemp`, cobrindo
    //    também os caminhos de erro acima).
    let _ = janela.close();
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

/// Chama `ICoreWebView2_16::ShowPrintUI(BROWSER)` na webview já carregada.
#[cfg(windows)]
fn mostrar_print_ui(janela: &tauri::WebviewWindow) -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
    };
    use windows::core::Interface;

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let enviou = janela.with_webview(move |pw| {
        let r = (|| -> Result<(), String> {
            let core = unsafe { pw.controller().CoreWebView2() }
                .map_err(|e| format!("CoreWebView2 indisponivel: {e}"))?;
            let core16: ICoreWebView2_16 = core
                .cast()
                .map_err(|e| format!("ICoreWebView2_16 (ShowPrintUI) indisponivel: {e}"))?;
            unsafe { core16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER) }
                .map_err(|e| format!("ShowPrintUI falhou: {e}"))?;
            Ok(())
        })();
        let _ = tx.send(r);
    });
    if enviou.is_err() {
        return Err("nao consegui acessar a webview de impressao".to_string());
    }
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(r) => r,
        Err(_) => Err("tempo esgotado ao abrir o preview de impressao".to_string()),
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
    fn sanitizar_remove_ativo_e_preserva_layout() {
        let sujo = concat!(
            r#"<p onclick="steal()" style="color:red">oi</p>"#,
            r#"<script>evil()</script><iframe src="http://x"></iframe>"#,
            r#"<a href="javascript:bad()">x</a>"#,
            r#"<table border="1"><tr><td>c</td></tr></table>"#,
            r#"<img src="cid:foto1"><img src="data:image/png;base64,AAAA">"#,
        );
        let limpo = sanitizar_corpo(sujo);
        let baixo = limpo.to_ascii_lowercase();
        // Conteúdo ativo removido pela ÁRVORE (não por casar texto).
        assert!(!baixo.contains("<script"));
        assert!(!baixo.contains("<iframe"));
        assert!(!baixo.contains("onclick"));
        assert!(!baixo.contains("javascript:"));
        // Layout de e-mail preservado (senão o PDF sai quebrado).
        assert!(limpo.contains("oi"));
        assert!(baixo.contains("<table"));
        assert!(baixo.contains("<td"));
        assert!(limpo.contains("style=")); // `style` inline sobrevive
        assert!(limpo.contains("cid:foto1")); // imagem embutida cid:
        assert!(limpo.contains("data:image/png")); // imagem data:
    }

    #[test]
    fn compor_inclui_csp_e_sanitiza_corpo() {
        let d = detalhe("s", r#"<script>x()</script><p>corpo</p>"#, "html");
        let html = compor_html(&d);
        // CSP `default-src 'none'` no HTML impresso — script não executa nem que passasse.
        assert!(html.contains("Content-Security-Policy"));
        assert!(html.contains("default-src 'none'"));
        // O corpo entra sanitizado (sem <script>), o conteúdo legítimo fica.
        assert!(!html.to_ascii_lowercase().contains("<script"));
        assert!(html.contains("<p>corpo</p>"));
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
