// #687 (Remote S4-UI): client de signaling S0 — tipos do protocolo WS + a
// interface `SinalizadorS0` que a RemoteScreen consome. Espelha
// `services/remote-signaling/src/protocol.rs` (WebSocket, JSON, tag `type`,
// snake_case). O matchmaking código↔peerId é do FRONT (o `remote_session_start`
// do wiring recebe `signaling{endpoint,peerId}` JÁ resolvido).
//
// A implementação concreta (WS + keypair de device pra o Register/attestation +
// endpoint do S0) fica em `criarSinalizadorWs` — pendente do algo de key + a URL
// do S0 (perguntado ao Confucius na #133). A tela pendura na INTERFACE, então já
// dá pra montar/testar a UI com um sinalizador fake.

import { remoteSignalingEndpoint } from "./api";

/** SDP/ICE kind (igual ao `RemoteSignal.kind` do wiring). */
export type SignalKind = "offer" | "answer" | "ice_candidate";

/** ICE server (STUN/TURN do coturn) — vem no `registered` do S0. */
export interface IceServer {
  urls: string[];
  username: string;
  credential: string;
  expiresAtUnixSeconds: number;
}

/** Assinatura do server sobre a pubkey do device (anti-spoof). */
export interface KeyAttestation {
  algorithm: string;
  deviceId: string;
  peerPublicKey: string;
  issuedAtUnixSeconds: number;
  serverPublicKey: string;
  signature: string;
}

/** Códigos de erro do S0 (o `invalid_code`/`code_expired`/`peer_offline` viram
 *  o `t.remote.codigoInvalido` na tela). */
export type ErrorCodeS0 =
  | "invalid_frame"
  | "invalid_device_id"
  | "invalid_public_key"
  | "not_registered"
  | "device_replaced"
  | "invalid_code"
  | "code_expired"
  | "peer_offline"
  | "not_paired"
  | "rate_limited"
  | "payload_too_large"
  | "internal";

/** Mensagens que o CLIENT envia (tag `type`, snake_case). */
export type ClientMessage =
  | { type: "register"; device_id: string; public_key: string }
  | { type: "heartbeat" }
  | { type: "presence"; device_id: string }
  | { type: "create_assisted_session"; ttl_seconds?: number }
  | { type: "redeem_assisted_session"; code: string }
  | { type: "signal"; peer_id: string; kind: SignalKind; payload: string };

/** Mensagens que o SERVER envia (tag `type`, snake_case). */
export type ServerMessage =
  | {
      type: "registered";
      protocol_version: number;
      device_id: string;
      attestation: KeyAttestation;
      ice_servers: IceServer[];
    }
  | { type: "pong"; unix_seconds: number }
  | { type: "presence"; device_id: string; online: boolean }
  | { type: "assisted_session_code"; code: string; expires_at_unix_seconds: number }
  | { type: "session_paired"; peer_id: string }
  | { type: "signal"; peer_id: string; kind: SignalKind; payload: string }
  | { type: "error"; code: ErrorCodeS0; message: string };

/** Um signal (SDP/ICE) já no formato do wiring/`remote.ts`. */
export interface Sinal {
  kind: SignalKind;
  payload: string;
}

/** Callbacks que a RemoteScreen registra no sinalizador. */
export interface SinalizadorHandlers {
  /** Host: o código de sessão a exibir (com expiração). */
  onCodigo?: (code: string, expiraEmUnixSegundos: number) => void;
  /** Ambos: o peer foi pareado — dispara o `remote_session_start`. */
  onPareado: (peerId: string) => void;
  /** Relay: um signal chegou do peer (encaminhe pro `remote_session_signal`). */
  onSinal: (peerId: string, sinal: Sinal) => void;
  /** Erro do S0 (código inválido/expirado/peer offline/etc.). */
  onErro: (code: ErrorCodeS0, message: string) => void;
  /** Conexão do WS caiu. */
  onFechado?: () => void;
}

/**
 * Interface do client de signaling S0 que a RemoteScreen consome. Abstrai o WS +
 * o keypair de device, pra a tela ser montável/testável com um fake.
 */
