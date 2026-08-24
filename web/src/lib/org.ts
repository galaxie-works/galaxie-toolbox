// Camada de dados do admin da org (#1490).
//
// Todos os recursos são escopados na sessão: `/me/org/...`. Não existe
// `/orgs/<id>/...` — a org é a do principal da sessão, e é o backend que
// resolve qual é (delta do @Altair no #1475). O cliente nunca escolhe inquilino.
//
// ⚠️ CONTRATO AINDA NÃO EXISTE. O par #1475-BE está em `Ready` sem dono; os
// formatos abaixo são o mínimo que as telas deste card precisam, e vão ser
// reconciliados com o BE quando ele nascer. O que NÃO muda com o contrato é o
// formato do CAMINHO — é isso que a guarda da raiz pina.

import { chamar } from "@/lib/api";

type Papel = "org_admin" | "member";

export interface Membro {
  id: string;
  email: string;
  papel: Papel;
}

// `Dominio` e `Assinatura` NÃO nascem aqui de propósito. Eu os havia escrito de
// antemão e o ratchet do #1421 os cobrou como órfãos — com razão: os painéis
// deles esperam o formato do #1475-BE, que não existe. Tipo inventado antes do
// contrato é palpite com cara de contrato; nasce junto com o endpoint.

/** Caminhos do admin da org. Um lugar só — a tela não monta caminho. */
export const CAMINHOS = {
  membros: "/me/org/membros",
  dominios: "/me/org/dominios",
  configuracoes: "/me/org/configuracoes",
  assinatura: "/me/org/assinatura",
} as const;

/**
 * O que o backend respondeu, traduzido para o que a tela precisa decidir.
 *
 * `negado` é caso de primeira classe, não um erro genérico: o AC2 deste card
 * diz que a UI reflete a negativa do backend — esconder botão não é autorizar.
 * Uma tela que tratasse 403/404 como "erro de rede" ofereceria "tentar de novo"
 * pra quem simplesmente não tem acesso, e esconderia o fato de o backend ter
 * barrado. 404 entra aqui junto com 403 de propósito: o BE responde 404 para
 * org alheia (não enumerar), e do lado do cliente os dois significam "não é
 * seu".
 */
export type Resultado<T> =
  | { estado: "pronto"; dados: T }
  | { estado: "negado" }
  | { estado: "erro"; motivo: string };

export async function buscar<T>(caminho: string): Promise<Resultado<T>> {
  let resposta: Response;
  try {
    resposta = await chamar(caminho);
  } catch (e) {
    return { estado: "erro", motivo: e instanceof Error ? e.message : "rede" };
  }
  if (resposta.status === 403 || resposta.status === 404) {
    return { estado: "negado" };
  }
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
