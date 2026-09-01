// #1148 (fatia B): a conversão FE→Rust da credencial TURN, FORA dos módulos que
// importam Tauri (`remote.ts`/`remote-signaling.ts`) pra ser testável sob
// `node --test` sem carregar o runtime do Tauri. O `ttl_seconds` aqui é
// LOAD-BEARING (ver `renovarIceServersSessao`): dropá-lo desarma o relógio de
// reemissão do Rust em silêncio.

/**
 * Shape do `transport::IceServer` (o lado Rust do handback `remote_session_renew_ice`)
 * — snake_case, com o `ttl_seconds` (DURAÇÃO, skew-imune).
 */
export interface IceServerTransporte {
  urls: string[];
  username: string;
  credential: string;
  ttl_seconds: number;
}

/** O subconjunto do `IceServer` do signaling que o handback precisa. */
interface IceServerComTtl {
  urls: string[];
  username: string;
  credential: string;
  ttlSeconds: number;
}

/**
 * Converte o `IceServer` do signaling (camelCase, com `ttlSeconds`) pra shape do
 * `transport::IceServer` do Rust (snake_case `ttl_seconds`).
 *
 * ⚠️ O `ttl_seconds` é **load-bearing**: o Rust rearma `reemitir_em` com ele; se
 * cair em ausente/0, o relógio desarma e a 2ª reemissão nunca acontece (o
 * auto-desligar silencioso do #1527). Por isso a conversão é explícita e testada.
 */
export function iceServersParaTransporte(
  iceServers: readonly IceServerComTtl[],
): IceServerTransporte[] {
  return iceServers.map((s) => ({
    urls: s.urls,
    username: s.username,
    credential: s.credential,
    ttl_seconds: s.ttlSeconds,
  }));
}
