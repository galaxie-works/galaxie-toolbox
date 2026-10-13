// Sinal de login falhado vindo do callback OAuth — contrato da borda (#1734, Alcor;
// desenho aprovado pelo @Altair). Toda falha do `/callback` redireciona pra
// `/?login=falhou`: valor ÚNICO, o mesmo pra todas as causas (inclusive "cancelei
// no provedor"); o sucesso continua em `/`.
//
// As 2 condições do @Altair que moram no FE:
//  1. só a PRESENÇA do sinal conta e a tela mostra uma string FIXA do i18n —
//     NADA da query é renderizado (qualquer pessoa monta esse link);
//  2. o parâmetro sai da URL (`history.replaceState`) logo depois de lido.
//
// Módulo `.ts` puro (não `.tsx`) pra ser testável e não esbarrar no
// `react-refresh/only-export-components`.

/** O parâmetro e o valor do contrato. Comparação exata — `FALHOU`, `ok` etc. não contam. */
const PARAM = "login";
const VALOR = "falhou";

/** A busca canônica do sinal, pra quem precisa repassá-lo (ex.: a rota `/`). */
export const BUSCA_LOGIN_FALHOU = `?${PARAM}=${VALOR}`;

/** `true` sse a query string traz exatamente `login=falhou`. */
export function lerLoginFalhou(search: string): boolean {
  return new URLSearchParams(search).get(PARAM) === VALOR;
}

/** O caminho+query+hash de `href` sem o parâmetro `login` — o que vai pro `replaceState`. */
export function semLoginFalhou(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
