// Camada de dados do painel do Remote (#1472), contra o §4.6 do contrato.
//
// ⚠️ GUARDA, NÃO APLICA. Tudo o que este arquivo grava fica no servidor e **não
// chega às sessões remotas** até a ponte do #1729 existir (medido pelo @Altair,
// 13/10). Quem renderiza tem de dizê-lo; ver `remotoNaoAplicado` no dicionário.
//
// As leituras passam pelo `buscar` do `org.ts` (mesma máquina de estados, mesma
// distinção 403 ≠ 404). As escritas, por `escrever`, abaixo.

import { chamar } from "@/lib/api";
import { razaoDo403 } from "@/lib/org";

/**
 * As 5 capacidades de uma sessão remota — **exatamente** as do `Capabilities`
 * do `remote-net`, no camelCase do fio.
 *
 * É a lista do canário AC6 do #1683: câmera, túnel, gravação e afins NÃO entram
 * até a feature existir (#1715). Uma chave a mais aqui seria um `400` do BE
 * (`deny_unknown_fields`); uma a menos, uma capacidade que o painel não deixa
 * conceder nem tirar.
 */
export const CAPACIDADES = ["screen", "input", "fileTransfer", "clipboard", "audio"] as const;

export type Capacidade = (typeof CAPACIDADES)[number];

/**
 * O valor de `Capabilities` no fio.
 *
 * @nao-contrato sub-forma: o §4.6 a declara numa nota ("As formas aninhadas"),
 * não numa célula de sucesso, e a guarda do #1490 só lê os campos de topo de
 * cada linha. O vocabulário fica amarrado por `CAPACIDADES` e pelo teste do
 * painel que exige exatamente as 5.
 */
export interface CapacidadesRemotas {
  screen: boolean;
  input: boolean;
  fileTransfer: boolean;
  clipboard: boolean;
  audio: boolean;
}

/**
 * Quem recebe uma concessão. Só `utilizador` no v1; os grupos (D2) entram como
 * variante nova.
 *
 * @nao-contrato sub-forma declarada em nota do §4.6 (`Sujeito`); ver `CapacidadesRemotas`.
 */
interface SujeitoRemoto {
  tipo: "utilizador";
  uid: string;
}

/**
 * Sobre o quê. O `id` tem o formato conferido, **não a existência**: a
 * plataforma ainda não tem registo de devices (#1729).
 *
 * @nao-contrato sub-forma declarada em nota do §4.6 (`Objeto`); ver `CapacidadesRemotas`.
 */
interface ObjetoRemoto {
  tipo: "dispositivo";
  id: string;
}

/**
 * O teto da org. O `PUT` substitui-o INTEIRO: os 3 campos vão sempre.
 *
 * @rota /orgs/{org}/remoto/politica
 */
export interface PoliticaRemota {
  capacidades_maximas: CapacidadesRemotas;
  modo_aprovacao: "clique" | "senha" | "senha_ou_clique";
  permitir_nao_supervisionado: boolean;
}

export type ModoAprovacao = PoliticaRemota["modo_aprovacao"];

/** Os 3 modos, na ordem do contrato, para o `<select>` não inventar um 4.º. */
export const MODOS_APROVACAO: readonly ModoAprovacao[] = ["clique", "senha", "senha_ou_clique"];

/**
 * Uma concessão, como o `GET` a devolve. A lista traz as revogadas também
 * (`ativa: false`): o rasto fica visível a quem gere.
 *
 * @rota /orgs/{org}/remoto/concessoes
 */
export interface ConcessaoRemota {
  id: string;
  sujeito: SujeitoRemoto;
  objeto: ObjetoRemoto;
  capacidades: CapacidadesRemotas;
  concedida_por: string;
  concedida_em: number;
  revogada_em: number | null;
  ativa: boolean;
}

/** Caminhos do §4.6, num lugar só: a tela não monta caminho. */
export const CAMINHOS_REMOTO = {
  politica: (org: string) => `/orgs/${encodeURIComponent(org)}/remoto/politica`,
  concessoes: (org: string) => `/orgs/${encodeURIComponent(org)}/remoto/concessoes`,
  concessao: (org: string, id: string) =>
    `/orgs/${encodeURIComponent(org)}/remoto/concessoes/${encodeURIComponent(id)}`,
} as const;

/**
 * O formato de `DeviceId`, a mesma regra do `remote-net` que o BE aplica.
 *
 * O FE pré-valida para dizer ANTES do envio o que está errado; quem recusa de
 * verdade continua a ser o servidor (`400`). Uma regra mais frouxa aqui só
 * adiaria a recusa; uma mais estrita barraria um id válido.
 */
const FORMATO_DEVICE_ID = /^[A-Za-z0-9\-_.:@]{1,128}$/;