export interface SinalizadorS0 {
  /** Abre o WS + faz o Register; resolve com os ICE servers do `registered`. */
  conectar(handlers: SinalizadorHandlers): Promise<{ iceServers: IceServer[] }>;
  /** Host: pede um código de sessão assistida (dispara `onCodigo`). */
  criarSessao(ttlSegundos?: number): void;
  /** Controller: resgata um código (dispara `onPareado` ou `onErro`). */
  resgatarSessao(code: string): void;
  /** Encaminha um signal (SDP/ICE) pro peer pareado. */
  enviarSinal(peerId: string, sinal: Sinal): void;
  /** Fecha o WS. */
  fechar(): void;
}

// --- Implementação concreta (WS + keypair de device) ------------------------

/** Intervalo do heartbeat (mantém o WS vivo através de proxies/NAT). */
const HEARTBEAT_MS = 20_000;

/**
 * Endpoint do S0. #1104 (fecha TODO(#687)): vem do backend via comando Tauri
 * (`remote_signaling_endpoint`, no padrão da telemetria — runtime env > baked >
 * default de PROD `telemetry.thegalaxie.cloud`) em vez de string fixa, pra o
 * ambiente (dev/prod) mandar a URL sem recompilar. Fora do Tauri cai no default
 * de PROD; nunca mais o placeholder `.example` (que falhava DNS → `ws.onerror`).
 */
export async function endpointSignaling(): Promise<string> {
  return remoteSignalingEndpoint();
}

/** ICE server como chega no fio (o campo de expiração vem em snake_case). */
interface IceServerBruto {
  urls: string[];
  username?: string;
  credential?: string;
  expires_at_unix_seconds?: number;
}

/** Mapeia o ICE server do fio (snake_case) pro tipo camelCase do front. */
function mapearIceServers(brutos: IceServerBruto[] | undefined): IceServer[] {
  if (!Array.isArray(brutos)) return [];
  return brutos.map((s) => ({
    urls: Array.isArray(s.urls) ? s.urls : [],
    username: s.username ?? "",
    credential: s.credential ?? "",
    expiresAtUnixSeconds: s.expires_at_unix_seconds ?? 0,
  }));
}

