// #678: ordenação pura do painel de conteúdo. Em `.ts` (sem React) pra ser
// testável e reusável. Regra invariante: PASTAS SEMPRE PRIMEIRO — a chave de
// ordenação só desempata dentro de cada grupo (pastas entre si, arquivos entre
// si). Nome usa Collator numérico (ex.: "arq2" < "arq10"); tamanho/data comparam
// numérico; tipo compara pela extensão (com nome como desempate).
import type { FsEntry } from "@/lib/types";

export type ChaveOrdem = "nome" | "modificado" | "tipo" | "tamanho";
export type DirecaoOrdem = "asc" | "desc";

export interface Ordem {
  chave: ChaveOrdem;
  direcao: DirecaoOrdem;
}

// `numeric` trata sequências de dígitos como número; `sensitivity: base` ignora
// caixa e acento (a → á → A comparam igual), como o Explorer.
const colator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function tipoDe(e: FsEntry): string {
  if (e.extension) return e.extension.toLowerCase();
  // Sem extensão: cai no nome pra manter estável.
  const ponto = e.name.lastIndexOf(".");
  return ponto > 0 ? e.name.slice(ponto + 1).toLowerCase() : "";
}

/** Compara duas entradas pela chave (ignora direção e a regra pasta-primeiro). */
function compararPorChave(a: FsEntry, b: FsEntry, chave: ChaveOrdem): number {
  switch (chave) {
    case "tamanho":
      // Pastas não têm tamanho útil; entre pastas o nome desempata.
      return a.size - b.size || colator.compare(a.name, b.name);
    case "modificado": {
      const ma = a.modifiedMs ?? 0;
      const mb = b.modifiedMs ?? 0;
      return ma - mb || colator.compare(a.name, b.name);
    }
    case "tipo": {
      const ta = tipoDe(a);
      const tb = tipoDe(b);
      return colator.compare(ta, tb) || colator.compare(a.name, b.name);
    }
    case "nome":
    default:
      return colator.compare(a.name, b.name);
  }
}

/**
 * Devolve uma NOVA lista ordenada. Pastas primeiro sempre; dentro de cada grupo
 * aplica a chave e a direção. A direção NÃO inverte a separação pasta/arquivo.
 */
export function ordenar(entradas: FsEntry[], ordem: Ordem): FsEntry[] {
  const sinal = ordem.direcao === "asc" ? 1 : -1;
  return [...entradas].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // pasta antes de arquivo
    return sinal * compararPorChave(a, b, ordem.chave);
  });
}
