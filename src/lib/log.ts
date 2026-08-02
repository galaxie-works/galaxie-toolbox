/**
 * Logging de erros do front-end (#148), no capricho que "todo dev Delphi faria":
 * nada de erro silencioso. Cada erro vai pro `console.error` (message + stack) E,
 * dentro do Tauri, pro log do backend via o comando `log_frontend_error` — assim
 * um crash de render (a "tela branca") deixa rastro no console de dev e no
 * arquivo de log do `tauri-plugin-log`, em vez de sumir sem deixar pista.
 */

import { telAppCrashed } from "./telemetria.ts";

/** Estamos dentro do Tauri (webview do app) ou num browser comum (pnpm dev)? */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Encaminha uma linha de erro pro log do backend (Rust). Silencioso fora do
 * Tauri e NUNCA estoura: logar não pode, ele próprio, derrubar o app nem virar
 * uma nova rejeição não tratada.
 */
async function enviarParaBackend(msg: string): Promise<void> {
  if (!inTauri()) return;
  try {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("log_frontend_error", { msg });
  } catch {
    // Se nem o canal de log responde, não há muito a fazer — mas engolimos a
    // falha pra não transformar o log de um erro em outro erro.
  }
}

/** Monta uma mensagem multi-linha com tudo que interessa de um erro. */
function formatar(contexto: string, erro: unknown, extra?: string): string {
  const e = erro as { message?: string; stack?: string } | null | undefined;
  const partes = [`[${contexto}] ${e?.message ?? String(erro)}`];
  if (e?.stack) partes.push(`stack: ${e.stack}`);
  if (extra) partes.push(`componentStack: ${extra}`);
  return partes.join("\n");
}

/**
 * Loga um erro do front-end: `console.error` (com message/stack) + encaminha pro
 * backend. `extra` costuma ser o `info.componentStack` que o React entrega ao
 * `componentDidCatch`.
 */
export function logErro(contexto: string, erro: unknown, extra?: string): void {
  const msg = formatar(contexto, erro, extra);
  // eslint-disable-next-line no-console
  console.error(`[GALAXIE] ${msg}`);
  void enviarParaBackend(msg);
}

let handlersRegistrados = false;

/**
 * Registra os captadores globais de erros e rejeições de Promise não tratados,
 * mandando os dois pelo mesmo canal (console + backend). Idempotente: chamar
 * mais de uma vez não duplica listeners.
 */
export function registrarHandlersGlobais(): void {
  if (handlersRegistrados || typeof window === "undefined") return;
  handlersRegistrados = true;

  window.addEventListener("error", (ev) => {
    const onde = ev.filename
      ? `${ev.filename}:${ev.lineno}:${ev.colno}`
      : undefined;
    logErro("window.error", ev.error ?? ev.message, onde);
    telAppCrashed("window");
  });

  window.addEventListener("unhandledrejection", (ev) => {
    logErro("unhandledrejection", ev.reason);
    telAppCrashed("promise");
  });
}
