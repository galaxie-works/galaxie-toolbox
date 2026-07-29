/**
 * Coordenação do splash de boot (#164) entre as duas janelas Tauri.
 *
 * A janela `splashscreen` (círculo #171A30) abre visível já no launch; a janela
 * `main` nasce oculta (`visible:false`) e só aparece quando o boot da `App`
 * termina. Este módulo é importado SÓ pela árvore da main window (o `main.tsx`
 * desvia a splash para o `SplashScreen`), então `getCurrentWindow()` aqui é
 * sempre a `main`.
 *
 * O acesso ao `@tauri-apps/api/window` é por import dinâmico — mesmo padrão do
 * `barra-janela.tsx`/`tema.ts` — para não puxar a API do Tauri para o chunk
 * crítico do boot.
 */

/** Marco de início do boot, capturado no import (antes do React montar). */
export const INICIO_BOOT = Date.now();

/**
 * Tempo mínimo que a animação fica visível, para não ser um flash quando o boot
 * é instantâneo. Nunca ATRASA um boot lento: revela em `max(bootPronto, mínimo)`.
 */
export const MIN_SPLASH_MS = 1200;

let revelado = false;

const emTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Mostra a janela principal e fecha a splash circular. Idempotente de propósito:
 * é chamado por três caminhos independentes — o boot-ready normal da `App`, o
 * `ErrorBoundary` (#148, para um crash de render mostrar o fallback em vez de
 * ficar preso no splash) e um longstop de segurança. O primeiro a chamar revela;
 * os demais viram no-op.
 */
export async function revelarAppEFecharSplash(): Promise<void> {
  if (revelado || !emTauri()) return;
  revelado = true;
  try {
    const { getCurrentWindow, Window } = await import("@tauri-apps/api/window");
    try {
      await getCurrentWindow().show();
    } catch {
      // Sem permissão para mostrar: segue e ao menos tenta fechar a splash.
    }
    const splash = await Window.getByLabel("splashscreen");
    if (splash) await splash.close();
  } catch {
    // Ambiente sem Tauri / splash já fechada: nada a fazer.
  }
}
