/**
 * xlsx → HTML estilizado para pré-visualização (#189, rework p/ xlsx-preview).
 *
 * Troca o grid de valores (SheetJS) pelo **xlsx-preview** (baseado em exceljs),
 * que renderiza a planilha em **HTML com estilos** (cores, mesclagens, larguras
 * — cara de Excel). O HTML é sanitizado (DOMPurify) e injetado num
 * `<iframe sandbox="">` com CSP estrita, a mesma moldura de segurança do docx.
 *
 * Segurança (spec §7): saída é HTML → sandbox sem scripts + CSP `default-src
 * 'none'` (sem rede). exceljs lê valores/estilos, não avalia fórmula viva. Lib
 * carregada sob demanda (dynamic import) — não pesa o bundle principal.
 */
import DOMPurify from "dompurify";

export async function renderXlsxParaHtml(bytes: Uint8Array): Promise<string> {
  const xlsxPreview = (await import("xlsx-preview")).default;
  const html = await xlsxPreview.xlsx2Html(new Blob([bytes as BlobPart]), {
    output: "string",
    separateSheets: false,
  });
  return DOMPurify.sanitize(String(html), { ADD_TAGS: ["style"] });
}
