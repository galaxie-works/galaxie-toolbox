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