export function deviceIdValido(id: string): boolean {
  return FORMATO_DEVICE_ID.test(id);
}

/** Os atalhos do formulário "Conceder" (card #1472). `personalizado` = o que o admin marcar. */
export type Atalho = "ver" | "total" | "personalizado";

export const ATALHOS: readonly Atalho[] = ["ver", "total", "personalizado"];

/** Um conjunto de capacidades com só as `ligadas` a `true`. */
function so(ligadas: readonly Capacidade[]): CapacidadesRemotas {
  return {
    screen: ligadas.includes("screen"),
    input: ligadas.includes("input"),
    fileTransfer: ligadas.includes("fileTransfer"),
    clipboard: ligadas.includes("clipboard"),
    audio: ligadas.includes("audio"),
  };
}

/** "Só ver" = {tela}; "Acesso total" = as 5. Os dois atalhos fixos do card. */
export const CAPACIDADES_DO_ATALHO: Record<Exclude<Atalho, "personalizado">, CapacidadesRemotas> = {
  ver: so(["screen"]),
  total: so(CAPACIDADES),
};

/**
 * Qual atalho um conjunto de capacidades É, para a lista mostrar "Só ver" em vez
 * de "Ver a tela". Qualquer outro conjunto é `personalizado`.
 */
export function atalhoDe(c: CapacidadesRemotas): Atalho {
  for (const a of ["ver", "total"] as const) {
    if (CAPACIDADES.every((k) => c[k] === CAPACIDADES_DO_ATALHO[a][k])) return a;
  }
  return "personalizado";
}

/** As capacidades ligadas, na ordem de `CAPACIDADES`. */
export function ligadas(c: CapacidadesRemotas): Capacidade[] {
  return CAPACIDADES.filter((k) => c[k]);
}

/**
 * O que uma escrita do Remote pode devolver.
 *
 * @nao-contrato estado local da UI: a tradução do HTTP + `erro` do §4.6 para o
 * que a tela decide. Mesmo desenho do `ResultadoEscrita` do `org.ts`.
 *
 * `naoEncontrado` não diz qual dos casos foi: no `POST` pode ser o sujeito que
 * já não é membro, no `DELETE` uma concessão de outra org. O `404` é opaco por
 * contrato (invariante 1), e a tela trata-o como uma falha genérica + releitura.
 */
export type ResultadoEscritaRemota =
  | { estado: "feito" }
  | { estado: "naoAutenticado" }
  | { estado: "naoEhAdmin" }
  | { estado: "orgSuspensa" }
  | { estado: "naoEncontrado" }
  | { estado: "invalido" }
  | { estado: "conflito" }
  | { estado: "erro"; motivo: string };

async function escrever(
  caminho: string,
  metodo: "PUT" | "POST" | "DELETE",
  sucesso: number,
  corpo?: unknown,
): Promise<ResultadoEscritaRemota> {
  let resposta: Response;
  try {
    resposta = await chamar(caminho, {
      method: metodo,
      ...(corpo === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
    });
  } catch (e) {
    return { estado: "erro", motivo: e instanceof Error ? e.message : "rede" };
  }
  if (resposta.status === sucesso) return { estado: "feito" };
  if (resposta.status === 401) return { estado: "naoAutenticado" };
  if (resposta.status === 403) return await razaoDo403(resposta);
  // O `404` segue OPACO (invariante 1): não se lê o corpo.
  if (resposta.status === 404) return { estado: "naoEncontrado" };
  if (resposta.status === 400) return { estado: "invalido" };
  if (resposta.status === 409) return { estado: "conflito" };
  return { estado: "erro", motivo: `HTTP ${resposta.status}` };
}

/** `PUT …/remoto/politica` — substitui o teto inteiro (`200`). */
export function definirPolitica(org: string, politica: PoliticaRemota): Promise<ResultadoEscritaRemota> {
  return escrever(CAMINHOS_REMOTO.politica(org), "PUT", 200, politica);
}

/** `POST …/remoto/concessoes` — o membro sobre o device, com estas capacidades (`201`). */
export function conceder(
  org: string,
  uid: string,
  dispositivo: string,
  capacidades: CapacidadesRemotas,
): Promise<ResultadoEscritaRemota> {
  return escrever(CAMINHOS_REMOTO.concessoes(org), "POST", 201, {
    sujeito: { tipo: "utilizador", uid },
    objeto: { tipo: "dispositivo", id: dispositivo },
    capacidades,
  });
}

/** `DELETE …/remoto/concessoes/{id}` — revoga (`204`, idempotente). */
export function revogar(org: string, id: string): Promise<ResultadoEscritaRemota> {
  return escrever(CAMINHOS_REMOTO.concessao(org, id), "DELETE", 204);
}
