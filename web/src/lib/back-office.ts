// Camada de dados do back-office (#1492, par do #1474-BE).
//
// ── A diferença que manda nesta tela ───────────────────────────────────────
// O contrato (§4.5) diz: `GET /admin/orgs` é **só staff; não-staff ⇒ 404 (não
// revela o back-office)**. Isso NÃO é o mesmo 404 do admin da org (#1490).
//
//   • No #1490, 403 e 404 são estados distintos com mensagens distintas, porque
//     quem leva 403 já é da org e já sabe que ela existe.
//   • Aqui, o 404 significa **"não existe nada aqui pra ti"** — e a UI tem que
//     se comportar como se a rota não existisse. Uma tela que dissesse "você não
//     é staff" devolveria por texto exatamente o que o status recusou dizer: que
//     o back-office existe. É o mesmo erro do oráculo que o @Altair fechou no
//     contrato inteiro, só que no cliente.
//
// Por isso `naoExiste` é UM estado, sem detalhe, e o teste dele afirma a
// AUSÊNCIA de qualquer palavra sobre staff ou permissão.
//
// ⚠️ O corpo do `200` ainda não está no contrato — perguntei ao @alcor no card
// em vez de chutar (chutar shape foi o erro que me custou a fatia 3 do #1490).
// Enquanto não vem, a lista não é tipada aqui: nasce com a resposta.

import { chamar } from "@/lib/api";

/** Rotas do back-office, do contrato §4.5. Um lugar só — a tela não monta caminho. */
export const CAMINHOS = {
  orgs: "/admin/orgs",
  provisionar: (org: string) => `/admin/orgs/${org}/provisionamento`,
  suspender: (org: string) => `/admin/orgs/${org}/suspensao`,
} as const;

/**
 * O que o back-office devolve, traduzido para o que a tela decide.
 *
 * `naoExiste` é deliberadamente OPACO: sem motivo, sem detalhe, sem menção a
 * staff. Ver o cabeçalho — dar detalhe aqui desfaz o 404.
 */
export type Resultado<T> =
  | { estado: "pronto"; dados: T }
  | { estado: "naoExiste" }
  | { estado: "erro"; motivo: string };

export async function listarOrgs<T>(): Promise<Resultado<T>> {
  let resposta: Response;
  try {
    resposta = await chamar(CAMINHOS.orgs);
  } catch (e) {
    return { estado: "erro", motivo: e instanceof Error ? e.message : "rede" };
  }
  // 403 cai aqui junto com 404 de propósito: se o backend algum dia responder
  // 403, o cliente NÃO vai transformar isso numa mensagem que revela mais que o
  // 404 revelaria. O contrato manda 404; o cliente não melhora o vazamento.
  if (resposta.status === 404 || resposta.status === 403) {
    return { estado: "naoExiste" };
  }
  if (!resposta.ok) {
    return { estado: "erro", motivo: `HTTP ${resposta.status}` };
  }
  try {
    return { estado: "pronto", dados: (await resposta.json()) as T };
  } catch {
    // Medido no #1490: sem backend, o fallback de SPA devolve HTML com 200 e o
    // `.json()` estoura, deixando a tela presa em "carregando" pra sempre.
    return { estado: "erro", motivo: "resposta não é JSON" };
  }
}

/** Resultado de uma ação que muta. `202` = aceite (o contrato é assíncrono). */
export type Acao =
  | { estado: "aceita" }
  | { estado: "naoExiste" }
  | { estado: "erro"; motivo: string };

async function agir(caminho: string): Promise<Acao> {
  let resposta: Response;
  try {
    resposta = await chamar(caminho, { method: "POST" });
  } catch (e) {
    return { estado: "erro", motivo: e instanceof Error ? e.message : "rede" };
  }
  if (resposta.status === 404 || resposta.status === 403) {
    return { estado: "naoExiste" };
  }
  if (!resposta.ok) return { estado: "erro", motivo: `HTTP ${resposta.status}` };
  return { estado: "aceita" };
}

// `provisionar` NÃO nasce aqui ainda. Eu a escrevi junto com `suspender` e o
// ratchet do #1421 a cobrou como órfã — com razão: só a suspensão tem gatilho na
// tela, porque provisionar exige um formulário cujo shape o contrato ainda não
// define. Função pronta sem consumidor é a mesma dívida dos tipos que removi no
// #1490 hoje: nasce com a lista. O caminho já está em `CAMINHOS`, que é o que a
// guarda do contrato pina.

/**
 * Suspender é, nas palavras do contrato, "a operação mais destrutiva do
 * produto", com auditoria à parte. A confirmação NÃO mora aqui — mora na tela,
 * onde há um humano. Esta função apenas executa o que já foi confirmado.
 */
export const suspender = (org: string): Promise<Acao> =>
  agir(CAMINHOS.suspender(org));
