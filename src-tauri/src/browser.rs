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

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const PREFIXO: &str = "browser-";

// ============================================================================
// #202 — restauracao de scroll das sleeping tabs.
//
// Dormir uma aba = DESTRUIR a webview (#173); acordar = recriar via
// `browser_abrir`. Pra o scroll voltar exatamente onde estava, cada pagina
// reporta continuamente o `scrollY` pro Rust (postMessage nativo do WebView2 →
// WebMessageReceived), que guarda o ultimo valor por aba num cache de sessao. O
// cache SOBREVIVE ao destroy, entao ao recriar a aba dormida injetamos um
// `initialization_script` que rola pra la no load. Tudo transparente no Rust —
// o lifecycle do #173 (fechar/abrir) nao muda no TS. Best-effort (spec §3.4):
// nice-to-have, degrada limpo se a pagina nao cooperar.
// ============================================================================

/// Ultimo scrollY conhecido por aba (label). Alimentado pelo WebMessageReceived.
static SCROLL: Mutex<Option<HashMap<String, f64>>> = Mutex::new(None);

fn scroll_lembrado(label: &str) -> Option<f64> {
    SCROLL.lock().ok()?.as_ref()?.get(label).copied()
}

fn lembrar_scroll(label: &str, y: f64) {
    if let Ok(mut g) = SCROLL.lock() {
        g.get_or_insert_with(HashMap::new).insert(label.to_string(), y);
    }
}

/// Injetado em toda pagina da aba: reporta o scrollY (debounced) pro Rust pelo
/// canal nativo do WebView2. Prefixo `gxscroll:` separa de outras mensagens.
const SCRIPT_CAPTURA_SCROLL: &str = r#"(function(){
  if(!window.chrome||!window.chrome.webview)return;
  var t;
  var envia=function(){try{window.chrome.webview.postMessage('gxscroll:'+Math.round(window.scrollY||window.pageYOffset||0));}catch(e){}};
  window.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(envia,200);},{passive:true});
  window.addEventListener('beforeunload',envia);
})();"#;

/// #311: injeta o scrollbar fino do app DENTRO da pagina navegada (senao a
/// pagina usa o scrollbar default do WebView2, fora do padrao). Cores neutras
/// com alpha (a pagina nao tem as CSS vars do app), boas em claro/escuro; casa
/// com o `.scrollbar-fina` do chrome (8px, thumb arredondado, track transparente).
/// Best-effort: se a pagina tiver regra propria mais especifica, ela vence.
const SCRIPT_SCROLLBAR: &str = r#"(function(){try{
  var css='::-webkit-scrollbar{width:8px;height:8px}'
    +'::-webkit-scrollbar-thumb{background-color:rgba(128,128,128,.5);border-radius:9999px}'
    +'::-webkit-scrollbar-thumb:hover{background-color:rgba(128,128,128,.75)}'
    +'::-webkit-scrollbar-track{background:transparent}';
  var s=document.createElement('style');
  s.setAttribute('data-galaxie-scrollbar','1');
  s.textContent=css;
  (document.head||document.documentElement).appendChild(s);
}catch(e){}})();"#;

/// Restaura o scroll no load da pagina recriada (best-effort, spec §3.4).
///
/// #351: o script roda a CADA documento criado (initialization_script). Sem
/// guard, ao acordar a aba e depois navegar dentro dela, a pagina nova saltava
/// pro scroll antigo. Guardamos por URL: so restaura quando o load e da PAGINA
/// ORIGINAL recriada (o `url` que o `browser_abrir` carregou); navegacao
/// subsequente (href diferente) nao re-rola.
fn script_restaura_scroll(url: &str, y: f64) -> String {
    let url_js = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "window.addEventListener('load',function(){{try{{if(location.href==={}){{window.scrollTo(0,{});}}}}catch(e){{}}}});",
        url_js, y as i64
    )
}

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
    // #202: captura contínua do scrollY + restauração se a aba foi dormida antes
    // (o cache sobrevive ao destroy). Ambos os scripts rodam a cada navegação.
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(destino))
        .initialization_script(SCRIPT_CAPTURA_SCROLL)
        // #311: scrollbar da pagina no padrao do app.
        .initialization_script(SCRIPT_SCROLLBAR);
    if let Some(scroll) = scroll_lembrado(&label) {
        builder = builder.initialization_script(&script_restaura_scroll(&url, scroll));
    }
    let wv = win
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| format!("falha ao criar a aba: {e}"))?;
    // #272 S2: atalhos do Navigator com a página em foco (accelerators nativos).
    instalar_accelerators(&app, &wv);
    // #202: recebe o scrollY reportado pela página e guarda no cache por aba.
    instalar_captura_scroll(&wv, &label);
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

