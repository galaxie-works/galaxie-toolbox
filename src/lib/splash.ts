
import { inTauri } from "./tauri.ts";/**
 * Coordenação do splash de boot (#164) entre as duas janelas Tauri.
 *
 * A janela `splashscreen` (círculo #171A30) abre visível já no launch; a janela
 * `main` nasce oculta (`visible:false`) e só aparece quando o boot da `App`
 * termina E a animação tocou até o fim uma vez.
 *
 * `revelarAppEFecharSplash` é chamado SÓ pela árvore da main window (o `main.tsx`
 * desvia a splash para o `SplashScreen`), então `getCurrentWindow()` ali é sempre
 * a `main`. Já `EVENTO_VIDEO_SPLASH` é compartilhado pelas DUAS janelas: a splash
 * emite quando o vídeo termina; a main escuta para liberar o gate de revelação.
 *
 * O acesso ao `@tauri-apps/api/*` é por import dinâmico — mesmo padrão do
 * `barra-janela.tsx`/`tema.ts` — para não puxar a API do Tauri para o chunk
 * crítico do boot.
 */

/**
 * Evento Tauri (broadcast) que a janela `splashscreen` emite quando o vídeo de
 * abertura termina de tocar uma vez (ou falha/estoura o fallback de tempo). A
 * `main` escuta e marca `videoPronto`, um dos gates da revelação. Nome com
 * prefixo para não colidir com eventos de plugin.
 */
export const EVENTO_VIDEO_SPLASH = "splash://video-terminou";

/**
 * Longstop de segurança da revelação (#164). MAIOR que a duração do vídeo
 * (~10s) + folga, para nunca cortar a animação no meio: se o boot travar OU o
 * sinal de fim-de-vídeo se perder, a main aparece assim mesmo depois deste teto.
 */
export const LONGSTOP_SPLASH_MS = 20_000;

let revelado = false;

// #1033: ponto único em `./tauri.ts`. Continua função (runtime).
const emTauri = inTauri;

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
