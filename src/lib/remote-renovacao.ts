// #1148 — agendador de renovação da credencial TURN no cliente. Fatia FE:
// AGENDA a reemissão antes do TTL e orquestra pedir→receber→aplicar→reagendar,
// mais o aviso de UI se a renovação falhar. A fatia 1 (servidor) já responde
// `RenewIceServers` → `IceServersRenewed` (ea15b87). O APPLY na PeerConnection
// (str0m no Rust) é comando Tauri de fatia BE companheira — aqui só o entrego
// via callback `aplicar`, que a tela liga no comando quando ele existir.
//
// Doutrina (Altair, #1148): o gatilho vem de `expires_at_unix_seconds` (nunca de
// constante `1800` no cliente); renova a 3/4 do restante, deixando ≥1/4 de TTL
// como janela pra avisar+retry se a renovação falhar. Relógio e timer são
// INJETADOS — o teste prova a renovação com o relógio adiantado, sem `sleep`.

import type { IceServer } from "./remote-signaling";

/**
 * Atraso (ms) até disparar a renovação: 3/4 do tempo RESTANTE da credencial,
 * deixando o último 1/4 como janela de aviso/retry. Credencial já vencida (ou
 * sem expiração conhecida) → 0 (renova já).
 */
export function calcularAtrasoRenovacaoMs(
  expiresAtUnixSeconds: number,
  agoraUnixSeconds: number,
): number {
  const restanteSeg = expiresAtUnixSeconds - agoraUnixSeconds;
  if (!Number.isFinite(restanteSeg) || restanteSeg <= 0) return 0;
  return Math.max(0, Math.floor(restanteSeg * 0.75 * 1000));
}

/** O `expires_at` mais cedo entre os ICE servers (o primeiro a vencer manda). */
export function expiraMaisCedo(iceServers: IceServer[]): number {
  const prazos = iceServers
    .map((s) => s.expiresAtUnixSeconds)
    .filter((n) => Number.isFinite(n) && n > 0);
  return prazos.length ? Math.min(...prazos) : 0;
}

export interface DepsAgendador {
  /** Relógio em segundos Unix (injetável — teste adianta). */
  agoraUnixSeconds: () => number;
  /** Agenda `fn` em `ms`; devolve um id de cancelamento. */
  agendar: (fn: () => void, ms: number) => number;
  /** Cancela um agendamento. */
  cancelar: (id: number) => void;
  /** Pede a reemissão pela conexão de signaling JÁ autenticada (sem re-pareamento). */
  pedirRenovacao: () => void;
  /** Entrega a credencial nova pra ser APLICADA na PC (comando Tauri da fatia BE). */
  aplicar: (iceServers: IceServer[]) => void;
  /** Avisa a UI que a renovação está em risco (≥1/4 do TTL de antecedência). */
  aoAvisar: (emRisco: boolean) => void;
}

export interface AgendadorRenovacao {
  /** Inicia o ciclo a partir das credenciais atuais (do `registered`). */
  iniciar: (iceServers: IceServer[]) => void;
  /** Chamar quando chegar `IceServersRenewed`: aplica, limpa o aviso e reagenda. */
  aoRenovado: (iceServers: IceServer[]) => void;
  /** Para tudo (fim da sessão). */
  parar: () => void;
}

/**
 * Orquestra o ciclo de renovação. Sem timers globais nem relógio real — tudo
 * pelas deps, então o teste roda o relógio à frente e verifica o comportamento.
 *
 * Ciclo: `iniciar`/`aoRenovado` agenda em 3/4 do restante → dispara
 * `pedirRenovacao` + arma a janela de risco (1/4 restante) → se `aoRenovado`
 * chegar antes, `aplicar`+limpa risco+reagenda; se a janela estourar, `aoAvisar`
 * e continua pedindo (retry) até renovar ou a sessão parar.
 */
export function criarAgendadorRenovacao(deps: DepsAgendador): AgendadorRenovacao {
  let idRenovar: number | null = null;
  let idRisco: number | null = null;

  function limparTimers(): void {
    if (idRenovar != null) deps.cancelar(idRenovar);
    if (idRisco != null) deps.cancelar(idRisco);
    idRenovar = null;
    idRisco = null;
  }

  function agendarPara(expiresAt: number): void {
    limparTimers();
    if (expiresAt <= 0) return; // sem prazo conhecido: não agenda (STUN-only, etc.)
    const agora = deps.agoraUnixSeconds();
    const restanteSeg = expiresAt - agora;
    const atraso = calcularAtrasoRenovacaoMs(expiresAt, agora);
    idRenovar = deps.agendar(() => {
      idRenovar = null;
      deps.pedirRenovacao();
      // Janela de risco: o 1/4 restante entre o pedido e o vencimento. Se a
      // renovação não voltar até lá, avisa e re-pede (retry).
      const riscoMs = Math.max(0, Math.floor(restanteSeg * 0.25 * 1000));
      idRisco = deps.agendar(() => {
        idRisco = null;
        deps.aoAvisar(true);
        deps.pedirRenovacao(); // retry — a antiga ainda pode estar de pé
      }, riscoMs);
    }, atraso);
  }

  return {
    iniciar(iceServers) {
      agendarPara(expiraMaisCedo(iceServers));
    },
    aoRenovado(iceServers) {
      deps.aplicar(iceServers);
      deps.aoAvisar(false); // renovou: limpa qualquer aviso de risco
      agendarPara(expiraMaisCedo(iceServers));
    },
    parar() {
      limparTimers();
    },
  };
}
