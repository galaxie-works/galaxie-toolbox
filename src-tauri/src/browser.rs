//! Navegador embutido com abas.
//!
//! Cada aba e um webview NATIVO filho da janela principal (feature `unstable`
//! do Tauri). O React desenha a barra de abas e mede a area de conteudo; o
//! Rust so cria, posiciona, mostra/esconde e fecha os webviews nessa area.
//!
//! Por que nativo e nao <iframe>: Outlook/Teams/SharePoint mandam
//! X-Frame-Options e recusam carregar em frame. Webview nativo nao e frame.
//!
//! O posicionamento e por COORDENADA (nao ha layout automatico): sempre que a
//! janela redimensiona, a sidebar abre/fecha ou troca-se de aba, o React reenvia
//! o retangulo e o Rust reposiciona. Coordenadas em pixels logicos (CSS), iguais
//! aos que o React mede com getBoundingClientRect.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const PREFIXO: &str = "browser-";

/// Rotulo do webview a partir do id do app. Rotulo de webview so aceita
/// [a-zA-Z0-9-/:_], entao filtramos o id (que vem do catalogo).
fn rotulo(id: &str) -> String {
    let limpo: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    format!("{PREFIXO}{limpo}")
}

fn janela(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main").ok_or_else(|| "janela principal nao encontrada".into())
}

/// Esconde todas as abas do navegador menos a informada. `None` esconde todas.
fn esconder_menos(win: &tauri::Window, manter: Option<&str>) {
    for wv in win.webviews() {
        let l = wv.label().to_string();
        if l.starts_with(PREFIXO) && Some(l.as_str()) != manter {
            let _ = wv.hide();
        }
    }
}

fn achar(win: &tauri::Window, label: &str) -> Option<tauri::webview::Webview> {
    win.webviews().into_iter().find(|v| v.label() == label)
}

/// Revela uma webview EXISTENTE de forma que ela de fato REPINTE (#275/#324 S1).
///
/// O WebView2 filho pinta acima do DOM, entao qualquer overlay (menu de contexto,
/// dropdown, paleta) so aparece se escondermos a webview antes — o front-end faz
/// isso via `esconderTodas`. O problema do #275 e o CAMINHO DE VOLTA: ao fechar o
/// overlay chamamos `show()`, mas o `put_IsVisible(true)` do WebView2 NAO recompoe
/// a regiao se os bounds nao mudaram — sobra a "tela preta" (o repintar nao
/// reverte). A cura confiavel e:
///   1. `show()` primeiro (torna visivel);
///   2. reaplicar os bounds DEPOIS do show (a transicao de visibilidade zera/estala
///      os bounds do controller; reaplicar forca um novo layout);
///   3. um "nudge" de 1px no tamanho e a volta ao tamanho real — garante que o
///      WebView2 veja uma mudanca de bounds e recomponha, mesmo que o passo 2 tenha
///      coincidido com os bounds antigos.
/// Idempotente e barato; nao afeta a criacao (add_child ja pinta fresco).
fn revelar(wv: &tauri::webview::Webview, x: f64, y: f64, w: f64, h: f64) {
    let _ = wv.show();
    let _ = wv.set_position(LogicalPosition::new(x, y));
    let _ = wv.set_size(LogicalSize::new(w, h));
    // Nudge de repaint: 1px a menos e de volta forca o compositor do WebView2.
    let alt_nudge = (h - 1.0).max(1.0);
    let _ = wv.set_size(LogicalSize::new(w, alt_nudge));
    let _ = wv.set_size(LogicalSize::new(w, h));
    let _ = wv.set_focus();
}

/// Abre uma aba nova (ou revela e reposiciona uma existente) e a deixa em foco.
#[tauri::command]
pub async fn browser_abrir(
    app: AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("endereco invalido".into());
    }
    let win = janela(&app)?;
    let label = rotulo(&id);

    if let Some(wv) = achar(&win, &label) {
        // Revela forcando repaint (#275/#324 S1) — mata a tela preta ao voltar
        // de um overlay que escondeu a webview.
        revelar(&wv, x, y, w, h);
        esconder_menos(&win, Some(&label));
        return Ok(());
    }

    let destino = url.parse().map_err(|_| "url invalida".to_string())?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(destino));
    win.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| format!("falha ao criar a aba: {e}"))?;
    esconder_menos(&win, Some(&label));
    Ok(())
}

/// Traz uma aba existente para frente, reposicionando-a.
#[tauri::command]
pub async fn browser_trocar(
    app: AppHandle,
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let win = janela(&app)?;
    let label = rotulo(&id);
    let wv = achar(&win, &label).ok_or_else(|| "aba nao existe".to_string())?;
    revelar(&wv, x, y, w, h);
    esconder_menos(&win, Some(&label));
    Ok(())
}

/// Reposiciona a aba ativa sem mexer nas outras. Chamado no resize da janela e
/// quando a sidebar abre/fecha.
#[tauri::command]
pub async fn browser_layout(
    app: AppHandle,
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let win = janela(&app)?;
    if let Some(wv) = achar(&win, &rotulo(&id)) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
    }
    Ok(())
}

/// Fecha uma aba de vez.
#[tauri::command]
pub async fn browser_fechar(app: AppHandle, id: String) -> Result<(), String> {
    let win = janela(&app)?;
    if let Some(wv) = achar(&win, &rotulo(&id)) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Esconde TODAS as abas — usado ao sair da tela do navegador, para os webviews
/// nativos nao ficarem por cima das outras telas do app.
#[tauri::command]
pub async fn browser_esconder_todas(app: AppHandle) -> Result<(), String> {
    let win = janela(&app)?;
    esconder_menos(&win, None);
    Ok(())
}

/// Recarrega a pagina navegada NA aba (webview-filha) — nao o app (#310). O F5/
/// Ctrl+R do Navigator roteia pra ca em vez do reload default do WebView2 do app.
#[tauri::command]
pub async fn browser_recarregar(app: AppHandle, id: String) -> Result<(), String> {
    let win = janela(&app)?;
    if let Some(wv) = achar(&win, &rotulo(&id)) {
        // eval no contexto da propria pagina: recarrega so a webview-filha.
        wv.eval("location.reload()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// DESTROI todas as webviews-filhas do navegador (#310). Chamado no boot pra
/// limpar webviews orfas que sobrevivem a um reload do app inteiro (o ghost que
/// pintava por cima da Mailbox). Diferente de esconder: aqui fecha de vez.
#[tauri::command]
pub async fn browser_fechar_todas(app: AppHandle) -> Result<(), String> {
    let win = janela(&app)?;
    for wv in win.webviews() {
        if wv.label().starts_with(PREFIXO) {
            let _ = wv.close();
        }
    }
    Ok(())
}
