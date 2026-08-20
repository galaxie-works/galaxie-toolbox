// #1033 (auditoria #994, FE10/FE16): a FRONTEIRA mock/real do Tauri — a checagem
// mais consequente do frontend — num ponto ÚNICO. Antes `inTauri()` e o wrapper
// `invoke<T>` estavam duplicados byte-a-byte em `api.ts`, `browser.ts` e `log.ts`;
// uma correção futura acertava um lugar e esquecia os outros. Aqui é a fonte de
// verdade: `api.ts` re-exporta `inTauri` (o `api.inTauri()` que o App usa) e os
// três importam o `invoke`.
//
// Sem dependências de outros módulos do app de propósito — é a base da pilha,
// pra ninguém criar ciclo ao importar daqui.

/** Estamos dentro do Tauri (webview do app) ou num browser comum (`pnpm dev`)? */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Wrapper fino do `invoke` do core do Tauri. Import DINÂMICO — o módulo
 * `@tauri-apps/api/core` só carrega dentro do app (fora, `inTauri()` já barrou
 * a chamada). É também o único lugar pra instrumentar/mocar a fronteira real.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}
