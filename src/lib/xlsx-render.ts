/**
 * xlsx → HTML estilizado para pré-visualização (#189 · #552).
 *
 * Usa **xlsx-preview** (baseado em exceljs) para renderizar a planilha em HTML
 * com estilos (cores, mesclagens, larguras — cara de Excel).
 *
 * #552: usamos `separateSheets: TRUE`, que devolve o HTML **estático** de CADA
 * planilha (tabela + estilos inline). O modo `false` embutia cada planilha num
 * `<object data="blob:…">` + um `<script>` de abas interativas — que a nossa
 * moldura de segurança (`<iframe sandbox="">` sem scripts + CSP `default-src
 * 'none'` que bloqueia `blob:`) BLOQUEIA, deixando o grid EM BRANCO (só as abas
 * apareciam). Aqui montamos as abas em React (fora do iframe) e injetamos só a
 * planilha ativa — HTML estático — no iframe sanitizado.
 *
 * Segurança (spec §7): cada planilha é HTML puro (tabela + estilos), sanitizado
 * com DOMPurify e servido no `<iframe sandbox="">` + CSP — sem scripts, sem rede,
 * sem blobs. exceljs lê valores/estilos, não avalia fórmula viva.
 *
 * #873 fix (reprovado no runtime): as libs eram carregadas por `import()` DINÂMICO
 * ("não pesar o bundle"), MAS o `xlsx-preview` é **UMD-only** (`main: *.umd.js`,
 * sem ESM). No app EMPACOTADO o chunk do dynamic import dava "failed to fetch"
 * (passava no tsc/oxlint/vite build, morria no runtime — o backend `fs_read_file_
 * bytes` estava OK, a falha era aqui no render). Voltamos a import ESTÁTICO: o
 * Rollup inlina a lib no chunk (sem fetch de chunk em runtime); + `optimizeDeps.
 * include` no vite.config cobre o dev. O custo de bundle é aceitável — o preview
 * já é caminho pesado (pdf.js/docx-preview).
 */
import DOMPurify from "dompurify";
import ExcelJS from "exceljs";
import xlsxPreview from "xlsx-preview";

export interface XlsxRender {
  /** HTML sanitizado e ESTÁTICO de cada planilha (tabela + estilos inline). */
  sheets: string[];
  /** Nome de cada planilha, alinhado 1:1 com `sheets`. */
  nomes: string[];
}

export async function renderXlsxParaHtml(bytes: Uint8Array): Promise<XlsxRender> {
  const blob = new Blob([bytes as BlobPart]);
  // Nomes das planilhas (pras abas em React) — a API do xlsx2Html não os expõe.
  const arrayBuffer = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const nomes = wb.worksheets.map((w) => w.name);

  // Array de HTML estático, uma entrada por planilha (ordem = worksheets).
  const arr = (await xlsxPreview.xlsx2Html(blob, {
    output: "string",
    separateSheets: true,
  })) as string[];
  const sheets = arr.map((h) =>
    DOMPurify.sanitize(String(h), { ADD_TAGS: ["style"] }),
  );
  return { sheets, nomes };
}
