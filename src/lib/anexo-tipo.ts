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
  | "html"
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

/**
 * Núcleo da classificação: decide o renderer pelo `contentType` (preferido) e
 * cai no sufixo do nome. Serve tanto o anexo do Bridge (contentType do Graph)
 * quanto o arquivo LOCAL do Explorer (#873), que costuma chegar só com o nome
 * (sem MIME) — daí `contentType` opcional.
 */
export function classificarPorNome(
  nome: string,
  contentType?: string,
): TipoPreview {
  const ct = (contentType ?? "").toLowerCase();
  const n = nome.toLowerCase();
  if (ct === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  // CSV antes de txt: um `.csv`/`.tsv` pode chegar como `text/plain` no ct. O
  // parser auto-detecta o delimitador (`,`/`;`/tab), então TSV/TAB/PSV entram no
  // MESMO grid virtualizado do CSV (#941) — não caem em txt cru.
  if (
    ct === "text/csv" ||
    ct === "text/tab-separated-values" ||
    n.endsWith(".csv") ||
    n.endsWith(".tsv") ||
    n.endsWith(".tab") ||
    n.endsWith(".psv")
  )
    return "csv";
  // #873 fix: HTML renderiza SANITIZADO (DOMPurify) no iframe sandbox+CSP, igual
  // ao docx/xlsx. Antes de txt: um `.html` pode vir como `text/plain` no ct.
  if (ct === "text/html" || n.endsWith(".html") || n.endsWith(".htm"))
    return "html";
  if (ct.startsWith("text/plain") || n.endsWith(".txt")) return "txt";
  if (ct === CT_DOCX || n.endsWith(".docx")) return "docx";
  if (ct === CT_XLSX || n.endsWith(".xlsx")) return "xlsx";
  if (ct === CT_PPTX || n.endsWith(".pptx")) return "pptx";
  if (CT_IMAGEM.has(ct) || EXT_IMAGEM.test(n)) return "imagem";
  if (CT_AUDIO.has(ct) || EXT_AUDIO.test(n)) return "audio";
  if (CT_VIDEO.has(ct) || EXT_VIDEO.test(n)) return "video";
  return "nao-suportado";
}

/** Decide o renderer de um anexo do Bridge (delega para `classificarPorNome`). */
export function classificarAnexo(anexo: AnexoEmail): TipoPreview {
  return classificarPorNome(anexo.nome, anexo.contentType);
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
