/**
 * Classificação de anexos para pré-visualização (#178 · #188 PDF/TXT · #189
 * docx/xlsx · #450 imagem).
 *
 * Módulo puro (sem componentes) para o Fast Refresh não reclamar de export
 * misto: o `preview-anexo.tsx` só exporta componentes.
 */
import type { AnexoEmail } from "./types";

export type TipoPreview =
  | "pdf"
  | "txt"
  | "docx"
  | "xlsx"
  | "pptx"
  | "imagem"
  | "csv"
  | "audio"
  | "video"
  | "nao-suportado";

const CT_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CT_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CT_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Imagens que o WebView2/Chromium renderiza nativamente num `<img>`. `.tiff`
// fica de fora de propósito (não-suportado → CTA de baixar), não é erro (#450).
const CT_IMAGEM = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
]);
const EXT_IMAGEM = /\.(png|jpe?g|gif|webp|bmp|svg)$/;

// Áudio/vídeo que o WebView2/Chromium toca. `.mov`/quicktime, `.mkv`, `.avi`
// ficam de fora (não-suportado → CTA de baixar); o player ainda tem fallback
// por `onError` para codec fora de suporte que passe pela classificação (#452).
const CT_AUDIO = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
]);
const EXT_AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|weba)$/;
const CT_VIDEO = new Set(["video/mp4", "video/webm", "video/ogg"]);
const EXT_VIDEO = /\.(mp4|m4v|webm|ogv)$/;

/** Decide o renderer pelo `contentType` (preferido) e cai no sufixo do nome. */
export function classificarAnexo(anexo: AnexoEmail): TipoPreview {
  const ct = anexo.contentType.toLowerCase();
  const nome = anexo.nome.toLowerCase();
  if (ct === "application/pdf" || nome.endsWith(".pdf")) return "pdf";
  // CSV antes de txt: um `.csv` pode chegar como `text/plain` no contentType.
  if (ct === "text/csv" || nome.endsWith(".csv")) return "csv";
  if (ct.startsWith("text/plain") || nome.endsWith(".txt")) return "txt";
  if (ct === CT_DOCX || nome.endsWith(".docx")) return "docx";
  if (ct === CT_XLSX || nome.endsWith(".xlsx")) return "xlsx";
  if (ct === CT_PPTX || nome.endsWith(".pptx")) return "pptx";
  if (CT_IMAGEM.has(ct) || EXT_IMAGEM.test(nome)) return "imagem";
  if (CT_AUDIO.has(ct) || EXT_AUDIO.test(nome)) return "audio";
  if (CT_VIDEO.has(ct) || EXT_VIDEO.test(nome)) return "video";
  return "nao-suportado";
}

/** Formatos que docx/xlsx podem re-renderizar em alta fidelidade via Path C. */
export function aceitaAltaFidelidade(tipo: TipoPreview): boolean {
  return tipo === "docx" || tipo === "xlsx";
}

/** Mensagem embutida (e-mail encaminhado/.msg) — abre no reader aninhado (#191). */
export function ehItemAttachment(anexo: AnexoEmail): boolean {
  return anexo.odataType.toLowerCase().includes("itemattachment");
}

/** Anexo de referência (link OneDrive/SharePoint) — abre o link, sem baixar (#191). */
export function ehReferenceAttachment(anexo: AnexoEmail): boolean {
  return anexo.odataType.toLowerCase().includes("referenceattachment");
}

/** O clique do chip abre o preview só para formatos que sabemos renderizar. */
export function ehPrevisualizavel(anexo: AnexoEmail): boolean {
  return classificarAnexo(anexo) !== "nao-suportado";
}
