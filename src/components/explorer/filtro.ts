// #681: filtro in-folder + toggle de ocultos do painel de conteúdo. Puro/`.ts`
// (sem React) pra ser testável no `node --test` e reusável. Aplica ANTES da
// ordenação/virtualização: primeiro derruba os ocultos (quando desligado),
// depois filtra por nome (case-insensitive, substring). Pastas e arquivos
// passam pela mesma regra.
import type { FsEntry } from "@/lib/types";

/**
 * Filtra a lista de entradas por nome e pela visibilidade de ocultos.
 * - `termo` vazio/whitespace → não filtra por nome.
 * - `mostrarOcultos = false` → remove `isHidden`.
 * Devolve uma NOVA lista (não muta a entrada).
 */
export function filtrarEntradas(
  entradas: FsEntry[],
  termo: string,
  mostrarOcultos: boolean,
): FsEntry[] {
  const q = termo.trim().toLowerCase();
  return entradas.filter((e) => {
    if (!mostrarOcultos && e.isHidden) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
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
