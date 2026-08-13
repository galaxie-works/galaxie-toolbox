// #678: mapa extensão → ícone (Lucide) + classe de cor Tailwind. Um Map keyed
// pela extensão em minúsculas — NÃO um switch de 100 casos. Pastas usam o Folder;
// o fallback genérico é o File. Puro/`.ts`.
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { FsEntry } from "@/lib/types";

export interface IconeArquivo {
  Icon: LucideIcon;
  /** Classe de cor Tailwind (tokens estáveis, legíveis em claro/escuro). */
  cor: string;
}

const DOC: IconeArquivo = { Icon: FileText, cor: "text-blue-500" };
const PLANILHA: IconeArquivo = { Icon: FileSpreadsheet, cor: "text-green-600" };
const APRESENTACAO: IconeArquivo = { Icon: Presentation, cor: "text-orange-500" };
const IMAGEM: IconeArquivo = { Icon: FileImage, cor: "text-purple-500" };
const VIDEO: IconeArquivo = { Icon: FileVideo, cor: "text-pink-500" };
const AUDIO: IconeArquivo = { Icon: FileAudio, cor: "text-amber-500" };
const COMPACTADO: IconeArquivo = { Icon: FileArchive, cor: "text-yellow-600" };
const CODIGO: IconeArquivo = { Icon: FileCode, cor: "text-sky-500" };
const JSON_ICO: IconeArquivo = { Icon: FileJson, cor: "text-lime-600" };
const TEXTO: IconeArquivo = { Icon: FileText, cor: "text-muted-foreground" };
const PDF: IconeArquivo = { Icon: FileText, cor: "text-red-500" };

/** Extensão (minúscula, sem ponto) → ícone. */
const POR_EXTENSAO: Map<string, IconeArquivo> = new Map([
  ["pdf", PDF],
  ["doc", DOC],
  ["docx", DOC],
  ["rtf", DOC],
  ["odt", DOC],
  ["xls", PLANILHA],
  ["xlsx", PLANILHA],
  ["csv", PLANILHA],
  ["ods", PLANILHA],
  ["ppt", APRESENTACAO],
  ["pptx", APRESENTACAO],
  ["odp", APRESENTACAO],
  ["txt", TEXTO],
  ["md", TEXTO],
  ["log", TEXTO],
  ["png", IMAGEM],
  ["jpg", IMAGEM],
  ["jpeg", IMAGEM],
  ["gif", IMAGEM],
  ["bmp", IMAGEM],
  ["svg", IMAGEM],
  ["webp", IMAGEM],
  ["ico", IMAGEM],
  ["mp4", VIDEO],
  ["mov", VIDEO],
  ["mkv", VIDEO],
  ["avi", VIDEO],
  ["webm", VIDEO],
  ["mp3", AUDIO],
  ["wav", AUDIO],
  ["flac", AUDIO],
  ["ogg", AUDIO],
  ["m4a", AUDIO],
  ["zip", COMPACTADO],
  ["rar", COMPACTADO],
  ["7z", COMPACTADO],
  ["tar", COMPACTADO],
  ["gz", COMPACTADO],
  ["js", CODIGO],
  ["jsx", CODIGO],
  ["ts", CODIGO],
  ["tsx", CODIGO],
  ["html", CODIGO],
  ["css", CODIGO],
  ["py", CODIGO],
  ["rs", CODIGO],
  ["json", JSON_ICO],
]);

const PASTA: IconeArquivo = { Icon: Folder, cor: "text-sky-500" };
const GENERICO: IconeArquivo = { Icon: File, cor: "text-muted-foreground" };

/**
 * Extensões RASTER que ganham miniatura (thumbnail). #820 (P0): `svg` (e qualquer
 * vetor) SAIU — rasterizar um SVG grande (o repro do Wagner era de 23 MB) trava a
 * UI. Vetor recebe ícone de TIPO (como o Explorer do Windows), nunca thumbnail. Só
 * formato raster real entra no pipeline (casa com o allowlist do `fs_thumbnail`).
 */
const EXT_IMAGEM = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
]);

function extDe(e: FsEntry): string {
  const raw = e.extension ?? "";
  const limpa = raw.replace(/^\./, "").toLowerCase();
  if (limpa) return limpa;
  const ponto = e.name.lastIndexOf(".");
  return ponto > 0 ? e.name.slice(ponto + 1).toLowerCase() : "";
}

/** Ícone + cor para uma entrada. Pasta → Folder; senão pelo mapa; senão File. */
export function iconeParaEntry(e: FsEntry): IconeArquivo {
  if (e.isDir) return PASTA;
  return POR_EXTENSAO.get(extDe(e)) ?? GENERICO;
}

/** É um arquivo de imagem elegível a miniatura? */
export function ehImagem(e: FsEntry): boolean {
  return !e.isDir && EXT_IMAGEM.has(extDe(e));
}
