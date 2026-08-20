// #1019 (épico #1007) — o hook da lista de mensagens do Bridge.
//
// O AC pede que os refs-espelho do bloco de paginação/cache/poll "fiquem
// encapsulados no hook (não vazam pro componente que o consome)". Isso tem uma
// consequência que vale dizer em voz alta: **um hook que DEVOLVE os refs não
// cumpre o AC** — só muda o endereço deles. Por isso a superfície aqui é de
// FUNÇÕES, e nenhum `Ref` sai deste arquivo.
//
// Fatia 4a de 3: este arquivo nasce com o que é auto-contido — a chave de cache,
// a junção de páginas e os espelhos. Os efeitos de paginação/poll vêm na 4b,
// junto com os refs que só eles usam. Fatiar assim é ordem do próprio card
// ("4-5 PRs pequenos, um extrato por vez"), e aqui isso importa mais que o
// normal: `mensagensRef` existe porque closure assíncrona com valor velho já
// mordeu esta tela antes, e mover 15 pontos de uma vez é o jeito mais fácil de
// deixar a suíte verde com o comportamento mudado.
import { useCallback, useRef } from "react";

import type { EmailItem } from "@/lib/types";
import type { OrdenarMensagens } from "@/lib/api";

/** Tamanho da página do Graph — âncora da paginação (#108). */
export const PAGINA = 50;

/** O estado da tela que o hook precisa ver SEMPRE atualizado. */
export interface EstadoLista {
  pastaSel: string;
  caixaAtiva: string;
  ordenar: OrdenarMensagens;
  ordemDesc: boolean;
  mensagens: EmailItem[] | null;
}

export interface ListaMensagens {
  /**
   * Chave do cache de sessão da pasta (#108). Escopada por caixa ativa (#111) e
   * ordenação (#32), pra que caixa compartilhada e troca de sort não colidam.
   */
  chaveCache: (pasta: string, caixa?: string) => string;
  /** Junta páginas deduplicando por id e tirando o que foi excluído otimista. */
  juntar: (prev: EmailItem[], nova: EmailItem[]) => EmailItem[];
  /** Valor MAIS NOVO de cada campo — pra usar dentro de closure assíncrona. */
  atual: () => EstadoLista;
  /** Marca ids como excluídos otimistas (some da lista até o Graph confirmar). */
  marcarDeletadas: (ids: string[]) => void;
  /** Devolve ids à lista quando a exclusão falhou no servidor. */
  desmarcarDeletadas: (ids: string[]) => void;
  /** Esquece as exclusões otimistas (troca de pasta, recarga). */
  limparDeletadas: () => void;
  /** `false` quando o id está marcado como excluído otimista. */
  naoDeletada: (id: string) => boolean;
  /**
   * Os ids excluídos otimistas, como VISTA somente-leitura.
   *
   * A busca do store recebe o conjunto inteiro (`ignorarIds`), então não dá pra
   * resolver com um predicado. Devolver a vista é diferente de vazar o ref: o
   * consumidor lê dados, não guarda `.current` nem escreve no conjunto.
   */
  idsDeletadas: () => ReadonlySet<string>;
}

/**
 * Espelha o estado da lista em refs e devolve só o que se pode CHAMAR.
 *
 * Os espelhos existem porque as closures assíncronas desta tela (poll,
 * `carregarMais`, backfill) precisam do valor mais novo, e não do valor que
 * havia quando a closure foi criada. Manter isso encapsulado é o ponto: quem
 * consome pergunta `atual()` e não tem como esquecer um `.current`.
 */
export function useListaMensagens(estado: EstadoLista): ListaMensagens {
  const espelho = useRef(estado);
  espelho.current = estado;

  // Ids excluídos de forma otimista: filtrados de qualquer fetch/append até o
  // Graph processar (evita a msg deletada "voltar" ao paginar/backfill).
  const deletadas = useRef<Set<string>>(new Set());

  const chaveCache = useCallback(
    (pasta: string, caixa = espelho.current.caixaAtiva) =>
      `${caixa}|${pasta}|${espelho.current.ordenar}|${espelho.current.ordemDesc}`,
    [],
  );

  const naoDeletada = useCallback((id: string) => !deletadas.current.has(id), []);

  const juntar = useCallback((prev: EmailItem[], nova: EmailItem[]) => {
    const vistos = new Set(prev.map((m) => m.id));
    return [
      ...prev,
      ...nova.filter((m) => !vistos.has(m.id) && !deletadas.current.has(m.id)),
    ];
  }, []);

  const atual = useCallback(() => espelho.current, []);

  const marcarDeletadas = useCallback((ids: string[]) => {
    ids.forEach((id) => deletadas.current.add(id));
  }, []);

  const desmarcarDeletadas = useCallback((ids: string[]) => {
    ids.forEach((id) => deletadas.current.delete(id));
  }, []);

  const limparDeletadas = useCallback(() => {
    deletadas.current = new Set();
  }, []);

  const idsDeletadas = useCallback(
    () => deletadas.current as ReadonlySet<string>,
    [],
  );

  return {
    chaveCache,
    juntar,
    atual,
    marcarDeletadas,
    desmarcarDeletadas,
    limparDeletadas,
    naoDeletada,
    idsDeletadas,
  };
}
