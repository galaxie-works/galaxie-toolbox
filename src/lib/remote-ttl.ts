// #1148: lógica pura do relógio de TTL da credencial TURN, FORA do componente
// pra ser testável sem montar a tela nem depender do relógio real.
//
// A dor do card: a sessão *relayed* cai no TTL da credencial sem aviso. A fatia C
// avisa (surfa a queda antes dela); a fatia B+A-2 renova viva. O +retry (desenho
// do @Altair, #1148 comment 6137632496) muda o SENTIDO do aviso: ele deixa de
// acender no último 1/4 do TTL (que coincidia com o disparo da renovação e fazia
// o banner piscar a cada renovação bem-sucedida) e passa a acender só quando a
// renovação está **pendente além da carência** (ou com ≤1/5 restante como piso).
// Assim o aviso significa "a renovação não está a resultar", não "o TTL está
// perto".
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
 * - **Imune:** a contagem depois da chegada. O piso de `deveAvisarExpiracao` usa
 *   só `agora − medidoEm`, e a carência usa só `agora − pendenteDesde` — ambos do
 *   relógio do CLIENTE. Nenhum dos dois escorrega por skew.
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
 * Carência (s): a renovação tem de estar pendente por MAIS do que isto para o
 * aviso acender por via da pendência.
 *
 * #1148 (+retry, desenho do @Altair em #1148 comment 6137632496): no caminho
 * feliz, o disparo da renovação (3/4 decorridos) e o antigo gatilho do aviso
 * (≤1/4 restante) eram o MESMO instante — o banner piscava a cada renovação
 * bem-sucedida. Com a carência, a credencial nova chega antes de o aviso acender,
 * e o aviso passa a significar **"a renovação não está a resultar"**.
 */
export const CARENCIA_RENOVACAO_SEG = 30;

/**
 * Piso duro: fração do TTL efetivo que, quando resta ≤ ela, acende o aviso mesmo
 * sem pendência rastreada (ex.: credencial inicial a morrer sem renovação a
 * decorrer). Abaixo do antigo 1/4 — avisa MAIS TARDE, para o caminho feliz não
 * piscar; a verdade "a renovação não resulta" é o sinal primário (a carência).
 */
const PISO_RESTANTE = 1 / 5;

export interface EstadoAvisoExpiracao {
  /** Horizonte de expiração dos ICE servers (ou `null` — nada a vigiar). */
  horizonte: HorizonteTtl | null;
  /**
   * Instante (relógio do cliente, s) em que a renovação ATUAL passou a pendente,
   * ou `null` se não há renovação pendente. Fica no instante da PRIMEIRA
   * tentativa e **não reinicia** nas retentativas — o backoff do Rust (camada 1,
   * #1148) re-emite `RenewIceNeeded`, e a carência tem de contar desde o início
   * da falha, não desde a última tentativa. Volta a `null` só quando a credencial
   * fresca chega (`onIceServersRenovados`).
   */
  renovacaoPendenteDesdeSeg: number | null;
}

/**
 * Deve acender o aviso? Verdade quando QUALQUER:
 *  (a) **carência**: há renovação pendente há mais que `CARENCIA_RENOVACAO_SEG`
 *      (`agora − pendenteDesde > carência`) — "a renovação não está a resultar";
 *  (b) **piso duro**: resta ≤ `PISO_RESTANTE` do TTL efetivo, para o caso sem
 *      pendência rastreada em que a credencial está mesmo a morrer.
 *
 * Tudo no relógio do cliente (imune a skew na CONTAGEM — ver `horizonteTtl`).
 * Horizonte ausente / `ttlEfetivo ≤ 0` só desliga o piso (b); a carência (a)
 * ainda vale. O gate de "sessão viva" é de quem chama.
 */
export function deveAvisarExpiracao(
  estado: EstadoAvisoExpiracao,
  agoraSeg: number,
): boolean {
  const desde = estado.renovacaoPendenteDesdeSeg;
  if (desde != null && agoraSeg - desde > CARENCIA_RENOVACAO_SEG) return true;
  const horizonte = estado.horizonte;
  if (horizonte == null || horizonte.ttlEfetivoSeg <= 0) return false;
  const decorridoSeg = agoraSeg - horizonte.medidoEmSeg;
  const restanteSeg = horizonte.ttlEfetivoSeg - decorridoSeg;
  return restanteSeg <= horizonte.ttlEfetivoSeg * PISO_RESTANTE;
}