/** Uint8Array → base64 STANDARD (com padding), pra a `public_key` do Register. */
function base64Padrao(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Gera o par de chaves Ed25519 do device e exporta a pubkey (raw 32 bytes →
 * base64 standard). Lança se o WebCrypto do runtime não expõe Ed25519.
 *
 * TODO(#687): fallback pra `@noble/ed25519` quando o WebView não tiver Ed25519
 * nativo (Chromium < 137 / WebView2 antigo). NÃO adicionar a dep agora — só
 * degradar com mensagem clara; o Wagner decide a dep no review.
 */
async function gerarPublicKey(): Promise<string> {
  const par = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", par.publicKey);
  return base64Padrao(new Uint8Array(raw));
}

/**
 * Client de signaling S0 concreto (WebSocket). Faz o Register (device_id +
 * pubkey Ed25519), resolve o `conectar` com os ICE servers do `registered`,
 * despacha as `ServerMessage` pros handlers e mantém o heartbeat. O matchmaking
 * código↔peer é do S0; aqui só encaminhamos create/redeem/signal.
 */
export function criarSinalizadorWs(endpoint: string): SinalizadorS0 {
  let ws: WebSocket | null = null;
  let handlers: SinalizadorHandlers | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  // `conectar` fica pendente até o `registered` (resolve) ou um erro/fecho antes
  // dele (reject). Depois de resolvido, vira no-op.
  let resolverConexao:
    | ((valor: { iceServers: IceServer[] }) => void)
    | null = null;
  let rejeitarConexao: ((erro: Error) => void) | null = null;

  function enviar(msg: ClientMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function pararHeartbeat(): void {
    if (heartbeat != null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function tratarMensagem(msg: ServerMessage): void {
    switch (msg.type) {
      case "registered": {
        const iceServers = mapearIceServers(
          msg.ice_servers as unknown as IceServerBruto[],
        );
        resolverConexao?.({ iceServers });
        resolverConexao = null;
        rejeitarConexao = null;
        // Só liga o heartbeat depois de registrado (antes disso o server ainda
        // não conta a conexão como viva).
        pararHeartbeat();
        heartbeat = setInterval(
          () => enviar({ type: "heartbeat" }),
          HEARTBEAT_MS,
        );
        break;
      }
      case "assisted_session_code":
        handlers?.onCodigo?.(msg.code, msg.expires_at_unix_seconds);
        break;
      case "session_paired":
        handlers?.onPareado(msg.peer_id);
        break;
      case "signal":
        handlers?.onSinal(msg.peer_id, {
          kind: msg.kind,
          payload: msg.payload,
        });
        break;
      case "error":
        // Erro ANTES do registered = falha do handshake → rejeita o `conectar`.
        if (rejeitarConexao) {
          rejeitarConexao(new Error(`${msg.code}: ${msg.message}`));
          resolverConexao = null;
          rejeitarConexao = null;
        }
        handlers?.onErro(msg.code, msg.message);
        break;
      // pong/presence: sem efeito na UI da sessão assistida (MVP).
      default:
        break;
    }
  }

  return {
    conectar(h) {
      handlers = h;
      return new Promise<{ iceServers: IceServer[] }>((resolve, reject) => {
        resolverConexao = resolve;
        rejeitarConexao = reject;
        void (async () => {
          let publicKey: string;
          try {
            publicKey = await gerarPublicKey();
          } catch (e) {
            resolverConexao = null;
            rejeitarConexao = null;
            reject(
              new Error(
                "Ed25519 indisponível neste ambiente (WebCrypto). " +
                  String(e),
              ),
            );
            return;
          }
          // device_id = 32 hex (casa com o [A-Za-z0-9_-]{8,64} do protocolo).
          const deviceId = crypto.randomUUID().replace(/-/g, "");
          try {
            ws = new WebSocket(endpoint);
          } catch (e) {
            resolverConexao = null;
            rejeitarConexao = null;
            reject(new Error("Falha ao abrir o WebSocket: " + String(e)));
            return;
          }
          ws.onopen = () => {
            enviar({
              type: "register",
              device_id: deviceId,
              public_key: publicKey,
            });
          };
          ws.onmessage = (ev) => {
            let msg: ServerMessage;
            try {
              msg = JSON.parse(String(ev.data)) as ServerMessage;
            } catch {
              return; // frame não-JSON: ignora (invalid_frame é do server)
            }
            tratarMensagem(msg);
          };
          ws.onerror = () => {
            if (rejeitarConexao) {
              // #1104 (AC3): o erro diz QUAL endpoint falhou, pra diagnosticar
              // placeholder/DNS/serviço fora do ar sem adivinhar.
              rejeitarConexao(
                new Error(`Erro no WebSocket de signaling (${endpoint})`),
              );
              resolverConexao = null;
              rejeitarConexao = null;
            }
          };
          ws.onclose = () => {
            pararHeartbeat();
            if (rejeitarConexao) {
              rejeitarConexao(
                new Error("WebSocket de signaling fechou antes do registro"),
              );
              resolverConexao = null;
              rejeitarConexao = null;
            }
            handlers?.onFechado?.();
          };
        })();
      });
    },
    criarSessao(ttlSegundos) {
      enviar({
        type: "create_assisted_session",
        ttl_seconds: ttlSegundos,
      });
    },
    resgatarSessao(code) {
      enviar({ type: "redeem_assisted_session", code });
    },
    enviarSinal(peerId, sinal) {
      enviar({
        type: "signal",
        peer_id: peerId,
        kind: sinal.kind,
        payload: sinal.payload,
      });
    },
    fechar() {
      pararHeartbeat();
      resolverConexao = null;
      rejeitarConexao = null;
      handlers = null;
      const sock = ws;
      ws = null;
      if (sock) {
        // Solta os handlers antes de fechar pra o onclose não re-notificar.
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
    },
  };
}
