/**
 * #1153 (fatia 1): integridade de FORMATO dos ícones de `public/app-icons/*.svg`.
 *
 * O bug: 210 "ícones" são JPEG/PNG/WEBP renomeados `.svg` — o `<img>` rotula
 * `image/svg+xml` pela extensão, o browser tenta parsear XML, falha e cai no
 * fallback da inicial. O campo `icon:true` do catálogo era afirmação do gerador,
 * não verificação: nenhum teste abria os arquivos. Estas funções são PURAS
 * (recebem bytes/texto) pra o gate testá-las sem depender da app.
 */

export type ClasseIcone =
  | "svg" // SVG de verdade (`<svg`/`<?xml`)
  | "jpeg" // FF D8 FF
  | "png" // 89 50 4E 47
  | "webp" // RIFF....WEBP
  | "gif" // GIF8
  | "vazio" // 0 bytes
  | "desconhecido"; // texto que não é SVG / binário não reconhecido

/** Um arquivo é "raster renomeado .svg" se caiu numa dessas classes de imagem. */
export const CLASSES_RASTER: ReadonlyArray<ClasseIcone> = ["jpeg", "png", "webp", "gif"];

/** `true` se `classe` é uma imagem raster (não renderiza como `<img src=.svg>`). */
export function ehRaster(classe: ClasseIcone): boolean {
  return CLASSES_RASTER.includes(classe);
}

function comecaCom(bytes: Uint8Array, assinatura: number[], offset = 0): boolean {
  if (bytes.length < offset + assinatura.length) return false;
  return assinatura.every((b, i) => bytes[offset + i] === b);
}

/**
 * Classifica o conteúdo pelos MAGIC BYTES (não pela extensão). Só o cabeçalho é
 * lido; para SVG olha os primeiros chars por `<svg`/`<?xml` (tolerando BOM UTF-8
 * e espaço/quebra iniciais).
 */
export function classificarIcone(bytes: Uint8Array): ClasseIcone {
  if (bytes.length === 0) return "vazio";
  if (comecaCom(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (comecaCom(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (comecaCom(bytes, [0x52, 0x49, 0x46, 0x46]) && comecaCom(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "webp";
  if (comecaCom(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";

  // Texto: pode ser SVG. Decodifica um trecho e procura o começo do documento.
  const trecho = new TextDecoder("utf-8").decode(bytes.slice(0, 512));
  // remove BOM + espaços/quebras iniciais e um bloco de comentário/doctype líder.
  const inicio = trecho.replace(/^﻿/, "").trimStart();
  if (/^(<\?xml|<svg|<!--|<!doctype svg)/i.test(inicio)) return "svg";
  return "desconhecido";
}

/**
 * Heurística (best-effort) do SVG "só branco": some no tema claro. Verdadeiro se
 * o SVG usa branco (`#fff`/`#ffffff`/`white`) como cor e NÃO usa `currentColor`
 * nem nenhuma outra cor visível (hex não-branco, `rgb(`, ou nome de cor comum).
 * É heurística — a remediação (fatia 2) decide caso a caso; aqui só sinaliza.
 */
export function svgSuspeitoBranco(texto: string): boolean {
  if (/currentColor/i.test(texto)) return false;
  const usaBranco = /(fill|stroke)\s*[:=]\s*["']?\s*(#fff(fff)?|white)\b/i.test(texto);
  if (!usaBranco) return false;
  // alguma cor NÃO-branca torna o ícone visível no claro → não é "só branco".
  const hexNaoBranco = /#(?![fF]{3}\b)(?![fF]{6}\b)[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b/.test(texto);
  const temRgb = /rgb\s*\(/i.test(texto);
  const temNomeEscuro = /(fill|stroke)\s*[:=]\s*["']?\s*(black|gray|grey|#000)/i.test(texto);
  return !hexNaoBranco && !temRgb && !temNomeEscuro;
}
