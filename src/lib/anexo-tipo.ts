/**
 * Classificação de anexos para pré-visualização (#188 · épico #178).
 *
 * Módulo puro (sem componentes) para o Fast Refresh não reclamar de export
 * misto: o `preview-anexo.tsx` só exporta componentes.
 */
import type { AnexoEmail } from "./types";

export type TipoPreview = "pdf" | "txt" | "nao-suportado";

/** Decide o renderer pelo `contentType` (preferido) e cai no sufixo do nome. */
export function classificarAnexo(anexo: AnexoEmail): TipoPreview {
  const ct = anexo.contentType.toLowerCase();
  const nome = anexo.nome.toLowerCase();
  if (ct === "application/pdf" || nome.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("text/plain") || nome.endsWith(".txt")) return "txt";
  return "nao-suportado";
}

/** O clique do chip abre o preview só para formatos que sabemos renderizar. */
export function ehPrevisualizavel(anexo: AnexoEmail): boolean {
  return classificarAnexo(anexo) !== "nao-suportado";
}
