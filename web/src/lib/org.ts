// Camada de dados do admin da org (#1490).
//
// Todos os recursos são escopados na sessão: `/me/org/...`. Não existe
// `/orgs/<id>/...` — a org é a do principal da sessão, e é o backend que
// resolve qual é (delta do @Altair no #1475). O cliente nunca escolhe inquilino.
//
// ⚠️ CONTRATO AINDA NÃO EXISTE. Atualizado 24/08 21:5xZ: o par #1475-BE foi
// entregue (autorização como domínio puro) e está em `Rejected` na QA-A; mas o
// que falta pra este arquivo não é ele — é a BORDA HTTP. O @Altair mediu que os
// crates `platform-*` são bibliotecas: zero `main.rs`, zero axum. O contrato do
// fio está sendo escrito no #1503 (@alcor) com as 6 condições do #1265.
//
// Os formatos abaixo são o mínimo que as telas precisam e serão reconciliados
// com esse contrato. O que NÃO muda é o formato do CAMINHO — é isso que a
// guarda da raiz pina — nem a distinção 403/404, que é decisão de desenho já
// tomada e está explicada em `Resultado`.

import { chamar } from "@/lib/api";

type Papel = "org_admin" | "member";

/**
 * Um membro da org, **como o contrato devolve**: `[{ uid, nome, email, papel }]`.
 *
 * Eu tinha escrito `{ id, email, papel }` — inventei `id` e perdi `nome`, porque
 * quando escrevi não havia shape no contrato. A guarda de rotas não pegou: ela
 * confere CAMINHO, não CORPO. Daí a asserção de campos, que teria pego no ato.
 *
 * @rota /orgs/{org}/membros
 */
export interface Membro {
  uid: string;
  nome: string;
  email: string;
  papel: Papel;
}

/**
 * Um domínio da org, como o contrato v1.3 devolve: `[{ dominio, estado }]`.
 *
 * Nasce agora, e não antes, porque agora existe shape. Eu tinha escrito um
 * `Dominio` de antemão e o ratchet do #1421 o cobrou como órfão — com razão:
 * tipo inventado antes do contrato é palpite com cara de contrato.
 *
 * O `estado` é fechado nos dois valores do doc. Um `string` aberto aqui deixaria
 * a UI decidir o que fazer com um terceiro valor que ela não conhece — e o lugar
 * de decidir isso é o contrato, não o `switch` de quem renderiza.
 *
 * @rota /orgs/{org}/dominios
 */
export interface Dominio {
  dominio: string;
  estado: "pendente" | "verificado";
}

// `Assinatura` e o shape de `settings` seguem SEM nascer, e agora com o motivo
// escrito no próprio contrato: a de assinatura "nasce com o #1470 (Stripe,
// bloqueado no PO)", e a de settings diz "mesmo shape do PATCH" — que não
// declara corpo. Ler "espelha o PUT" não é um shape; é uma promessa de shape.

/**
 * Caminhos do admin da org, **do contrato** (§4.3) — um lugar só; a tela não
 * monta caminho.
 *
 * Eram `/me/org/...`, que eu inventei quando não havia contrato. O contrato diz
 * `/orgs/{org}/...`, com `{org}` conferido contra a sessão no backend (org
 * alheia ⇒ 404). Viraram funções porque agora dependem do identificador da org.
 *
 * De onde vem o `{org}`: do **`GET /me/orgs`** (`minhasOrgs`). O @Altair criou a
 * rota pra fechar a lacuna que eu levantei — o cliente não guarda slug de lugar
 * nenhum, pergunta ao servidor quais orgs a SESSÃO tem. Guardar um slug vindo de
 * qualquer lugar é o que o invariante 6 impede.
 *
 * ⚠️ Só `membros` tem `GET` no contrato. `dominios`, `settings` e `assinatura`
 * têm apenas mutação (`POST`/`PATCH`/`PUT`), então a UI **não tem como ler** o
 * estado atual dos três. Lacuna medida e levada ao @alcor/@Altair; até fechar,
 * os painéis declaram o que falta em vez de fingir dados.
 */