// ============================================================================
// #272 S2 (fecha o épico #324) — accelerators nativos do Navigator.
//
// Quando o foco está DENTRO da webview-filha (a página navegada), o teclado NÃO
// sobe pro React → os atalhos do Navigator (Ctrl+T/W, etc.) morrem. O handler
// React (S1) só pega o teclado com o "chrome" do app em foco.
//
// O WebView2 expõe `add_AcceleratorKeyPressed`, que dispara pros atalhos
// (Ctrl/Alt + tecla, F-keys) ANTES da página. Registramos nele: se for um atalho
// do Navigator, emitimos um evento Tauri (`navigator-atalho`) com {key,ctrl,
// shift,alt} e marcamos `Handled(true)`; o front re-dispara um KeyboardEvent
// sintético que o MESMO handler do S1 processa (zero duplicação de lógica). O
// resto (Ctrl+C/V/F, digitação) passa reto — nunca engolimos.
//
// Só Windows (WebView2). Em outras plataformas é no-op.
// ============================================================================

/// Nome do evento Tauri que carrega um atalho capturado na webview-filha.
pub const EVENTO_ATALHO: &str = "navigator-atalho";

/// Se `(vk, modificadores)` é um atalho do Navigator, devolve a `key` (string do
/// KeyboardEvent) que o handler do S1 espera; senão `None` (deixa passar).
/// VKs de letra/dígito == ASCII maiúsculo, então comparamos com `b'X'`.
#[cfg(windows)]
fn atalho_key(vk: u16, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
    const VK_TAB: u16 = 0x09;
    const VK_F5: u16 = 0x74;
    let eh = |c: u8| vk == c as u16;

    // F5 sozinho — recarregar (#310).
    if !ctrl && !shift && !alt && vk == VK_F5 {
        return Some("F5".into());
    }
    // Alt+D — focar omnibox (sem Ctrl).
    if alt && !ctrl && !shift && eh(b'D') {
        return Some("d".into());
    }
    // Todo o resto exige Ctrl/Cmd e nunca Alt.
    if !ctrl || alt {
        return None;
    }
    if eh(b'K') && !shift {
        return Some("k".into()); // paleta (#174)
    }
    if eh(b'L') && !shift {
        return Some("l".into()); // focar omnibox
    }
    if eh(b'T') {
        return Some("t".into()); // Ctrl+T nova aba / Ctrl+Shift+T reabrir
    }
    if eh(b'N') && shift {
        return Some("n".into()); // Ctrl+Shift+N nova aba privada (#273)
    }
    if eh(b'W') {
        return Some("w".into()); // fechar aba
    }
    if eh(b'R') && !shift {
        return Some("r".into()); // recarregar (#310)
    }
    if vk == VK_TAB {
        return Some("Tab".into()); // Ctrl+Tab / Ctrl+Shift+Tab ciclar
    }
    if !shift && (b'1' as u16..=b'9' as u16).contains(&vk) {
        return Some(((vk as u8) as char).to_string()); // Ctrl+1..9 ir pra aba N
    }
    None
}

/// Payload do evento `navigator-atalho` — espelha os campos do KeyboardEvent que
/// o handler do S1 lê.
#[cfg(windows)]
#[derive(Clone, serde::Serialize)]
struct AtalhoPayload {
    key: String,
    ctrl: bool,
    shift: bool,
    alt: bool,
}

