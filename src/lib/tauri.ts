/**
 * #1033 (FE10) — a fronteira mock/real do Tauri, num lugar só.
 *
 * Esta é a checagem mais consequente do frontend: ela decide se o app fala com
 * o backend Rust de verdade ou degrada pro caminho de mock do `pnpm dev`.
 * Estava copiada byte-a-byte em **onze** lugares (a auditoria #994 achou três;
 * medindo no tip eu achei os outros oito). Onze cópias de uma decisão dessas
 * significa que uma correção futura acerta uma e esquece dez.
 *
 * O que NÃO mora aqui, de propósito: o `main.tsx` lê
 * `__TAURI_INTERNALS__.metadata.currentWindow.label` pra saber se a janela é a
 * splash. Isso não é a checagem booleana — é leitura de metadado, e escondê-la
 * atrás de `inTauri()` faria o ponto único mentir sobre o que ele é.
 */

/** Estamos dentro do Tauri (webview do app) ou num browser comum (`pnpm dev`)? */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Chama um comando Rust. O `import()` é dinâmico porque o módulo do Tauri não
 * existe fora do app — carregá-lo estaticamente quebraria o `pnpm dev`.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}
