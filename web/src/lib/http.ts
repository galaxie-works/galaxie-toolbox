// Camada HTTP compartilhada dos clientes `/me/*` da plataforma (#1489 introduziu
// isto embutido no api-me; #1491 extraiu pra cá porque toda faceta da conta fala
// o mesmo dialeto). Doutrina do Altair (#1265): cookie HttpOnly (o FE nunca toca
// no token) + mesma origem (caminhos relativos, sem CORS); 401 = sem sessão;
// 404 (não 403) pra recurso alheio.
//
// #1490: o `fetch` cru saiu daqui — `pedir` passa pela porta única `chamar`.

import { chamar } from "@/lib/api";

/** Erro de uma chamada `/me/*` com o status HTTP preservado (401/404/…). */
export class ErroApi extends Error {
  readonly status: number;
  constructor(status: number, mensagem?: string) {
    super(mensagem ?? `HTTP ${status}`);
    this.name = "ErroApi";
    this.status = status;
  }
}

/** `true` quando o erro é "sem sessão" — a UI deve mandar pro login. */
export function ehNaoAutenticado(e: unknown): boolean {
  return e instanceof ErroApi && e.status === 401;
}

/** GET/PATCH/DELETE em rota relativa, com o cookie de sessão anexado pelo navegador. */
export async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  // Porta única (#1490) em vez de `fetch` direto. A guarda de tenancy no canal
  // que BARRA diz "ninguém usa `fetch` cru fora da porta", e este era o segundo
  // `fetch` do app. Abrir exceção na guarda pra cada camada nova a corrói até
  // virar enfeite.
  //
  // O ganho não é burocrático: a checagem de escopo passa a valer pros caminhos
  // montados em RUNTIME (`/me/dispositivos/${id}`) — exatamente onde uma
  // varredura de fonte não alcança.
  //
  // `credentials` vem da porta, e é o `same-origin` que ESTE arquivo já usava:
  // a escolha daqui era a mais conservadora e virou a da casa. (Eu tinha escrito
  // `include` no #1490 e estava errado — mandaria o cookie cross-origin também.)
  const resp = await chamar(caminho, {
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  if (!resp.ok) throw new ErroApi(resp.status);
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}
