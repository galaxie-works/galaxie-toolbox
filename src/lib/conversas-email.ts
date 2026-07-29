import type { EmailItem } from "@/lib/types";

/**
 * Uma unidade exibível da lista quando "Conversation view" está ligada.
 *
 * Mensagens sem `conversationId` continuam unidades individuais. Uma conversa
 * com mais de uma mensagem guarda a mais recente em `principal` e as anteriores
 * em `anteriores`, já na ordem definida pelo `conversationIndex` do Graph.
 */
export interface ConversaEmail {
  chave: string;
  principal: EmailItem;
  anteriores: EmailItem[];
  quantidade: number;
  sinalizada: boolean;
  posicaoPrincipal: number;
}

interface ConversaEmConstrucao {
  chave: string;
  itens: Array<{ mensagem: EmailItem; posicao: number }>;
}

/**
 * O Graph serializa `conversationIndex` (Edm.Binary) como Base64. A ordem da
 * sequência binária indica a posição da mensagem no fio; comparar a string
 * Base64 diretamente não preserva necessariamente essa ordem.
 */
function decodificarConversationIndex(valor: string): Uint8Array | null {
  try {
    const binario = atob(valor);
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Compara índices binários do mais antigo para o mais recente. */
function compararConversationIndex(a: string, b: string): number {
  const bytesA = decodificarConversationIndex(a);
  const bytesB = decodificarConversationIndex(b);
  if (!bytesA || !bytesB) return 0;

  const limite = Math.min(bytesA.length, bytesB.length);
  for (let i = 0; i < limite; i++) {
    if (bytesA[i] !== bytesB[i]) return bytesA[i] - bytesB[i];
  }
  return bytesA.length - bytesB.length;
}

/**
 * Ordena uma conversa com a mensagem mais recente primeiro. Usa
 * `conversationIndex` quando ambos os itens o possuem e cai para a data apenas
 * quando o campo está ausente/inválido ou empata.
 */
export function compararMensagensDaConversa(a: EmailItem, b: EmailItem): number {
  if (a.conversationIndex && b.conversationIndex) {
    const porIndice = compararConversationIndex(
      a.conversationIndex,
      b.conversationIndex
    );
    if (porIndice !== 0) return -porIndice;
  }

  const dataA = new Date(a.recebido).getTime();
  const dataB = new Date(b.recebido).getTime();
  if (!Number.isNaN(dataA) && !Number.isNaN(dataB) && dataA !== dataB) {
    return dataB - dataA;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Monta as conversas somente sobre o conjunto já carregado/visível. Não busca
 * membros ausentes e não altera a ordem externa da lista: cada conversa ocupa
 * a posição em que a sua mensagem principal aparecia no resultado original.
 */
export function montarConversasEmail(mensagens: EmailItem[]): ConversaEmail[] {
  const porChave = new Map<string, ConversaEmConstrucao>();

  mensagens.forEach((mensagem, posicao) => {
    const conversationId = mensagem.conversationId?.trim();
    // Sem id, nunca agrupa por assunto/remetente: isso poderia fundir e-mails
    // não relacionados. A chave pelo id da mensagem mantém a unidade individual.
    const chave = conversationId
      ? `conversation:${conversationId}`
      : `message:${mensagem.id}`;
    const atual = porChave.get(chave);
    if (atual) {
      atual.itens.push({ mensagem, posicao });
    } else {
      porChave.set(chave, {
        chave,
        itens: [{ mensagem, posicao }],
      });
    }
  });

  return [...porChave.values()]
    .map((grupo) => {
      const ordenadas = grupo.itens
        .map((item) => item.mensagem)
        .sort(compararMensagensDaConversa);
      const principal = ordenadas[0];
      // A unidade ocupa a posição em que a própria linha principal aparecia
      // no resultado original, preservando data asc/desc, sender e subject.
      const posicaoPrincipal =
        grupo.itens.find((item) => item.mensagem === principal)?.posicao ?? 0;
      return {
        chave: grupo.chave,
        principal,
        anteriores: ordenadas.slice(1),
        quantidade: ordenadas.length,
        sinalizada: ordenadas.some((m) => m.sinalizado),
        posicaoPrincipal,
      };
    })
    .sort((a, b) => a.posicaoPrincipal - b.posicaoPrincipal);
}
