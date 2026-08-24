// Porta única de rede do app web da plataforma (#1490).
//
// ── Por que uma porta, e não `fetch` espalhado ─────────────────────────────
// O delta do Altair no #1475/#1473 é uma regra de ARQUITETURA, não de tela:
// **o escopo vem da sessão, nunca do cliente.** Recursos de conta e de org são
// endereçados por `/me/...`; o cliente nunca monta `/orgs/<id>/...` nem
// `/users/<id>/...`, porque um caminho desses convida o backend a confiar num
// id que veio de fora. (Conta/org alheia responde 404 — não 403 — pra não
// enumerar; isso é responsabilidade do BE, mas só funciona se o cliente
// também não tentar.)
//
// Espalhar `fetch` por N telas transforma essa regra numa combinação de N
// acertos independentes. Concentrar numa porta transforma a regra numa
// asserção só — que é o que a guarda de `src/lib/pollux-1490-tenancy-fe.test.ts`
// (canal que BARRA merge) pina na fonte.
//
// IMPORTANTE: esta porta NÃO autoriza nada. Ela recusa um caminho mal-formado
// antes de sair da máquina do usuário; quem decide acesso é o backend
// (default-deny, #1469). Esconder botão e recusar caminho são conforto e
// higiene — autorização é server-side.

// Prefixo dos recursos escopados à sessão. Ver #1473 (delta do Altair).
//
// NÃO é exportado de propósito: nada fora daqui precisa dele, e export sem
// consumidor é código morto que o ratchet do #1421 cobra — com razão. A lista
// SIMÉTRICA (prefixos que endereçam inquilino por id) vive na guarda de fonte,
// em `src/lib/pollux-1490-tenancy-fe.test.ts`, porque é lá que ela é usada: a
// porta trabalha por lista-de-permissão em runtime, a guarda por
// lista-de-proibição na fonte. São dois mecanismos diferentes contra o mesmo
// defeito, e a raiz não pode importar de `web/` (o `tsc -b` da raiz não a
// inclui) — então a constante não é compartilhável, e fingir que era só criaria
// um elo falso.
const PREFIXO_SESSAO = "/me";

export class CaminhoNaoEscopado extends Error {
  constructor(caminho: string) {
    super(
      `Caminho "${caminho}" não é escopado à sessão. Recursos de conta/org ` +
        `usam "${PREFIXO_SESSAO}/..."; endereçar inquilino por id vindo do ` +
        `cliente é vazamento de tenancy (#1490, delta do Altair no #1475).`,
    );
    this.name = "CaminhoNaoEscopado";
  }
}

/**
 * Decide se um caminho respeita o escopo da sessão.
 *
 * Módulo puro de propósito: é a mesma função que a tela usa e que o teste
 * exercita, então não existe versão "de teste" que possa divergir da de
 * produção.
 */
export function ehEscopadoNaSessao(caminho: string): boolean {
  if (!caminho.startsWith("/")) return false;
  if (caminho.startsWith(`${PREFIXO_SESSAO}/`) || caminho === PREFIXO_SESSAO) {
    return true;
  }
  return false;
}

/**
 * Única saída de rede do app web. Recusa caminho não-escopado ANTES de chamar.
 *
 * O `credentials: "include"` existe porque a sessão é cookie HttpOnly conjunto
 * com a fundação #1469 (restrição que o Altair registrou no #1484): a SPA e a
 * API vivem na mesma origem via Traefik, então o cookie viaja sozinho e o
 * cliente nunca manuseia o token.
 */
export async function chamar(
  caminho: string,
  init?: RequestInit,
): Promise<Response> {
  if (!ehEscopadoNaSessao(caminho)) throw new CaminhoNaoEscopado(caminho);
  return fetch(caminho, { credentials: "include", ...init });
}
