// #1148 (fatia C): lógica pura do relógio de TTL da credencial TURN, FORA do
// componente pra ser testável sem montar a tela nem depender do relógio real.
//
// A dor do card: a sessão *relayed* cai no TTL da credencial sem aviso. Esta
// fatia SÓ avisa (surfa a queda antes dela). A renovação viva — re-aplicar a
// credencial fresca no transporte str0m — é a fatia B, que pende do seam do
// #1527/relay; por isso aqui não há "renovar", só o horizonte e o gatilho.
import type { IceServer } from "./remote-signaling";

export interface HorizonteTtl {
  /** Instante em que os ICE servers chegaram, pelo relógio do CLIENTE. */
  medidoEmSeg: number;
  /** TTL efetivo na chegada = `expira − agora`, também pelo relógio do cliente. */
  ttlEfetivoSeg: number;
}

/**
 * Horizonte de expiração dos ICE servers no instante em que chegam.
 *
 * 🔑 **Imunidade a skew:** guardamos o TTL como uma DURAÇÃO medida no relógio do
 * cliente (`expira − agora`, ambos os termos comparados AGORA) e o instante de
 * chegada (cliente). A decisão (`deveAvisarExpiracao`) usa só diferenças de
 * tempo do cliente — nunca compara um `expiresAt` cunhado pelo servidor com o
 * relógio do cliente. Um relógio de servidor adiantado/atrasado desloca `expira`
 * e `agora` por igual na subtração, então a duração sai correta e o gatilho de
 * 1/4 não escorrega. `null` quando nenhum server traz expiração > 0 (nada a
 * vigiar — ex.: só STUN, sem credencial temporária).
 */
export function horizonteTtl(
  iceServers: readonly IceServer[],
  agoraSeg: number,
): HorizonteTtl | null {
  const expiras = iceServers
    .map((s) => s.expiresAtUnixSeconds)
    .filter((e) => e > 0);
  if (expiras.length === 0) return null;
  const expira = Math.min(...expiras); // o primeiro a morrer manda
  return { medidoEmSeg: agoraSeg, ttlEfetivoSeg: Math.max(0, expira - agoraSeg) };
}

/**
 * Deve acender o aviso? Verdade quando resta ≤ 1/4 do TTL efetivo.
 *
 * Tudo no relógio do cliente: `restante = ttlEfetivo − (agora − medidoEm)`.
 * Horizonte ausente ou `ttlEfetivo ≤ 0` (credencial que já chegou sem futuro)
 * NÃO avisa — não há janela a anunciar. O gate de "sessão viva" é de quem chama.
 */
export function deveAvisarExpiracao(
  horizonte: HorizonteTtl | null,
  agoraSeg: number,
): boolean {
  if (horizonte == null || horizonte.ttlEfetivoSeg <= 0) return false;
  const decorridoSeg = agoraSeg - horizonte.medidoEmSeg;
  const restanteSeg = horizonte.ttlEfetivoSeg - decorridoSeg;
  return restanteSeg <= horizonte.ttlEfetivoSeg / 4;
}
