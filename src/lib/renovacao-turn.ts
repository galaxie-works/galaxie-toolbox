// Política de renovação da credencial TURN (#1148, correção do @Altair no card).
//
// ── Por que isto é um módulo puro, e não um `setTimeout` dentro da tela ────
// O que decide QUANDO renovar é aritmética sobre um campo do servidor. Deixar
// essa aritmética dentro do componente a torna testável só com relógio real e
// PeerConnection de verdade — e o DoD exige justamente o contrário: prova com o
// **relógio adiantado**. Módulo puro é a mesma função que a tela usa e que o
// teste exercita, sem versão "de teste" que possa divergir.
//
// ── A regra, e a razão de cada número ──────────────────────────────────────
// O gatilho é **3/4 do tempo restante da credencial**, calculado a partir do
// `expires_at_unix_seconds` que vem no `Registered`/`IceServersRenewed` — e
// **nunca** de uma constante no cliente.
//
// Isso não é preciosismo. O TTL vive no `config.rs` do signaling e já mudou uma
// vez (3600 → 1800, PR #1146). Uma constante `1800` aqui seria um número que
// duplica uma verdade do outro lado e envelhece **em silêncio**: no dia em que o
// servidor baixar o TTL, o cliente agenda tarde e a sessão cai — sem nada
// acusando, porque o código "tem renovação".
//
// O 1/4 restante é a margem: se a renovação falhar, ainda há um quarto do TTL
// com a credencial velha de pé para avisar o usuário e tentar de novo. Avisar
// depois de expirar é comunicar um fato consumado.

/** Um instante em segundos Unix — a mesma unidade do `expires_at_unix_seconds`. */
export type Segundos = number;

/**
 * Quanto falta, em MILISSEGUNDOS, para o momento de renovar.
 *
 * Devolve `0` quando o momento já passou (renovar agora) e `null` quando não há
 * o que agendar — credencial sem expiração declarada (`0`, que é o default do
 * `mapearIceServers` quando o servidor omite) ou já expirada.
 *
 * O `null` é deliberadamente distinto do `0`: "não sei quando expira" e "expira
 * agora" pedem reações diferentes de quem chama, e colapsá-los faria o
 * agendador disparar em loop contra uma credencial sem prazo.
 */
export function faltaParaRenovar(
  expiraEmSegundos: Segundos,
  agoraSegundos: Segundos,
): number | null {
  // `0` é o valor que o cliente usa quando o servidor não declarou expiração
  // (ver `mapearIceServers`). Sem prazo não há 3/4 de coisa nenhuma.
  if (!Number.isFinite(expiraEmSegundos) || expiraEmSegundos <= 0) return null;
  if (!Number.isFinite(agoraSegundos)) return null;

  const restante = expiraEmSegundos - agoraSegundos;
  if (restante <= 0) return null; // já expirou: renovar não salva esta sessão

  // 3/4 do restante — o instante do gatilho, não a duração da espera.
  const espera = restante * 0.75;
  return Math.max(0, Math.round(espera * 1000));
}

/**
 * Já passou do ponto em que o usuário precisa ser avisado?
 *
 * O aviso é devido quando resta **≤ 1/4** do tempo original da credencial e a
 * renovação ainda não veio. Nesse ponto a credencial velha ainda está de pé —
 * que é justamente o que dá ao usuário chance de fazer algo.
 */
export function devoAvisar(
  expiraEmSegundos: Segundos,
  agoraSegundos: Segundos,
  ttlOriginalSegundos: Segundos,
): boolean {
  if (!Number.isFinite(expiraEmSegundos) || expiraEmSegundos <= 0) return false;
  if (!Number.isFinite(ttlOriginalSegundos) || ttlOriginalSegundos <= 0) {
    return false;
  }
  const restante = expiraEmSegundos - agoraSegundos;
  if (restante <= 0) return true; // expirou sem renovar: avisar é o mínimo
  return restante <= ttlOriginalSegundos * 0.25;
}
