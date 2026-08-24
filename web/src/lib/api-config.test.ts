// #1491 — cliente de config: rotas `/me/config`, credentials, allowlist só-leitura-do-BE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { obterConfig, salvarConfig } from "./api-config";
import { ErroApi, ehNaoAutenticado } from "./http";

function respostaOk(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("#1491 api-config", () => {
  it("obterConfig chama GET /me/config com credentials same-origin", async () => {
    fetchMock.mockResolvedValueOnce(respostaOk([]));
    await obterConfig();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/me/config");
    expect(init.credentials).toBe("same-origin");
  });

  it("salvarConfig manda PATCH /me/config com o patch em JSON", async () => {
    fetchMock.mockResolvedValueOnce(respostaOk([]));
    await salvarConfig({ tema: "escuro" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/me/config");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ tema: "escuro" });
  });

  it("INVARIANTE: só fala /me/config (escopo vem da sessão, sem id de dono)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respostaOk([])));
    await obterConfig();
    await salvarConfig({ x: true });
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toBe("/api/v1/me/config");
      expect(String(url)).not.toContain("/users/");
    }
  });

  it("401 é não-autenticado; 404 (não 403) pra pref alheia vira ErroApi", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(ehNaoAutenticado(await obterConfig().catch((e) => e))).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(obterConfig()).rejects.toBeInstanceOf(ErroApi);
  });
});
