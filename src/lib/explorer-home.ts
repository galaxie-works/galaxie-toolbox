import type { KnownDir } from "./types.ts";

/**
 * Qual dos diretórios conhecidos é a Home — perguntando pelo NOME, não pela
 * posição.
 *
 * ## Por que esta função existe (#1404)
 *
 * O consumidor lia `dirsConhecidos[0]` como home. O lado Rust monta essa lista
 * com dois filtros silenciosos (descarta o que não resolve e o que não existe),
 * então o índice `0` só era a home *enquanto* a home resolvesse. Com perfil de
 * rede indisponível, permissão negada ou `$HOME` ausente, o primeiro item
 * passava a ser a Área de Trabalho — e a UI a rotulava "Home", sem erro, sem
 * log, sem sintoma. Errado em silêncio numa condição alcançável.
 *
 * O segundo modo era ainda mais barato de disparar: acrescentar um diretório no
 * começo do array do Rust, uma linha, mudava o que a UI chama de Home.
 *
 * Devolver `null` quando não há home é o comportamento correto e já tratado a
 * jusante (`homePath !== null`): **degrada em vez de mentir**.
 */
export function caminhoDaHome(dirs: readonly KnownDir[] | null | undefined): string | null {
  return dirs?.find((d) => d.kind === "home")?.path ?? null;
}
