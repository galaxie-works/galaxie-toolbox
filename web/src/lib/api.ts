// Porta única de rede do app web da plataforma (#1490).
//
// ── Por que uma porta, e não `fetch` espalhado ─────────────────────────────
// Concentrar a saída de rede num ponto transforma um invariante que dependeria
// de N acertos independentes numa asserção só. É por isso que o `http.ts` do
// #1491 e o `api-me.ts` do #1489 passam por aqui em vez de chamar `fetch`.
//
// ── O que esta porta guarda, e o que ela NÃO pode guardar ──────────────────
// A 1ª versão (#1490 fatia 1) exigia que TODO caminho começasse com `/me`,
// derivando isso da regra do @Altair "nada endereçável por id vindo do
// cliente". **Estava errado**, e o contrato aprovado (#1503, `3dac7a5`) mostrou
// por quê: aquela regra foi escrita sobre CONTA — onde o "eu" É a sessão — e eu
// a generalizei pro app inteiro. O contrato põe admin sob `/orgs/{org}` e
// back-office sob `/admin/orgs/{org}`, com `{org}` conferido contra a sessão no
// backend (org alheia ⇒ 404). Minha guarda teria reprovado o desenho aprovado,
// e quem implementasse ia afrouxá-la — a erosão que eu queria evitar, comigo de
// causa.
//
// O invariante de verdade — **o id na URL não CONCEDE escopo, é conferido** —
// é do servidor, e o cliente não consegue prová-lo. O que o cliente pode
// garantir, e é o que esta porta faz:
//
//   1. **Nenhuma rota que o contrato não declare.** A allowlist abaixo é a
//      tabela do `docs/plataforma/contrato-http-v1.md`. Rota inventada morre
//      aqui — e teria matado o meu próprio `/me/org/membros`, que eu escrevi
//      quando não havia contrato (o @Altair previu: "FE sem contrato escrito
//      INVENTA o contrato").
//   2. **Ninguém sai pela rede fora daqui** (guarda de fonte, canal que barra).
//   3. **O prefixo `/api/v1` num lugar só**, depois da checagem.
//
// A guarda em `src/lib/pollux-1490-contrato-fe.test.ts` amarra a lista abaixo
// ao doc: se divergirem, o gate reprova. Ela DERIVA do doc em vez de repetir a
// lista — lista digitada duas vezes diverge na primeira pressa.

/** Prefixo de toda rota do contrato (§ "Prefixo: `/api/v1`"). */
const PREFIXO_API = "/api/v1";

/**
 * Superfícies declaradas no contrato v1. `{x}` casa UM segmento não-vazio.
 *
 * Ordem e forma seguem o doc para a guarda de fonte poder comparar sem
 * heurística. Acrescentar aqui sem acrescentar no doc reprova no gate.
 */
// NÃO exportada: nada fora daqui a importa — a guarda de fonte a lê como TEXTO
// (a raiz não pode importar de `web/`). Export sem consumidor é o que o ratchet
// do #1421 cobra, e ele me cobrou isto na primeira rodada.
const SUPERFICIES = [
  "/session",
  // `/session/{provedor}` NÃO entra: o contrato não a declara. Eu a escrevi
  // aqui de cabeça, a partir de uma mensagem, minutos depois de dizer que não
  // inventaria rota — e esta guarda me pegou na primeira execução. O redirect
  // de login do #1484 aponta pra lá, mas por `location.assign`, que não passa
  // por esta porta; e o shape do login está marcado "decisão pendente (§2)" no
  // próprio contrato. Quando o modelo de auth fechar, a rota entra no DOC
  // primeiro e aqui depois.
  "/me",
  "/me/orgs",
  "/me/assinatura",
  "/me/config",
  "/me/dispositivos",
  "/me/dispositivos/{id}",
  "/orgs/{org}/membros",
  "/orgs/{org}/membros/{uid}",
  "/orgs/{org}/dominios",
  "/orgs/{org}/dominios/{dom}/verificacao",
  "/orgs/{org}/settings",
  "/orgs/{org}/assinatura",
  "/admin/orgs",
  "/admin/orgs/{org}/provisionamento",
  "/admin/orgs/{org}/suspensao",
] as const;

export class RotaForaDoContrato extends Error {
  constructor(caminho: string) {
    super(
      `Rota "${caminho}" não está no contrato HTTP v1 ` +
        `(docs/plataforma/contrato-http-v1.md). O cliente não inventa rota: ` +
        `se o backend precisa expor isto, o contrato muda primeiro.`,
    );
    this.name = "RotaForaDoContrato";
  }
}

/** Um caminho concreto casa um padrão do contrato? `{x}` = um segmento. */
function casa(caminho: string, padrao: string): boolean {
  const c = caminho.split("/");
  const p = padrao.split("/");
  if (c.length !== p.length) return false;
  return p.every((seg, i) =>
    seg.startsWith("{") && seg.endsWith("}")
      ? // Segmento variável: precisa existir e não pode ser vazio nem conter `/`
        // (já garantido pelo split) — senão `/orgs//membros` passaria.
        (c[i]?.length ?? 0) > 0
      : seg === c[i],
  );
}

/**
 * O caminho é uma rota declarada no contrato?
 *
 * Módulo puro de propósito: é a mesma função que a tela usa e que o teste
 * exercita, então não existe versão "de teste" divergente da de produção.
 */
export function ehRotaDoContrato(caminho: string): boolean {
  if (!caminho.startsWith("/")) return false;
  // Recusa antes de casar: `//host` é protocol-relative (outra origem) e
  // `/x/../y` pode normalizar pra fora da superfície no navegador.
  if (caminho.startsWith("//") || caminho.includes("..")) return false;
  return SUPERFICIES.some((p) => casa(caminho, p));
}

/**
 * Única saída de rede do app web. Recusa rota fora do contrato ANTES de chamar,
 * e só então acrescenta o prefixo.
 *
 * `same-origin` e não `include`: numa implantação de mesma origem os dois
 * funcionam, mas `include` mandaria o cookie também numa requisição
 * cross-origin. O default tem que falhar do lado seguro. (A escolha veio do
 * `api-me.ts` do #1489 — era a mais conservadora e virou a da casa.)
 */
export async function chamar(
  caminho: string,
  init?: RequestInit,
): Promise<Response> {
  if (!ehRotaDoContrato(caminho)) throw new RotaForaDoContrato(caminho);
  return fetch(`${PREFIXO_API}${caminho}`, {
    credentials: "same-origin",
    ...init,
  });
}
