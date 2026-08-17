// #678: ordenação pura do painel de conteúdo. Em `.ts` (sem React) pra ser
// testável e reusável. #990: por PADRÃO arquivos e pastas se MISTURAM pelo
// critério escolhido (mais recente primeiro em Data-desc, etc.) — pastas não
// vêm mais forçadas na frente. "Pastas primeiro" virou OPT-IN: com o parâmetro
// `pastasPrimeiro=true` reaparece o agrupamento (pastas antes, a chave só
// desempata dentro de cada grupo). Nome usa Collator numérico (ex.: "arq2" <
// "arq10"); tamanho/data comparam numérico; tipo compara pela extensão (com nome
// como desempate).
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
 * Devolve uma NOVA lista ordenada. #990: por padrão (`pastasPrimeiro=false`)
 * arquivos e pastas se intercalam puramente pela chave × direção. Com
 * `pastasPrimeiro=true`, as pastas vêm antes dos arquivos e a chave/direção só
 * desempatam dentro de cada grupo (a direção NÃO inverte a separação).
 */
export function ordenar(
  entradas: FsEntry[],
  ordem: Ordem,
  pastasPrimeiro = false,
): FsEntry[] {
  const sinal = ordem.direcao === "asc" ? 1 : -1;
  return [...entradas].sort((a, b) => {
    if (pastasPrimeiro && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return sinal * compararPorChave(a, b, ordem.chave);
  });
}
