/**
 * Atoms — modelo de atenção (épico #181, spec docs/atoms-dashboard-spec.md §3).
 *
 * Regra determinística e LEGÍVEL (sem IA — IA é o #180/Astro): cada sinal
 * (agenda/e-mail/to-do) vira um `AtomItem` com um `score` e um `motivo`
 * estruturado. O score é o MÁXIMO de umas poucas cláusulas simples, cada uma
 * expressável em uma frase de UI — o `motivo` é mostrado no item pra o usuário
 * confiar na ordenação. Empate desempata por `quando` ascendente (mais cedo
 * primeiro).
 *
 * Desenhado já na Slice 1 (mesmo o feed unificado só chegando na Slice 3) pra os
 * widgets e o feed compartilharem UM cérebro de ranqueamento.
 */

export type AtomOrigem = "agenda" | "email" | "todo";

/** Chave do motivo (a string localizada sai de `t.atoms.motivo*` na view). */
export type AtomMotivo =
  | "iminente" // evento começando já (≤30 min)
  | "vencido" // to-do com prazo estourado
  | "prazoHoje" // to-do vence hoje
  | "sinalizado" // e-mail sinalizado de propósito
  | "naoLido" // e-mail não-lido recente
  | "hoje" // evento/tarefa de hoje, sem urgência
  | "futuro"; // depois de hoje / sem urgência

/** Fatos normalizados de um sinal, entrada pura do `pontuar`. */
export interface SinalAtom {
  origem: AtomOrigem;
  /** epoch ms: início do evento, recebimento do e-mail, vencimento da tarefa. */
  quando?: number;
  flagged?: boolean;
  naoLido?: boolean;
  /** to-do com prazo já passado. */
  vencido?: boolean;
  /** evento/tarefa cujo `quando` cai no dia de `agora`. */
  hoje?: boolean;
}

export interface AtomItem {
  id: string;
  origem: AtomOrigem;
  titulo: string;
  quando?: number;
  score: number;
  motivo: AtomMotivo;
  /** minutos até o `quando` (só quando `motivo === "iminente"`), pra copy. */
  minutos?: number;
  /** click-through (§5). Opcional aqui — a view liga aos callbacks do shell. */
  acao?: () => void;
}

/** Janela da "iminência": um evento a ≤30 min é o topo do feed. */
export const IMINENCIA_MIN = 30;
/** Não-lido "recente" decai ao longo destas horas (§3). */
export const NAO_LIDO_HORAS = 24;

const MIN_MS = 60_000;
const HORA_MS = 3_600_000;

/**
 * Score + motivo de um sinal, dado o instante `agora` (epoch ms). Score em
 * 0..1; cada cláusula é uma faixa de peso legível, o resultado é o MÁXIMO da que
 * dispara. Determinístico e puro — testável sem relógio real.
 */
export function pontuar(
  sinal: SinalAtom,
  agora: number,
): { score: number; motivo: AtomMotivo; minutos?: number } {
  const candidatos: Array<{ score: number; motivo: AtomMotivo; minutos?: number }> =
    [];

  // Iminência (peso mais alto): evento em ≤30 min. Ramp: quanto mais perto do
  // início, maior — 1.0 no início, ~0.8 na borda dos 30 min.
  if (sinal.origem === "agenda" && sinal.quando != null) {
    const faltamMin = Math.round((sinal.quando - agora) / MIN_MS);
    if (faltamMin >= 0 && faltamMin <= IMINENCIA_MIN) {
      const proximidade = 1 - faltamMin / IMINENCIA_MIN; // 0..1
      candidatos.push({
        score: 0.8 + 0.2 * proximidade,
        motivo: "iminente",
        minutos: faltamMin,
      });
    }
  }

  // Prazo estourado / vence hoje (to-do).
  if (sinal.origem === "todo") {
    if (sinal.vencido) candidatos.push({ score: 0.85, motivo: "vencido" });
    else if (sinal.hoje) candidatos.push({ score: 0.7, motivo: "prazoHoje" });
  }

  // Sinalizado de propósito (e-mail).
  if (sinal.flagged) candidatos.push({ score: 0.6, motivo: "sinalizado" });

  // Não-lido recente (e-mail): decai com a idade ao longo de NAO_LIDO_HORAS.
  if (sinal.naoLido && sinal.quando != null) {
    const idadeH = (agora - sinal.quando) / HORA_MS;
    if (idadeH >= 0 && idadeH <= NAO_LIDO_HORAS) {
      const frescor = 1 - idadeH / NAO_LIDO_HORAS; // 1 agora → 0 em 24h
      candidatos.push({ score: 0.2 + 0.25 * frescor, motivo: "naoLido" });
    }
  }

  // Hoje (baseline calmo): evento/tarefa de hoje sem urgência acima.
  if (sinal.hoje) candidatos.push({ score: 0.2, motivo: "hoje" });

  if (candidatos.length === 0) {
    return { score: 0.05, motivo: "futuro" };
  }
  // Vence o de maior score (o motivo mais forte lidera).
  return candidatos.reduce((a, b) => (b.score > a.score ? b : a));
}

/**
 * Ordena `AtomItem[]` para o feed/widget: score desc, empate por `quando` asc
 * (mais cedo primeiro), depois por id pra estabilidade.
 */
export function ordenarAtoms(itens: AtomItem[]): AtomItem[] {
  return [...itens].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const qa = a.quando ?? Number.POSITIVE_INFINITY;
    const qb = b.quando ?? Number.POSITIVE_INFINITY;
    if (qa !== qb) return qa - qb;
    return a.id.localeCompare(b.id);
  });
}

/** Constrói um `AtomItem` a partir de um sinal + textos já resolvidos. */
export function criarAtom(
  id: string,
  origem: AtomOrigem,
  titulo: string,
  sinal: SinalAtom,
  agora: number,
  acao?: () => void,
): AtomItem {
  const { score, motivo, minutos } = pontuar(sinal, agora);
  return { id, origem, titulo, quando: sinal.quando, score, motivo, minutos, acao };
}
