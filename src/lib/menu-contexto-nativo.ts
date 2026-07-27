/**
 * Suprime o menu de contexto NATIVO do WebView2/Chromium (#70).
 *
 * O Tauri 2 (wry) mostra o menu de contexto padrão do Chromium no botão direito,
 * o que não é esperado num app desktop e conflita com os menus custom do app
 * (ex.: context menu de pastas, #71). Não há toggle pra isso em `tauri.conf.json`.
 *
 * Estratégia (cross-platform): interceptar o evento `contextmenu` no bubbling e
 * dar `preventDefault()` — EXCETO onde o menu nativo é útil: campos editáveis
 * (input/textarea e o editor `contenteditable` do compose) e quando há texto
 * selecionado (copiar). Fica em bubbling pra que os `ContextMenuTrigger` do Radix
 * (que fazem stopPropagation no próprio nó) abram os menus custom antes.
 */
function ehEditavel(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  if (el.closest?.("input, textarea")) return true;
  // isContentEditable é herdado: true em qualquer nó dentro de [contenteditable]
  return !!el.isContentEditable;
}

document.addEventListener("contextmenu", (e) => {
  const temSelecao = !!window.getSelection()?.toString();
  if (!ehEditavel(e.target) && !temSelecao) e.preventDefault();
});