/// Instala o handler de accelerators na webview-filha recém-criada. No-op fora do
/// Windows. Best-effort: qualquer falha de COM só significa "atalho não funciona
/// com a página em foco" (degrada pro comportamento pré-#272), nunca quebra a aba.
#[cfg(windows)]
pub fn instalar_accelerators(app: &AppHandle, wv: &tauri::webview::Webview) {
    use tauri::Emitter;
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    let app = app.clone();
    let _ = wv.with_webview(move |pw| {
        let controller = pw.controller();
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(
            move |_controller, args| {
                let args = match args {
                    Some(a) => a,
                    None => return Ok(()),
                };
                // SAFETY: `args` é a interface COM viva do evento AcceleratorKeyPressed;
                // os métodos (`KeyEventKind`/`VirtualKey`/`SetHandled`) só desreferenciam
                // a vtable dela, e `GetKeyState` lê o estado global do teclado (sempre
                // válido). Nenhum ponteiro escapa do bloco.
                unsafe {
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut kind)?;
                    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                        return Ok(());
                    }
                    let mut vk_raw: u32 = 0;
                    args.VirtualKey(&mut vk_raw)?;
                    let vk = vk_raw as u16;
                    let baixo = |k: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY| {
                        (GetKeyState(k.0 as i32) as u16 & 0x8000) != 0
                    };
                    let ctrl = baixo(VK_CONTROL);
                    let shift = baixo(VK_SHIFT);
                    let alt = baixo(VK_MENU);

                    if let Some(key) = atalho_key(vk, ctrl, shift, alt) {
                        let _ = app.emit(
                            EVENTO_ATALHO,
                            AtalhoPayload { key, ctrl, shift, alt },
                        );
                        args.SetHandled(true)?;
                    }
                }
                Ok(())
            },
        ));
        let mut token = Default::default();
        // SAFETY: `controller` é o ICoreWebView2Controller vivo desta aba (obtido do
        // `pw` do Tauri); registra `handler` (COM ref-counted, mantido vivo pelo
        // WebView2) e escreve o token de registro em `token`.
        unsafe {
            let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
        }
    });
}

#[cfg(not(windows))]
pub fn instalar_accelerators(_app: &AppHandle, _wv: &tauri::webview::Webview) {}