export const CAMINHOS = {
  membros: (org: string) => `/orgs/${org}/membros`,
  dominios: (org: string) => `/orgs/${org}/dominios`,
  settings: (org: string) => `/orgs/${org}/settings`,
  assinatura: (org: string) => `/orgs/${org}/assinatura`,
} as const;

/**
 * O que o backend respondeu, traduzido para o que a tela precisa decidir.
 *
 * A negativa é caso de primeira classe, não erro genérico: uma tela que
 * tratasse 403/404 como "erro de rede" ofereceria "tentar de novo" a quem
 * simplesmente não tem acesso, e esconderia o fato de o backend ter barrado.
 *
 * ── 403 e 404 são DIFERENTES, e a fatia 1 errou ao colapsá-los ─────────────
 * Eu tinha os dois como um estado só (`negado`), com o comentário de que "do
 * lado do cliente os dois significam não é seu". O @Altair mostrou na revisão
 * do #1475 por que isso está errado:
 *
 *   "Colapsar os dois perderia a capacidade de dizer a um membro 'isto exige
 *    admin' — pior experiência, zero ganho de segurança."
 *
 * A razão é a ORDEM no servidor. `resolver_org` roda primeiro: quem não
 * pertence à org leva **404 e para ali**, e nunca chega a ver um 403. Logo o
 * 403 só alcança quem **já é da org** — e portanto já sabe que ela existe.
 * Dizer-lhe "isto exige admin" não revela nada.
 *
 * O sigilo vem de o 404 vir ANTES do 403 no backend, não de o cliente fingir
 * que são iguais. Colapsar aqui não protegia ninguém: só piorava a mensagem
 * pra quem é membro legítimo e ficava sem saber o que fazer.
 */
export type Resultado<T> =
  | { estado: "pronto"; dados: T }
  /**
   * 401 — **sem sessão**. Não é erro de carregamento: é falta de login, e a UI
   * manda ao `/login` (mesmo sinal que o `use-carregar` do #1489 já usa).
   *
   * Nasceu de um defeito MEDIDO contra a borda real: sem cookie, o
   * `GET /me/orgs` devolvia 401, isso caía em `erro`, a descoberta ficava nula e
   * a tela dizia *"organização não identificada"* — mandando o usuário procurar
   * problema de org quando o problema era não estar logado. Os testes não
   * pegaram porque nenhum duplo devolvia 401; só o servidor de verdade devolve.
   */
  | { estado: "naoAutenticado" }
  /** 403 `negado` — é da org, mas não é admin dela. Pode saber que a org existe. */
  | { estado: "naoEhAdmin" }
  /**
   * 403 `org_suspensa` — **mesmo HTTP que `negado`, razão diferente** (contrato
   * v1.4, §3). O principal É membro; quem não é membro leva `404` e nunca chega
   * aqui, então a suspensão não vira oráculo.
   *
   * Por que não colapsar no `naoEhAdmin`: a ordem de checagem no servidor é
   * **visibilidade → suspensão → papel**, e ela existe justamente pra que um
   * membro de org suspensa não veja "papel insuficiente". Se o cliente colapsar
   * os dois aqui, ele desfaz no último metro a distinção que o servidor tomou o
   * cuidado de fazer — e o usuário vai pedir a um admin um acesso que nenhum
   * admin pode conceder, porque o problema não é papel, é a org estar suspensa.
   */
  | { estado: "orgSuspensa" }
  /** 404 — não pertence à org (ou ela não existe). Não pode saber qual dos dois. */
  | { estado: "naoEhSuaOrg" }
  | { estado: "erro"; motivo: string };

/**
 * Uma org do principal, como o contrato devolve em `GET /me/orgs`.
 *
 * ⚠️ **`papel` decide o que MOSTRAR, jamais o que PERMITIR.** A amarra é do
 * @Altair, escrita no contrato: a lista é conveniência do cliente, nunca
 * concessão. Quem autoriza é o `autorizar` no servidor, e o `{org}` das rotas
 * de admin segue conferido contra a sessão. Se algum dia esta tela liberar uma
 * ação porque `papel === "org_admin"`, o defeito não é a UI ficar bonita demais
 * — é ter transformado uma dica de renderização em decisão de acesso.
 *
 * @rota /me/orgs
 */
