/**
 * xlsx (bytes) → snapshot `IWorkbookData` do Univer (#942, Fase 1).
 *
 * Converte os bytes de um .xlsx num *snapshot* que o Univer renderiza no grid
 * canvas nativo — SEM servidor. O import/export oficial do Univer
 * (`@univerjs-pro/exchange-client`) exige o servidor Univer; a rota OFFLINE
 * suportada é: parsear o arquivo por conta própria e alimentar o `IWorkbookData`
 * pela Facade API. Aqui usamos o **exceljs** (já dependência do projeto) como
 * parser — nenhum pacote novo de parsing.
 *
 * Postura de segurança (spec §7): DADO, não código.
 * - Fórmulas NÃO são avaliadas: gravamos só o **valor em cache** (`v`), nunca o
 *   campo `f` (que faria o motor de fórmula do Univer recalcular). Preview é
 *   read-only e inerte.
 * - Sem rede, sem worker (o viewer não passa `workerURL` no preset).
 * - Diferente do caminho legado (HTML no `<iframe sandbox>`), o Univer desenha em
 *   canvas/DOM DENTRO do app (não sandboxed). Como só há valores/estilos (dados),
 *   e nada é executado, é seguro — mas está fora da moldura iframe+CSP. Ver o
 *   comentário de segurança no `preview-arquivo.tsx`.
 *
 * Estilos suportados (best-effort, sem re-avaliar nada): bold/italic, tamanho e
 * cor da fonte, cor de fundo, formato de número (`numFmt` → `s.n.pattern`),
 * bordas, alinhamento horizontal/vertical, quebra de texto, larguras de coluna,
 * alturas de linha e mesclagens. Tetos defensivos p/ planilhas gigantes.
 */
import ExcelJS from "exceljs";
import type { IWorkbookData, IWorksheetData, ICellData, CellValue } from "@univerjs/core";

/** Teto defensivo p/ preview (planilhas gigantes não travam o grid). */
const MAX_LINHAS = 5000;
const MAX_COLUNAS = 256;

/** pt → px (Excel usa pontos; Univer usa pixels). 96/72 = 4/3. */
const PT_PARA_PX = 4 / 3;

/** exceljs usa ARGB "FFRRGGBB"; Univer quer "#RRGGBB". Retorna null se ausente. */
function argbParaHex(argb?: string): string | null {
  if (!argb || typeof argb !== "string") return null;
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : null;
}

/** 'left'|'center'|'right' → HorizontalAlign (0 unspec, 1 left, 2 center, 3 right). */
function alinhamentoHorizontal(h?: string): number | undefined {
  if (h === "left") return 1;
  if (h === "center") return 2;
  if (h === "right") return 3;
  return undefined;
}

/** 'top'|'middle'|'bottom' → VerticalAlign (1 top, 2 middle, 3 bottom). */
function alinhamentoVertical(v?: string): number | undefined {
  if (v === "top") return 1;
  if (v === "middle") return 2;
  if (v === "bottom") return 3;
  return undefined;
}

/** Estilo de borda exceljs (string) → BorderStyleTypes do Univer (número). */
const BORDA_PARA_UNIVER: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};

/** Uma aresta de borda exceljs → `{ s, cl }` do Univer (ou undefined se ausente). */
function bordaAresta(
  aresta?: Partial<ExcelJS.Border>,
): { s: number; cl: { rgb: string } } | undefined {
  if (!aresta || !aresta.style) return undefined;
  const s = BORDA_PARA_UNIVER[aresta.style];
  if (s === undefined) return undefined;
  const rgb =
    argbParaHex((aresta.color as { argb?: string } | undefined)?.argb) ??
    "#000000";
  return { s, cl: { rgb } };
}

/** Bordas da célula → `s.bd` (Univer). Só inclui as arestas presentes. */
function bordasCelula(cell: ExcelJS.Cell): Record<string, unknown> | undefined {
  const b = cell.border as Partial<ExcelJS.Borders> | undefined;
  if (!b) return undefined;
  const bd: Record<string, unknown> = {};
  const t = bordaAresta(b.top);
  const r = bordaAresta(b.right);
  const btm = bordaAresta(b.bottom);
  const l = bordaAresta(b.left);
  if (t) bd.t = t;
  if (r) bd.r = r;
  if (btm) bd.b = btm;
  if (l) bd.l = l;
  return Object.keys(bd).length > 0 ? bd : undefined;
}

/**
 * Extrai o VALOR PRIMITIVO exibível de uma célula exceljs, sem avaliar fórmula:
 * fórmula → usa `result` em cache; data/rico/hyperlink/erro → texto formatado
 * (`cell.text`), que é exatamente o que o Excel mostra. Retorna null p/ vazio.
 */
function valorCelula(cell: ExcelJS.Cell): CellValue | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
    return v;
  }
  // Objetos: fórmula { formula, result }, rich text, hyperlink, data, erro.
  if (v instanceof Date) return cell.text;
  if (typeof v === "object") {
    if ("result" in v && v.result != null) {
      const r = v.result as unknown;
      if (typeof r === "number" || typeof r === "boolean" || typeof r === "string") {
        return r;
      }
    }
    // richText / hyperlink / sharedFormula / error → texto renderizado.
    return cell.text ?? null;
  }
  return cell.text ?? null;
}

