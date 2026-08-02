/**
 * pdf.js — carregamento e render de PDF para pré-visualização de anexos (#188).
 *
 * Segurança (spec §7, a espinha do épico):
 * - O JavaScript embutido no PDF **nunca** executa: usamos só a API de baixo
 *   nível (`getDocument` + render de página no canvas), sem instanciar o
 *   `PDFScriptingManager` nem uma `AnnotationLayer` com `enableScripting`. Não
 *   há caminho de execução de script embutido.
 * - **Eval:** o pdf.js v6 removeu o caminho de `eval`/`new Function` da própria
 *   biblioteca (o antigo `isEvalSupported` deixou de existir), então não há o
 *   que desligar — a garantia "sem eval" é estrutural nesta versão.
 * - **Sem rede:** o worker é um asset **local** bundlado pelo Vite (`?url`,
 *   nunca CDN) e não configuramos `cMapUrl`/`standardFontDataUrl` remotos, então
 *   o pdf.js não busca nada externo (regra "sem rede no preview").
 * - Os bytes já são locais (vindos do `cr_ler_anexo`), então desligamos
 *   streaming/auto-fetch.
 */
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
// Worker como asset local (Vite resolve para um arquivo bundlado). SEM CDN.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Carrega um PDF a partir de bytes locais. Observação: o pdf.js transfere o
 * buffer para o worker (detacha `bytes`); não reutilize o mesmo array depois —
 * o botão "Salvar" usa o `cr_baixar_anexo` (fetch próprio), não estes bytes.
 */
export async function carregarPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({
    data: bytes,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
}

/**
 * Renderiza uma página no `<canvas>` na escala dada, respeitando o
 * `devicePixelRatio` para nitidez em telas retina.
 */
export async function renderizarPagina(
  doc: PDFDocumentProxy,
  numero: number,
  canvas: HTMLCanvasElement,
  escala: number
): Promise<void> {
  const page = await doc.getPage(numero);
  const viewport = page.getViewport({ scale: escala });

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  await page.render({
    canvas,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
}
