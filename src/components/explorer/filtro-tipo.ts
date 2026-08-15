// #985 (US1): busca in-folder do Explorer ganha GLOB (`*.docx`, `nome*`, `?`) e
// um filtro por CATEGORIA/tipo (Documentos/Imagens/Vídeos/Áudio/Compactados).
// Puro/`.ts` (sem React) — testável por `node --test`. O gate roda este helper
// por `node --test`, que NÃO resolve o alias `@/`; por isso o import de tipo usa
// caminho RELATIVO com `.ts` (padrão do repo — ver `resumo-op.ts`/`nao-vistas.ts`).
//
// As categorias REUSAM os agrupamentos de extensão de `icones-arquivo.ts`
// (POR_EXTENSAO): Documentos = DOC+PLANILHA+APRESENTACAO+PDF+TEXTO;
// Imagens = IMAGEM; Vídeos = VIDEO; Áudio = AUDIO; Compactados = COMPACTADO.
// Os conjuntos abaixo são uma RÉPLICA daquele arquivo (ele não exporta os sets e
// não está no escopo desta fatia) — mantenha em sincronia com `icones-arquivo.ts`,
// NÃO invente uma taxonomia diferente.
import type { FsEntry } from "../../lib/types.ts";

/** As 5 categorias-alvo do filtro de tipo (ids estáveis usados no widget/i18n). */
export type Categoria =
  | "documentos"
  | "imagens"
  | "videos"
  | "audio"
  | "compactados";

/** Ordem de exibição/classificação das categorias. */
export const CATEGORIAS_ORDEM: readonly Categoria[] = [
  "documentos",
  "imagens",
  "videos",
  "audio",
  "compactados",
];

// Extensões (minúsculas, SEM ponto) por categoria — réplica de POR_EXTENSAO em
// `icones-arquivo.ts`. Documentos junta os buckets DOC, PLANILHA, APRESENTACAO,
// PDF e TEXTO daquele arquivo.
export const CATEGORIAS: Record<Categoria, ReadonlySet<string>> = {
  documentos: new Set([
    // DOC
    "doc",
    "docx",
    "rtf",
    "odt",
    // PLANILHA
    "xls",
    "xlsx",
    "csv",
    "ods",
    // APRESENTACAO
    "ppt",
    "pptx",
    "odp",
    // PDF
    "pdf",
    // TEXTO
    "txt",
    "md",
    "log",
  ]),
  imagens: new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico"]),
  videos: new Set(["mp4", "mov", "mkv", "avi", "webm"]),
  audio: new Set(["mp3", "wav", "flac", "ogg", "m4a"]),
  compactados: new Set(["zip", "rar", "7z", "tar", "gz"]),
};

/**
 * Extensão normalizada de uma entrada: minúscula, sem ponto. Réplica de `extDe`
 * de `icones-arquivo.ts` (não exportado): prefere `e.extension`, cai no nome.
 */
function extDe(e: FsEntry): string {
  const raw = e.extension ?? "";
  const limpa = raw.replace(/^\./, "").toLowerCase();
  if (limpa) return limpa;
  const ponto = e.name.lastIndexOf(".");
  return ponto > 0 ? e.name.slice(ponto + 1).toLowerCase() : "";
}

/**
 * Casa `nome` contra um padrão glob: `*` → qualquer sequência, `?` → um caractere;
 * todos os outros metacaracteres de regex são escapados. Ancorado (`^…$`) e
 * case-insensitive. Só deve ser chamado quando `termo` contém `*` ou `?`.
 */
export function casaGlob(nome: string, termo: string): boolean {
  let padrao = "";
  for (const ch of termo) {
    if (ch === "*") {
      padrao += ".*";
    } else if (ch === "?") {
      padrao += ".";
    } else {
      // Escapa qualquer metacaractere de regex do caractere literal.
      padrao += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${padrao}$`, "i").test(nome);
}

/**
 * Categoria de uma entrada pela extensão, ou `null` quando não bate em nenhuma
 * (extensão desconhecida ou ausente). Pastas caem em `null` (não têm extensão).
 */
export function categoriaDeEntrada(e: FsEntry): Categoria | null {
  const ext = extDe(e);
  if (!ext) return null;
  for (const cat of CATEGORIAS_ORDEM) {
    if (CATEGORIAS[cat].has(ext)) return cat;
  }
  return null;
}

/**
 * Verdadeiro se `e` passa pelo filtro de tipo:
 * - `categorias` vazio → passa (filtro inativo);
 * - pasta → passa sempre (categorias filtram arquivo por tipo, não pastas);
 * - senão, passa se a categoria da entrada está em `categorias` (semântica OU
 *   entre as categorias selecionadas).
 */
export function passaFiltroTipo(
  e: FsEntry,
  categorias: readonly string[],
): boolean {
  if (categorias.length === 0) return true;
  if (e.isDir) return true;
  const cat = categoriaDeEntrada(e);
  return cat !== null && categorias.includes(cat);
}