/**
 * Estilo da célula → IStyleData parcial. Best-effort: bold/italic/tamanho/cor,
 * fundo, formato de número, bordas, alinhamento H/V e quebra de texto.
 */
function estiloCelula(cell: ExcelJS.Cell): ICellData["s"] | undefined {
  const s: Record<string, unknown> = {};
  const font = cell.font;
  if (font) {
    if (font.bold) s.bl = 1;
    if (font.italic) s.it = 1;
    if (typeof font.size === "number") s.fs = font.size;
    const cor = argbParaHex((font.color as { argb?: string } | undefined)?.argb);
    if (cor) s.cl = { rgb: cor };
  }
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (fill && fill.type === "pattern" && fill.pattern === "solid") {
    const bg = argbParaHex((fill.fgColor as { argb?: string } | undefined)?.argb);
    if (bg) s.bg = { rgb: bg };
  }
  // Formato de número: só grava o pattern (Univer formata o valor em cache).
  // "General" é o default do Excel — não vale gravar.
  const numFmt = cell.numFmt;
  if (typeof numFmt === "string" && numFmt && numFmt !== "General") {
    s.n = { pattern: numFmt };
  }
  const bordas = bordasCelula(cell);
  if (bordas) s.bd = bordas;
  const align = cell.alignment;
  const ht = alinhamentoHorizontal(align?.horizontal);
  if (ht !== undefined) s.ht = ht;
  const vt = alinhamentoVertical(align?.vertical);
  if (vt !== undefined) s.vt = vt;
  if (align?.wrapText) s.tb = 3; // WrapStrategy.WRAP
  return Object.keys(s).length > 0 ? (s as ICellData["s"]) : undefined;
}

/** Converte os merges do modelo exceljs ("A1:B2") em IRange (0-indexed) do Univer. */
function mergesDaSheet(ws: ExcelJS.Worksheet): IWorksheetData["mergeData"] {
  const modelo = (ws as unknown as { model?: { merges?: string[] } }).model;
  const merges = modelo?.merges;
  if (!Array.isArray(merges)) return [];
  const out: IWorksheetData["mergeData"] = [];
  for (const spec of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(spec);
    if (!m) continue;
    const col = (letras: string) =>
      letras.split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    out.push({
      startColumn: col(m[1]),
      startRow: Number(m[2]) - 1,
      endColumn: col(m[3]),
      endRow: Number(m[4]) - 1,
    });
  }
  return out;
}

/**
 * Bytes de .xlsx → `IWorkbookData` (parcial) pronto pro `univerAPI.createWorkbook`.
 * Uma aba por worksheet; ordem preservada.
 */
export async function xlsxParaWorkbookData(
  bytes: Uint8Array,
): Promise<Partial<IWorkbookData>> {
  const wb = new ExcelJS.Workbook();
  // exceljs aceita ArrayBuffer; copiamos para não depender do offset do Uint8Array.
  await wb.xlsx.load(bytes.slice().buffer as ArrayBuffer);

  const sheets: NonNullable<IWorkbookData["sheets"]> = {};
  const sheetOrder: string[] = [];

  wb.worksheets.forEach((ws, i) => {
    const sheetId = `sheet-${i}`;
    sheetOrder.push(sheetId);

    const cellData: NonNullable<IWorksheetData["cellData"]> = {};
    const rowData: NonNullable<IWorksheetData["rowData"]> = {};
    let maxLinha = 0;
    let maxColuna = 0;

    ws.eachRow({ includeEmpty: false }, (row, numeroLinha) => {
      const r = numeroLinha - 1;
      if (r >= MAX_LINHAS) return;
      // Altura de linha customizada (Excel guarda em pontos; Univer quer px).
      if (typeof row.height === "number" && row.height > 0) {
        rowData[r] = { h: Math.round(row.height * PT_PARA_PX) };
      }
      row.eachCell({ includeEmpty: false }, (cell, numeroColuna) => {
        const c = numeroColuna - 1;
        if (c >= MAX_COLUNAS) return;
        const valor = valorCelula(cell);
        const estilo = estiloCelula(cell);
        if (valor === null && !estilo) return;
        const dado: ICellData = {};
        if (valor !== null) dado.v = valor;
        if (estilo) dado.s = estilo;
        (cellData[r] ??= {})[c] = dado;
        if (r > maxLinha) maxLinha = r;
        if (c > maxColuna) maxColuna = c;
      });
    });

    // Larguras de coluna (Excel usa "char units"; ~7px por unidade).
    const columnData: NonNullable<IWorksheetData["columnData"]> = {};
    ws.columns?.forEach((col, idx) => {
      if (idx >= MAX_COLUNAS) return;
      if (typeof col.width === "number") {
        columnData[idx] = { w: Math.round(col.width * 7) };
      }
    });

    sheets[sheetId] = {
      id: sheetId,
      name: ws.name || `Sheet${i + 1}`,
      cellData,
      columnData,
      rowData,
      mergeData: mergesDaSheet(ws),
      rowCount: Math.min(MAX_LINHAS, Math.max(maxLinha + 1, 50)),
      columnCount: Math.min(MAX_COLUNAS, Math.max(maxColuna + 1, 26)),
    };
  });

  return {
    id: "preview-workbook",
    name: "preview",
    sheetOrder,
    sheets,
  };
}
