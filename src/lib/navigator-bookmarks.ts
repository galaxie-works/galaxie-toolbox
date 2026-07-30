import type { BookmarkNode, BrowserBookmarks } from "@/lib/api";

/**
 * Favoritos do Navigator (#176).
 *
 * Modelo proprio, DESACOPLADO das abas: um favorito e um link (com `url`) ou uma
 * pasta (com `filhos`). A arvore inteira persiste em localStorage — mesmo padrao
 * dos pins/grupos em `navigator-tabs.ts`. As funcoes de CRUD sao imutaveis
 * (devolvem uma nova arvore) para casarem com o `setState` do React.
 */

export type FavoritoTipo = "link" | "pasta";

export interface Favorito {
  id: string;
  tipo: FavoritoTipo;
  nome: string;
  /** So `link`: destino http(s). */
  url?: string;
  /** So `pasta`: itens dentro dela. */
  filhos?: Favorito[];
}

export const NAVIGATOR_BOOKMARKS_KEY = "galaxie.navigator.bookmarks.v1";

let contadorId = 0;
/** Id local unico e estavel dentro da sessao (nao vaza pra fora do app). */
export function novoFavoritoId(): string {
  contadorId += 1;
  return `fav-${Date.now().toString(36)}-${contadorId}`;
}

function ehFavorito(value: unknown): value is Favorito {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<Favorito>;
  if (typeof f.id !== "string" || typeof f.nome !== "string") return false;
  if (f.tipo === "link") return typeof f.url === "string";
  if (f.tipo === "pasta") return true;
  return false;
}

/** Higieniza a arvore vinda do storage (descarta nos malformados). */
function sanear(nos: unknown): Favorito[] {
  if (!Array.isArray(nos)) return [];
  const saida: Favorito[] = [];
  for (const item of nos) {
    if (!ehFavorito(item)) continue;
    if (item.tipo === "pasta") {
      saida.push({
        id: item.id,
        tipo: "pasta",
        nome: item.nome,
        filhos: sanear(item.filhos),
      });
    } else if (/^https?:\/\//i.test(item.url ?? "")) {
      saida.push({ id: item.id, tipo: "link", nome: item.nome, url: item.url });
    }
  }
  return saida;
}

