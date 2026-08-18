// #681: filtro in-folder + toggle de ocultos do painel de conteúdo. Puro/`.ts`
// (sem React) pra ser testável no `node --test` e reusável. Aplica ANTES da
// ordenação/virtualização: primeiro derruba os ocultos (quando desligado),
// depois filtra por nome. Pastas e arquivos passam pela mesma regra.
// #985 (US1): a busca por nome passa a ser GLOB-aware — quando o termo contém
// `*` ou `?`, casa por glob ancorado (via `casaGlob`); senão mantém o substring
// case-insensitive de sempre.
import type { FsEntry } from "@/lib/types";

import { casaGlob } from "./filtro-tipo.ts";

/**
 * Filtra a lista de entradas por nome e pela visibilidade de ocultos.
 * - `termo` vazio/whitespace → não filtra por nome.
 * - `termo` com `*`/`?` → glob ancorado, case-insensitive (`*.docx`, `nome*`, `?`).
 * - `termo` sem coringa → substring case-insensitive (comportamento original).
 * - `mostrarOcultos = false` → remove `isHidden`.
 * Devolve uma NOVA lista (não muta a entrada).
 */
export function filtrarEntradas(
  entradas: FsEntry[],
  termo: string,
  mostrarOcultos: boolean,
): FsEntry[] {
  const bruto = termo.trim();
  const q = bruto.toLowerCase();
  const usarGlob = bruto.includes("*") || bruto.includes("?");
  return entradas.filter((e) => {
    if (!mostrarOcultos && e.isHidden) return false;
    if (bruto) {
      if (usarGlob) {
        if (!casaGlob(e.name, bruto)) return false;
      } else if (!e.name.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

/** Chave de um atributo ativo de uma entrada (pro InspectorPane). */
export type AtributoArquivo = "oculto" | "somenteLeitura" | "symlink";

/** Lista os atributos ativos de uma entrada, na ordem de exibição. */
export function atributosAtivos(e: FsEntry): AtributoArquivo[] {
  const out: AtributoArquivo[] = [];
  if (e.isHidden) out.push("oculto");
  if (e.isReadonly) out.push("somenteLeitura");
  if (e.isSymlink) out.push("symlink");
  return out;
}