/// #202: registra o WebMessageReceived da webview pra capturar o scrollY que a
/// pagina reporta (via SCRIPT_CAPTURA_SCROLL) e guardar no cache por aba. COM,
/// mesmo padrao do #272. Best-effort: falha de COM só significa "scroll nao
/// restaura" (degrada limpo), nunca quebra a aba.
#[cfg(windows)]
pub fn instalar_captura_scroll(wv: &tauri::webview::Webview, label: &str) {
    use webview2_com::WebMessageReceivedEventHandler;

    let label = label.to_string();
    let _ = wv.with_webview(move |pw| {
        // SAFETY: `pw` é a PlatformWebview viva fornecida pelo Tauri neste closure;
        // `controller()`/`CoreWebView2()` acessam o ponteiro COM do WebView2 desta aba.
        let core = match unsafe { pw.controller().CoreWebView2() } {
            Ok(c) => c,
            Err(_) => return,
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_wv, args| {
            let args = match args {
                Some(a) => a,
                None => return Ok(()),
            };
            // SAFETY: `args` é a interface COM viva do evento WebMessageReceived;
            // `TryGetWebMessageAsString` escreve em `bruto` uma string alocada pelo
            // WebView2 (CoTaskMemAlloc), que copiamos e liberamos com `CoTaskMemFree`
            // exatamente uma vez antes de sair do bloco.
            unsafe {
                let mut bruto = windows::core::PWSTR::null();
                if args.TryGetWebMessageAsString(&mut bruto).is_ok() && !bruto.is_null() {
                    let texto = bruto.to_string().unwrap_or_default();
                    // A string vem alocada pelo WebView2 (CoTaskMemAlloc) — liberar.
                    windows::Win32::System::Com::CoTaskMemFree(Some(bruto.as_ptr() as *const _));
                    if let Some(v) = texto.strip_prefix("gxscroll:") {
                        if let Ok(y) = v.trim().parse::<f64>() {
                            lembrar_scroll(&label, y);
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = Default::default();
        // SAFETY: `core` é o ICoreWebView2 vivo desta aba; registra `handler` (COM
        // ref-counted, mantido vivo pelo WebView2) e escreve o token em `token`.
        unsafe {
            let _ = core.add_WebMessageReceived(&handler, &mut token);
        }
    });
}

#[cfg(not(windows))]
pub fn instalar_captura_scroll(_wv: &tauri::webview::Webview, _label: &str) {}

// ============================================================================
// #275 rework — snapshot-to-image (Direção 1 aprovada pelo Polaris).
//
// A webview nativa (windowed) pinta ACIMA do DOM, então o app a esconde quando
// abre um overlay (menu de contexto, Sheet, paleta) — e aí o CONTEÚDO SUMIA
// (rejeição do Wagner no #275). Cura: ANTES de esconder, capturamos a webview
// num JPEG (CapturePreview) e o front mostra essa imagem estática exatamente
// sobre a área; o overlay renderiza acima dela (z-order DOM normal). Ao fechar,
// o front remove a imagem e revela a webview (repaint do #336). Conteúdo
// "congela" sob o overlay, mas não some.
// ============================================================================

/// Captura a aba ativa como um data URL JPEG (ou `None`). Chamado pelo front
/// imediatamente antes de esconder a webview ao abrir um overlay.
#[tauri::command]
pub async fn browser_snapshot(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let win = janela(&app)?;
    let wv = match achar(&win, &rotulo(&id)) {
        Some(w) => w,
        None => return Ok(None),
    };
    Ok(capturar_snapshot(&wv))
}

#[cfg(windows)]
fn capturar_snapshot(wv: &tauri::webview::Webview) -> Option<String> {
    use base64::Engine;
    use std::sync::{Arc, Mutex};
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG;
    use windows::Win32::System::Com::STREAM_SEEK_SET;
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let saida: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let saida_cl = saida.clone();
    // SAFETY: dentro do closure do Tauri, `pw` é a PlatformWebview viva desta aba;
    // as chamadas COM (`controller`/`CoreWebView2`/`CapturePreview`) e as leituras do
    // `IStream` (`Seek`/`Read`) usam ponteiros e buffers próprios (`buf`) vivos durante
    // a operação síncrona (pump até o CapturePreview terminar). Nada escapa do bloco.
    let _ = wv.with_webview(move |pw| unsafe {
        let core = match pw.controller().CoreWebView2() {
            Ok(c) => c,
            Err(_) => return,
        };
        let stream = match SHCreateMemStream(None) {
            Some(s) => s,
            None => return,
        };
        // Pump síncrono até o CapturePreview terminar (padrão do wry/webview2-com).
        let stream_op = stream.clone();
        let feito = CapturePreviewCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                core.CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
                    &stream_op,
                    &handler,
                )?;
                Ok(())
            }),
            Box::new(|res| res),
        );
        if feito.is_err() {
            return;
        }
        // Rebobina e lê os bytes do JPEG.
        if stream.Seek(0, STREAM_SEEK_SET, None).is_err() {
            return;
        }
        let mut bytes = Vec::new();
        let mut buf = [0u8; 16384];
        loop {
            let mut lidos = 0u32;
            if stream
                .Read(buf.as_mut_ptr() as *mut _, buf.len() as u32, Some(&mut lidos))
                .is_err()
            {
                break;
            }
            if lidos == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..lidos as usize]);
        }
        if !bytes.is_empty() {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            if let Ok(mut g) = saida_cl.lock() {
                *g = Some(format!("data:image/jpeg;base64,{b64}"));
            }
        }
    });
    let r = saida.lock().ok().and_then(|mut g| g.take());
    r
}

#[cfg(not(windows))]
fn capturar_snapshot(_wv: &tauri::webview::Webview) -> Option<String> {
    None
}
