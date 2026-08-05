/**
 * Primeira implementação do Outbox (#33): uma janela cancelável em memória,
 * antes de qualquer chamada de envio ao Graph.
 *
 * O atraso é fixo nesta story por decisão do PO na #133. A configuração
 * persistida de 5/10/30 s pertence a um follow-up de Settings.
 */
export const UNDO_SEND_DELAY_MS = 10_000;
export const OUTBOX_TICK_MS = 500;

// #531 (AC5): registro dos envios ainda na janela de undo. Ao FECHAR o app (ou
// refresh), dispara todos NA HORA — best-effort: o POST é emitido, mas a resposta
// pode não retornar antes do processo encerrar. Sem isso, um envio pendente seria
// silenciosamente PERDIDO no fechamento.
const pendentesForcar = new Set<() => void>();
let flushRegistrado = false;

/** Dispara imediatamente todos os envios pendentes (fechamento/refresh do app). */
export function flushOutboxPendentes(): void {
  for (const forcar of [...pendentesForcar]) forcar();
}

function registrarFlushNoFechamento(): void {
  if (flushRegistrado || typeof window === "undefined") return;
  flushRegistrado = true;
  // `pagehide` cobre fechar/navegar melhor que `beforeunload` em alguns engines;
  // registramos os dois (idempotente — a mesma função só dispara pendentes).
  window.addEventListener("pagehide", flushOutboxPendentes);
  window.addEventListener("beforeunload", flushOutboxPendentes);
}

export type FaseEnvioPendente =
  | "pendente"
  | "enviando"
  | "desfeito"
  | "cancelado"
  | "concluido"
  | "falhou";

export interface ProgressoEnvioPendente {
  segundosRestantes: number;
  progresso: number;
}

export interface AgendamentoEnvio {
  /** Desfaz somente enquanto o POST real ainda não começou. */
  desfazer: () => boolean;
  /** Cancela silenciosamente (cleanup/unmount/shutdown). */
  cancelar: () => boolean;
  fase: () => FaseEnvioPendente;
}

export interface OpcoesAgendamentoEnvio {
  enviar: () => Promise<void>;
  atrasoMs?: number;
  intervaloMs?: number;
  agora?: () => number;
  onContagem?: (estado: ProgressoEnvioPendente) => void;
  onDisparando?: () => void;
  onConcluido?: () => void;
  onErro?: (erro: unknown) => void;
  onDesfeito?: () => void;
}

/**
 * Agenda exatamente uma operação. O callback `enviar` nunca é executado depois
 * de `desfazer`/`cancelar`; depois de `onDisparando`, o envio já pertence ao
 * Graph e não é mais falsamente anunciado como cancelável.
 */
export function agendarEnvio(
  opcoes: OpcoesAgendamentoEnvio
): AgendamentoEnvio {
  const atrasoMs = Math.max(0, opcoes.atrasoMs ?? UNDO_SEND_DELAY_MS);
  const intervaloMs = Math.max(10, opcoes.intervaloMs ?? OUTBOX_TICK_MS);
  const agora = opcoes.agora ?? Date.now;
  const inicio = agora();
  const limite = inicio + atrasoMs;

  let faseAtual: FaseEnvioPendente = "pendente";
  let silencioso = false;
  let intervalo: ReturnType<typeof setInterval> | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const limparTemporizadores = () => {
    if (intervalo !== null) clearInterval(intervalo);
    if (temporizador !== null) clearTimeout(temporizador);
    intervalo = null;
    temporizador = null;
  };

  const notificarContagem = () => {
    if (faseAtual !== "pendente" || silencioso) return;
    const restanteMs = Math.max(0, limite - agora());
    opcoes.onContagem?.({
      segundosRestantes: Math.max(1, Math.ceil(restanteMs / 1_000)),
      progresso:
        atrasoMs === 0
          ? 100
          : Math.min(100, Math.max(0, ((atrasoMs - restanteMs) / atrasoMs) * 100)),
    });
  };

  const forcarDisparo = () => disparar();
  const desregistrar = () => pendentesForcar.delete(forcarDisparo);

  const disparar = () => {
    if (faseAtual !== "pendente") return;
    limparTemporizadores();
    desregistrar();
    faseAtual = "enviando";
    if (!silencioso) opcoes.onDisparando?.();

    void Promise.resolve()
      .then(opcoes.enviar)
      .then(() => {
        faseAtual = "concluido";
        if (!silencioso) opcoes.onConcluido?.();
      })
      .catch((erro: unknown) => {
        faseAtual = "falhou";
        if (!silencioso) opcoes.onErro?.(erro);
      });
  };

  // #531 (AC5): registra o disparo forçado para o flush no fechamento do app.
  registrarFlushNoFechamento();
  pendentesForcar.add(forcarDisparo);

  // #531 (AC4/Desligado): atrasoMs=0 não abre janela de undo — envia imediato,
  // sem toast de contagem (o hook só cria o toast "Desfazer" via `onContagem`).
  // Com atraso, conta normalmente.
  if (atrasoMs > 0) {
    notificarContagem();
    intervalo = setInterval(notificarContagem, intervaloMs);
  }
  temporizador = setTimeout(disparar, atrasoMs);

  return {
    desfazer: () => {
      if (faseAtual !== "pendente") return false;
      limparTemporizadores();
      desregistrar();
      faseAtual = "desfeito";
      if (!silencioso) opcoes.onDesfeito?.();
      return true;
    },
    cancelar: () => {
      silencioso = true;
      if (faseAtual !== "pendente") return false;
      limparTemporizadores();
      desregistrar();
      faseAtual = "cancelado";
      return true;
    },
    fase: () => faseAtual,
  };
}
