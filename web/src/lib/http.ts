// Camada HTTP compartilhada dos clientes `/me/*` da plataforma (#1489 introduziu
// isto embutido no api-me; #1491 extraiu pra cá porque toda faceta da conta fala
// o mesmo dialeto). Doutrina do Altair (#1265): cookie HttpOnly (o FE nunca toca
// no token) + mesma origem (caminhos relativos, sem CORS); 401 = sem sessão;
// 404 (não 403) pra recurso alheio.

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
  const resp = await fetch(caminho, {
    // Mesma origem: o cookie de sessão viaja sozinho; não montamos token.
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  if (!resp.ok) throw new ErroApi(resp.status);
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}
