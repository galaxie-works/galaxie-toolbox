// #687 (Remote S4-UI): fachada TS do wiring `Galaxie.Remote.App.v1` (congelado,
// #809/Orion). Só tipos + wrappers de `invoke`/`Channel` — a máquina de estado da
// sessão, o render de vídeo (WebCodecs) e a captura de input ficam na tela.
//
// Contrato (espelha `src-tauri/src/remote.rs` + `remote-transport::InputEvent`):
//  - commands: remote_session_start(req, onEvent, onVideo)/signal/input/end;
//  - onEvent  = Channel JSON RemoteSessionEvent (state|signal|screen|stats);
//  - onVideo  = Channel raw: header 17 bytes (v1 | u64 tsUs LE | u64 flags LE,
//               bit0=keyframe) + access unit H.264 Annex-B (controller-only);
//  - RemoteSignal {kind, payload} pra a ponte de signaling (S0);
//  - InputEvent normalizado 0..1 (só controller, capability input).
import { Channel, invoke } from "@tauri-apps/api/core";

const TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- Tipos do contrato (camelCase, como o serde do Rust expõe) --------------

export type RemoteRole = "host" | "controller";

export type RemoteSessionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

export interface IceServer {
  urls: string[];
  username?: string | null;
  credential?: string | null;
}

export interface RemoteSignalingBinding {
  endpoint: string;
  peerId: string;
}

export interface RemoteCapabilities {
  screen: boolean;
  input: boolean;
}

export interface RemoteSessionStartRequest {
  role: RemoteRole;
  sessionId: string;
  signaling: RemoteSignalingBinding;
  iceServers?: IceServer[];
  capabilities: RemoteCapabilities;
}

export interface RemoteSessionStartResponse {
  sessionId: string;
  state: RemoteSessionState;
}

/** SDP/ICE trocado pela ponte de signaling (S0). `payload` = SDP ou candidate. */
export interface RemoteSignal {
  kind: "offer" | "answer" | "ice_candidate";
  payload: string;
}

/** Geometria da tela do host (pro controlador escalar o vídeo + mapear input). */
export interface ScreenInfo {
  originX: number;
  originY: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

/** Eventos JSON da sessão (`onEvent`), discriminados por `type`. */
export type RemoteSessionEvent =
  | { type: "state"; state: RemoteSessionState; code?: string; message?: string }
  | { type: "signal"; signal: RemoteSignal }
  | { type: "screen"; info: ScreenInfo }
  | { type: "stats"; rttMs?: number | null; bitrateBps: number; frames: number };

// --- Input (remote-transport::InputEvent) — controller → host ---------------

export type BotaoMouse = "left" | "right" | "middle";

/** Tecla: caractere OU nomeada (tag `k`). Modificadores são teclas próprias. */
export type Tecla =
  | { k: "char"; c: string }
  | { k: "enter" }
  | { k: "backspace" }
  | { k: "tab" }
  | { k: "escape" }
  | { k: "space" }
  | { k: "delete" }
  | { k: "left" }
  | { k: "right" }
  | { k: "up" }
  | { k: "down" }
  | { k: "home" }
  | { k: "end" }
  | { k: "pageUp" }
  | { k: "pageDown" }
  | { k: "shift" }
  | { k: "control" }
  | { k: "alt" }
  | { k: "meta" }
  | { k: "f"; n: number };

/** Evento de input (tag `e`). down/up SEMPRE explícitos (`pressed`), nunca inferido. */
export type InputEvent =
  | { e: "mouseMove"; x: number; y: number } // coord NORMALIZADA 0..1
  | { e: "mouseButton"; botao: BotaoMouse; pressed: boolean }
  | { e: "mouseScroll"; dx: number; dy: number }
  | { e: "key"; tecla: Tecla; pressed: boolean }
  | { e: "screen"; info: ScreenInfo };

// --- Vídeo raw (onVideo): header versionado + Annex-B -----------------------

export const VIDEO_HEADER_BYTES = 17;

export interface QuadroVideo {
  /** Timestamp de apresentação em microssegundos (do header). */
  timestampUs: number;
  /** true = keyframe (bit0 das flags) — configura/reinicia o decoder. */
  keyframe: boolean;
  /** Access unit H.264 Annex-B (sem o header de 17 bytes). */
  annexB: Uint8Array;
}

/**
 * Decodifica o quadro raw do canal de vídeo: header de 17 bytes (u8 version=1 |
 * u64 timestampUs LE | u64 flags LE, bit0=keyframe) + Annex-B. Retorna `null` se
 * a versão do header for desconhecida ou o buffer for curto demais.
 */
export function parseQuadroVideo(buf: Uint8Array): QuadroVideo | null {
  if (buf.byteLength < VIDEO_HEADER_BYTES) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint8(0);
  if (version !== 1) return null;
  const timestampUs = Number(view.getBigUint64(1, true));
  const flags = view.getBigUint64(9, true);
  const keyframe = (flags & 1n) === 1n;
  const annexB = buf.subarray(VIDEO_HEADER_BYTES);
  return { timestampUs, keyframe, annexB };
}

// --- Wrappers dos commands --------------------------------------------------

/**
 * Inicia (ou entra n)a sessão remota. `onEvent` recebe os eventos JSON; `onVideo`
 * (só controller) recebe cada access unit H.264 raw (header+Annex-B) — passe pro
 * `parseQuadroVideo`. Uma sessão ativa por vez; início duplicado = conflito.
 */
export async function iniciarSessaoRemota(
  req: RemoteSessionStartRequest,
  onEvent: (ev: RemoteSessionEvent) => void,
  onVideo?: (buf: Uint8Array) => void,
): Promise<RemoteSessionStartResponse> {
  if (!TAURI) {
    return { sessionId: req.sessionId, state: "error" };
  }
  const canalEvento = new Channel<RemoteSessionEvent>();
  canalEvento.onmessage = onEvent;
  const canalVideo = new Channel<ArrayBuffer>();
  canalVideo.onmessage = (buf) => onVideo?.(new Uint8Array(buf));
  return invoke<RemoteSessionStartResponse>("remote_session_start", {
    request: req,
    onEvent: canalEvento,
    onVideo: canalVideo,
  });
}

/** Encaminha um signal (SDP/ICE) recebido pela ponte de signaling (S0). */
export async function sinalizarSessao(
  sessionId: string,
  signal: RemoteSignal,
): Promise<void> {
  if (!TAURI) return;
  // #1071 (RB2): o comando Rust recebe um único parâmetro `request` — o payload
  // TEM que vir aninhado (`{ request: {...} }`), igual ao remote_session_start.
  // Enviar achatado (`{ sessionId, signal }`) dá erro de desserialização no Tauri
  // v2 e a sessão nunca sai de "connecting".
  return invoke<void>("remote_session_signal", { request: { sessionId, signal } });
}

/** Envia um evento de input (só controller, capability input ativa). */
export async function enviarInput(
  sessionId: string,
  event: InputEvent,
): Promise<void> {
  if (!TAURI) return;
  // #1071 (RB2): payload aninhado em `request` (ver sinalizarSessao).
  return invoke<void>("remote_session_input", { request: { sessionId, event } });
}

/** Encerra a sessão (idempotente): fecha transporte/canais e solta input preso. */
export async function encerrarSessao(
  sessionId: string,
  reason = "requested",
): Promise<void> {
  if (!TAURI) return;
  // #1071 (RB2): payload aninhado em `request` (ver sinalizarSessao).
  return invoke<void>("remote_session_end", { request: { sessionId, reason } });
}