export interface OrgDoPrincipal {
  org: string;
  papel: string;
}

/**
 * As orgs do principal da sessão. Hoje é uma; o contrato devolve lista porque
 * `me.org` singular "seria correto agora e mentira depois" (@Altair).
 */
export function minhasOrgs(): Promise<Resultado<OrgDoPrincipal[]>> {
  return buscar<OrgDoPrincipal[]>("/me/orgs");
}

/**
 * Qual das duas razões de `403` o servidor deu.
 *
 * O contrato (§3) dá ao `403` um corpo `{ "erro": "<codigo>" }` com vocabulário
 * fechado. São dois os códigos que chegam num `403`: `negado` (papel
 * insuficiente) e `org_suspensa` (a org caiu).
 *
 * ── Desconhecido é NEUTRO, nunca permissivo ────────────────────────────────
 * Condição (2) do @Altair, ratificada na v1.4: *"desconhecido no FE = neutro,
 * nunca permissivo (forward-compat da string do lado do cliente; no BE o enum é
 * fechado)"*. Traduzido pra este arquivo: **todo caminho que não reconhece o
 * código cai em `naoEhAdmin`** — corpo ausente, corpo que não é JSON, `erro`
 * que não é string, código novo que este build não conhece. Nenhum deles
 * devolve `pronto`, e nenhum deles inventa um estado permissivo.
 *
 * O risco de errar pro outro lado é concreto: se um código novo caísse em
 * `pronto` ou em `erro` genérico, um `403` viraria "tente de novo" — oferecendo
 * repetição a quem foi barrado. Cair no mais restritivo é a única direção em
 * que um build velho contra um servidor novo continua correto.
 *
 * Ler o corpo aqui é seguro quanto ao invariante 1 porque **só o `403` passa
 * por esta função**. O `404`, que é o que não pode vazar razão, nunca é lido.
 */
async function razaoDo403(resposta: Response): Promise<{ estado: "naoEhAdmin" | "orgSuspensa" }> {
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: "naoEhAdmin" };
  }
  const codigo =
    typeof corpo === "object" && corpo !== null
      ? (corpo as { erro?: unknown }).erro
      : undefined;
  return codigo === "org_suspensa"
    ? { estado: "orgSuspensa" }
    : { estado: "naoEhAdmin" };
}

export async function buscar<T>(caminho: string): Promise<Resultado<T>> {
  let resposta: Response;
  try {
    resposta = await chamar(caminho);
  } catch (e) {
    return { estado: "erro", motivo: e instanceof Error ? e.message : "rede" };
  }
  if (resposta.status === 401) return { estado: "naoAutenticado" };
  if (resposta.status === 403) return await razaoDo403(resposta);
  // O `404` segue OPACO de propósito: o contrato exige que ele seja byte-a-byte
  // igual quer o recurso não exista, quer exista e não seja do solicitante
  // (invariante 1). Ler o corpo dele não teria o que aprender — e a tentação de
  // tratá-lo como os outros é justamente o que o invariante impede.
  if (resposta.status === 404) return { estado: "naoEhSuaOrg" };
  if (!resposta.ok) {
    return { estado: "erro", motivo: `HTTP ${resposta.status}` };
  }
  // O corpo pode não ser JSON mesmo com 200. Não é hipótese: MEDIDO no dev
  // server (24/08) — sem backend, o fallback de SPA do Vite devolve o
  // `index.html` com 200, o `.json()` estoura, a promessa rejeita e a tela fica
  // presa em "carregando" PARA SEMPRE. Spinner eterno é pior que erro: não dá
  // ao usuário nem a informação de que algo quebrou.
  //
  // Os testes não pegaram porque todos os duplos devolviam JSON válido — o
  // caminho só aparece quando existe um servidor de verdade do outro lado.
  try {
    return { estado: "pronto", dados: (await resposta.json()) as T };
  } catch {
    return { estado: "erro", motivo: "resposta não é JSON" };
  }
}
