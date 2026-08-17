// #1129 A1 (migração `/v2/ws`): scaffold do plano de controle v2 do signaling.
//
// O v2 é o plano de controle S8. HOJE ele NÃO entrega `ice_servers` (US #1133,
// servidor) e NENHUM device está matriculado (US #1132) → o Register v2 é SEMPRE
// recusado, então o app SEMPRE cai pro v1. Este módulo estabelece o caminho
// v2-first + fallback logado; o caminho v2-sucesso só ativa quando #1132 E #1133
// existirem. NÃO há caminho de sessão v2 aqui (sem ice_servers seria "verde que
// não funciona").
//
// Por que um módulo separado do `remote-signaling.ts`: aqui só vivem funções
// PURAS + a máquina de estado do probe com dependências INJETADAS. O único import
// é `import type` (apagado em runtime), então este módulo é testável direto pelo
// `node --test` (sem WS/rede/Tauri). A cola impura (deps reais de `./api` +
// wiring no `conectar`) mora no `remote-signaling.ts`, que o node não testa.

import type { SignedRegistrationV2 } from "./api";

/** Versão do wire v2 (casa com `PROTOCOL_VERSION` do `remote-net`). */
export const PROTOCOL_VERSION_V2 = 2 as const;

/**
 * Timeout curto do probe. Roda EM PARALELO ao v1 (não bloqueia o connect), então
 * este prazo só limita quanto o probe fica pendurado antes de logar o fallback —
 * nunca adiciona latência ao caminho v1.
 */
export const PROBE_V2_TIMEOUT_MS = 4_000;

/** Resultado do probe v2 (o token vira o `<resultado>` da linha de log). */
export type ResultadoV2Tipo =
  | "registrado"
  | "nao-matriculado"
  | "timeout"
  | "erro";

export interface ResultadoV2 {
  tipo: ResultadoV2Tipo;
  /** Linha de log NÃO-silenciosa (ver `mensagemProbeV2`). */
  mensagem: string;
}

/**
 * Envelope v2 do Register, no formato do `Envelope<DeviceRegister>` do
 * `services/remote-net/src/protocol.rs`: `v`/`id`/`type`/`method` + `payload`
 * ANINHADO em camelCase. O `method` é `"device.register"`; o payload é o
 * `DeviceRegister { deviceId, nonce, timestamp, signature }` — repare que a
 * `publicKey` NÃO vai no fio (o server a resolve pelo `deviceId` da matrícula).
 */
export interface EnvelopeRegistroV2 {
  v: typeof PROTOCOL_VERSION_V2;
  id: string;
  type: "request";
  method: "device.register";
  payload: {
    deviceId: string;
    nonce: string;
    timestamp: number;
    signature: string;
  };
}

/**
 * Monta o Envelope v2 do Register a partir da PoP do Rust. Função PURA — é a
 * ÂNCORA do wire: se o formato divergir do `protocol.rs`, o teste quebra. NÃO
 * inclui a `publicKey` no payload (fora do `DeviceRegister`).
 */
export function montarEnvelopeRegistroV2(
  pop: SignedRegistrationV2,
  id: string,
): EnvelopeRegistroV2 {
  return {
    v: PROTOCOL_VERSION_V2,
    id,
    type: "request",
    method: "device.register",
    payload: {
      deviceId: pop.deviceId,
      nonce: pop.nonce,
      timestamp: pop.timestamp,
      signature: pop.signature,
    },
  };
}

/**
 * O ACK do Register v2: `Envelope` com `type="response"`, `method="device.register"`,
 * `v=2` e o MESMO `id` do request (o `worker.rs:77-83` confirma exatamente esses
 * campos). Sem payload de `ice_servers` (isso é #1133). PURA.
 */
export function respostaV2ConfirmaRegistro(env: unknown, idEsperado: string): boolean {
  if (typeof env !== "object" || env === null) return false;
  const e = env as Record<string, unknown>;
  return (
    e.v === PROTOCOL_VERSION_V2 &&
    e.id === idEsperado &&
    e.type === "response" &&
    e.method === "device.register"
  );
}

/**
 * Motivo do fallback pro v1, por resultado do probe. PURA. As frases casam com o
 * conjunto do AC. `registrado` também cai pro v1 HOJE porque o v2 ainda não tem
 * `ice_servers` (#1133) — o único jeito de não ser "verde que não funciona".
 */