export function loadFavoritos(): Favorito[] {
  if (typeof window === "undefined") return [];
  try {
    return sanear(JSON.parse(localStorage.getItem(NAVIGATOR_BOOKMARKS_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function persistFavoritos(favoritos: Favorito[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAVIGATOR_BOOKMARKS_KEY, JSON.stringify(favoritos));
  } catch {
    // best-effort (storage indisponivel/quota cheia).
  }
}

// --- CRUD imutavel ----------------------------------------------------------

/** Insere um item na raiz ou dentro de uma pasta (por id). */
export function inserirFavorito(
  favoritos: Favorito[],
  item: Favorito,
  pastaId?: string | null,
): Favorito[] {
  if (!pastaId) return [...favoritos, item];
  return favoritos.map((f) =>
    f.tipo === "pasta"
      ? f.id === pastaId
        ? { ...f, filhos: [...(f.filhos ?? []), item] }
        : { ...f, filhos: inserirFavorito(f.filhos ?? [], item, pastaId) }
      : f,
  );
}

/** Remove um item (link ou pasta) da arvore, em qualquer profundidade. */
export function removerFavorito(favoritos: Favorito[], id: string): Favorito[] {
  const saida: Favorito[] = [];
  for (const f of favoritos) {
    if (f.id === id) continue;
    if (f.tipo === "pasta") {
      saida.push({ ...f, filhos: removerFavorito(f.filhos ?? [], id) });
    } else {
      saida.push(f);
    }
  }
  return saida;
}

/** Renomeia um item (link ou pasta) por id. */
export function renomearFavorito(
  favoritos: Favorito[],
  id: string,
  nome: string,
): Favorito[] {
  return favoritos.map((f) => {
    if (f.id === id) return { ...f, nome };
    if (f.tipo === "pasta") {
      return { ...f, filhos: renomearFavorito(f.filhos ?? [], id, nome) };
    }
    return f;
  });
}

/** Cria uma pasta vazia na raiz e devolve a nova arvore + o id criado. */
export function criarPasta(
  favoritos: Favorito[],
  nome: string,
): { favoritos: Favorito[]; id: string } {
  const id = novoFavoritoId();
  return {
    favoritos: [...favoritos, { id, tipo: "pasta", nome, filhos: [] }],
    id,
  };
}

/** Todas as pastas (id + nome) para o seletor de destino. */
export function listarPastas(
  favoritos: Favorito[],
  prefixo = "",
): { id: string; nome: string }[] {
  const saida: { id: string; nome: string }[] = [];
  for (const f of favoritos) {
    if (f.tipo === "pasta") {
      const rotulo = prefixo ? `${prefixo} / ${f.nome}` : f.nome;
      saida.push({ id: f.id, nome: rotulo });
      saida.push(...listarPastas(f.filhos ?? [], rotulo));
    }
  }
  return saida;
}

// --- Busca / palette --------------------------------------------------------

export interface FavoritoPlano {
  id: string;
  nome: string;
  url: string;
  caminho: string;
}

/** Achata todos os LINKS da arvore (com o caminho de pastas) — para a palette. */
export function achatarLinks(favoritos: Favorito[], caminho = ""): FavoritoPlano[] {
  const saida: FavoritoPlano[] = [];
  for (const f of favoritos) {
    if (f.tipo === "link" && f.url) {
      saida.push({ id: f.id, nome: f.nome, url: f.url, caminho });
    } else if (f.tipo === "pasta") {
      const proximo = caminho ? `${caminho} / ${f.nome}` : f.nome;
      saida.push(...achatarLinks(f.filhos ?? [], proximo));
    }
  }
  return saida;
}

export function contarLinks(favoritos: Favorito[]): number {
  return achatarLinks(favoritos).length;
}

// --- Importacao (Chrome/Edge) ----------------------------------------------

/** Chave estavel de um no importado dentro do conjunto (perfil + id do no). */
export function chaveNo(origem: BrowserBookmarks, no: BookmarkNode): string {
  return `${origem.navegador}:${origem.perfil}:${no.id}`;
}

/** Ids de TODOS os links descendentes de um no (para o toggle tri-state). */
export function linksDescendentes(
  origem: BrowserBookmarks,
  no: BookmarkNode,
): string[] {
  if (no.url) return [chaveNo(origem, no)];
  return no.filhos.flatMap((filho) => linksDescendentes(origem, filho));
}

/**
 * Converte a selecao (Set de chaves de link) numa lista de `Favorito`,
 * preservando a hierarquia de pastas. Uma pasta so entra se tiver algum link
 * selecionado dentro dela. Links viram `Favorito` com id novo do app.
 */
export function selecaoParaFavoritos(
  origens: BrowserBookmarks[],
  selecionados: Set<string>,
): Favorito[] {
  const converterNo = (
    origem: BrowserBookmarks,
    no: BookmarkNode,
  ): Favorito | null => {
    if (no.url) {
      return selecionados.has(chaveNo(origem, no))
        ? { id: novoFavoritoId(), tipo: "link", nome: no.nome || no.url, url: no.url }
        : null;
    }
    const filhos = no.filhos
      .map((filho) => converterNo(origem, filho))
      .filter((f): f is Favorito => f != null);
    if (filhos.length === 0) return null;
    return {
      id: novoFavoritoId(),
      tipo: "pasta",
      nome: no.nome || "—",
      filhos,
    };
  };

  const saida: Favorito[] = [];
  for (const origem of origens) {
    for (const raiz of origem.roots) {
      const convertido = converterNo(origem, raiz);
      if (convertido && convertido.tipo === "pasta") {
        // Aplana a pasta-raiz (barra/outros): traz os filhos direto, sem o
        // wrapper generico "Barra de favoritos".
        saida.push(...(convertido.filhos ?? []));
      } else if (convertido) {
        saida.push(convertido);
      }
    }
  }
  return saida;
}
