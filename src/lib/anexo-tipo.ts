/**
 * Classificação de anexos para pré-visualização (#178 · #188 PDF/TXT · #189
 * docx/xlsx).
 *
 * Módulo puro (sem componentes) para o Fast Refresh não reclamar de export
 * misto: o `preview-anexo.tsx` só exporta componentes.
 */
import type { AnexoEmail } from "./types";

export type TipoPreview = "pdf" | "txt" | "docx" | "xlsx" | "nao-suportado";

const CT_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CT_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Decide o renderer pelo `contentType` (preferido) e cai no sufixo do nome. */
export function classificarAnexo(anexo: AnexoEmail): TipoPreview {
  const ct = anexo.contentType.toLowerCase();
  const nome = anexo.nome.toLowerCase();
  if (ct === "application/pdf" || nome.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("text/plain") || nome.endsWith(".txt")) return "txt";
  if (ct === CT_DOCX || nome.endsWith(".docx")) return "docx";
  if (ct === CT_XLSX || nome.endsWith(".xlsx")) return "xlsx";
  return "nao-suportado";
}

/** O clique do chip abre o preview só para formatos que sabemos renderizar. */
export function ehPrevisualizavel(anexo: AnexoEmail): boolean {
  return classificarAnexo(anexo) !== "nao-suportado";
}
