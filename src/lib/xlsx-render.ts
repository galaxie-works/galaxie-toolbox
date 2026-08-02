/**
 * xlsx → matriz de valores para pré-visualização (#189 · épico #178, Slice 2).
 *
 * Segurança (spec §7): **valores em cache, nunca avaliar fórmula** nem gerar
 * HTML (`cellFormula:false`, `cellHTML:false`). `HYPERLINK`/`WEBSERVICE` viram
 * texto. A lib é carregada sob demanda.
 */
export interface Planilha {
  nome: string;
  linhas: string[][];
}

/** Teto defensivo para planilhas gigantes (o preview é para "decidir", não BI). */
const MAX_LINHAS = 1000;
const MAX_COLUNAS = 50;

export async function lerXlsx(bytes: Uint8Array): Promise<Planilha[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
  });
  return wb.SheetNames.map((nome) => {
    const ws = wb.Sheets[nome];
    const bruto = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    const linhas = bruto
      .slice(0, MAX_LINHAS)
      .map((r) => r.slice(0, MAX_COLUNAS).map((c) => String(c ?? "")));
    return { nome, linhas };
  });
}
