// #1489 — o cliente `/me/*` carrega a doutrina do Altair (#1473) NO TIPO e no wire:
// rotas `/me/...` (nunca `/users/<id>`), cookie via credentials, status preservado.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  obterPerfil,
  atualizarPerfil,
  listarDispositivos,
  revogarDispositivo,
  ehNaoAutenticado,
  ErroApi,
} from "./api-me";

function respostaOk(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("#1489 api-me — rotas escopadas à sessão", () => {
  it("obterPerfil chama GET /me com credentials same-origin", async () => {
    fetchMock.mockResolvedValueOnce(respostaOk({ nome: "Ana", email: "ana@x.com" }));
    const p = await obterPerfil();
    expect(p.nome).toBe("Ana");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/me");
    expect(init.credentials).toBe("same-origin");
  });

  it("listarDispositivos chama /me/dispositivos", async () => {
    fetchMock.mockResolvedValueOnce(respostaOk([]));
    await listarDispositivos();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/me/dispositivos");
  });

  it("revogarDispositivo usa DELETE em /me/dispositivos/<id> e encoda o id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await revogarDispositivo("a b/c");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/me/dispositivos/a%20b%2Fc");
    expect(init.method).toBe("DELETE");
  });

  it("atualizarPerfil manda PATCH /me com JSON no corpo", async () => {
    fetchMock.mockResolvedValueOnce(respostaOk({ nome: "Novo", email: "ana@x.com" }));
    await atualizarPerfil({ nome: "Novo" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/me");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ nome: "Novo" });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("INVARIANTE: nenhuma rota do cliente endereça `/users/<id>` (escopo vem da sessão)", async () => {
    // corpo novo por chamada (o body de um Response só pode ser lido uma vez)
    fetchMock.mockImplementation(() => Promise.resolve(respostaOk({ nome: "Ana", email: "a@x.com", status: "nenhuma", plano: "" })));
    await obterPerfil();
    await atualizarPerfil({ nome: "x" });
    await listarDispositivos().catch(() => {});
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith("/api/v1/me")).toBe(true);
      expect(String(url)).not.toContain("/users/");
    }
  });

  it("404 vira ErroApi(404) — conta alheia responde 404, não 403", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(obterPerfil()).rejects.toBeInstanceOf(ErroApi);
  });

  it("401 é reconhecido como não-autenticado (a UI manda ao login)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const erro = await obterPerfil().catch((e) => e);
    expect(ehNaoAutenticado(erro)).toBe(true);
  });
});