export function motivoFallbackV2(tipo: ResultadoV2Tipo): string {
  switch (tipo) {
    case "registrado":
      return "v2 sem ice_servers (#1133)";
    case "nao-matriculado":
      return "device não matriculado";
    case "timeout":
      return "timeout";
    case "erro":
      return "erro";
  }
}

/**
 * Linha de log NÃO-silenciosa do fallback (AC). Diz o resultado E o porquê.
 * NUNCA inclui assinatura/chave/nonce — só o classificador. PURA.
 */
export function mensagemProbeV2(tipo: ResultadoV2Tipo): string {
  return `[remote] v2 register: ${tipo} — usando v1 (motivo: ${motivoFallbackV2(tipo)})`;
}

/** Superfície MÍNIMA de WebSocket que o probe usa (permite fake nos testes). */
export interface WsMinimoV2 {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(dados: string): void;
  close(): void;
}

/**
 * Dependências INJETADAS do probe (sem defaults de `./api` aqui, pra o módulo
 * ficar puro/testável). O `remote-signaling.ts` fornece as reais.
 */
export interface DepsProbeV2 {
  /** Endpoint v2 já resolvido (`/v2/ws`). */
  endpointV2: string;
  /** Pede a PoP ao Rust (`remote_sign_register`). Pode rejeitar → `erro`. */
  obterPoP: () => Promise<SignedRegistrationV2>;
  /** Abre o WS v2. Pode lançar (ex.: URL inválida) → `erro`. */
  abrirWs: (url: string) => WsMinimoV2;
  /** Gera o `id` do Envelope (uuid). */
  gerarId: () => string;
  timeoutMs: number;
}

/**
 * Probe v2: pede a PoP, abre o WS v2, manda o Envelope de Register e AGUARDA (com
 * timeout curto) o ACK. Fecha o WS ao fim (é só probe — não segura conexão) e
 * SEMPRE resolve um `ResultadoV2` — NUNCA rejeita. Essa é a invariante que
 * protege o v1: o chamador dispara isto em paralelo e ignora com segurança.
 *
 *  - ACK válido (`type=response`/`method=device.register`, id certo) → `registrado`
 *    (mas o chamador segue pro v1 porque o v2 não tem ice_servers hoje).
 *  - resposta que não confirma / WS erro / WS fecha antes do ACK / PoP falhou →
 *    `erro`.
 *  - nenhuma resposta dentro do `timeoutMs` → `timeout`.
 *
 * (`nao-matriculado` fica reservado pra quando o server v2 (#1133) emitir um frame
 * de erro estruturado que dê pra distinguir "device não matriculado" de outros
 * erros. Hoje, sem esse frame, uma recusa chega como fecho/erro → `erro`.)
 */
export async function tentarRegistrarV2(deps: DepsProbeV2): Promise<ResultadoV2> {
  const finalizar = (tipo: ResultadoV2Tipo): ResultadoV2 => ({
    tipo,
    mensagem: mensagemProbeV2(tipo),
  });

  let pop: SignedRegistrationV2;
  try {
    pop = await deps.obterPoP();
  } catch {
    // Comando de assinatura indisponível/falhou: v2 fora, v1 segue.
    return finalizar("erro");
  }

  const id = deps.gerarId();
  const envelope = montarEnvelopeRegistroV2(pop, id);

  return await new Promise<ResultadoV2>((resolve) => {
    let ws: WsMinimoV2 | null = null;
    let feito = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const encerrar = (tipo: ResultadoV2Tipo): void => {
      if (feito) return;
      feito = true;
      if (timer != null) clearTimeout(timer);
      const sock = ws;
      ws = null;
      if (sock) {
        // Solta os handlers antes de fechar pro onclose não re-notificar.
        sock.onopen = null;
        sock.onmessage = null;
        sock.onerror = null;
        sock.onclose = null;
        try {
          sock.close();
        } catch {
          /* já fechando: ignora */
        }
      }
      resolve(finalizar(tipo));
    };

    try {
      ws = deps.abrirWs(deps.endpointV2);
    } catch {
      encerrar("erro");
      return;
    }

    timer = setTimeout(() => encerrar("timeout"), deps.timeoutMs);

    ws.onopen = () => {
      try {
        ws?.send(JSON.stringify(envelope));
      } catch {
        encerrar("erro");
      }
    };
    ws.onmessage = (ev) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return; // frame não-JSON: ignora e continua aguardando o ACK/timeout.
      }
      encerrar(respostaV2ConfirmaRegistro(msg, id) ? "registrado" : "erro");
    };
    ws.onerror = () => encerrar("erro");
    ws.onclose = () => encerrar("erro");
  });
}
