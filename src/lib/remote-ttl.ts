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
 * 🔑 **A imunidade a skew é da CONTAGEM, não da MEDIÇÃO — e é importante não
 * trocar as duas** (o comentário original prometia as duas; #1148, achado do
 * @Altair na review da PR #1681):
 *
 * - **Imune:** a contagem depois da chegada. `deveAvisarExpiracao` usa só
 *   `agora − medidoEm`, ambos do relógio do CLIENTE. O gatilho de 1/4 não
 *   escorrega por skew nenhum.
 * - **NÃO imune:** esta medição inicial. `expira` vem de `expiresAtUnixSeconds`,
 *   cunhado pelo SERVIDOR; `agoraSeg` é do cliente. São **dois relógios**, e o
 *   desvio **não se cancela** — entra inteiro no `ttlEfetivo`:
 *   servidor adiantado em S ⇒ `+S` (avisa tarde); cliente adiantado em C ⇒ `−C`
 *   (avisa cedo).
 *
 * ⚠️ **O caso silencioso:** cliente adiantado por ≥ TTL ⇒ `ttlEfetivo ≤ 0` ⇒
 * `deveAvisarExpiracao` devolve `false` para sempre. A funcionalidade
 * **desliga-se sem dizer nada e parece saudável**. Hoje é indistinguível de
 * "não há expiração a vigiar", que é o outro caso que devolve `null`.
 *
 * **A cura de raiz é do servidor** e vale escrita porque o problema volta igual
 * na fatia B (o Rust agenda pela mesma grandeza): se o `Registered` /
 * `IceServersRenewed` trouxesse um **`ttl_seconds`** (duração) além do
 * `expires_at`, a conta passava a ser toda no relógio do cliente e a imunidade
 * seria real das duas pontas. Encosta no #1527.
 *
 * `null` quando nenhum server traz expiração > 0 (nada a vigiar — ex.: só STUN,
 * sem credencial temporária).
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
