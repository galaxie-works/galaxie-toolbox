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

  it("salvarConfig manda UM PATCH por chave tocada, corpo {chave, valor} stringificado", async () => {
    fetchMock.mockResolvedValueOnce(respostaOk({ chave: "app.tema", valor: "escuro", tipo: "opcao" }));
    fetchMock.mockResolvedValueOnce(respostaOk({ chave: "app.notificacoes", valor: "false", tipo: "bool" }));
    const r = await salvarConfig({ "app.tema": "escuro", "app.notificacoes": false });
    expect(fetchMock).toHaveBeenCalledTimes(2); // um PATCH por chave, não um batch
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toContainEqual({ chave: "app.tema", valor: "escuro" });
    expect(bodies).toContainEqual({ chave: "app.notificacoes", valor: "false" }); // bool → String
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("/api/v1/me/config");
      expect(init.method).toBe("PATCH");
    }
    expect(r.ok).toEqual(["app.tema", "app.notificacoes"]);
    expect(r.falhas).toEqual([]);
  });

  it("uma chave que falha NÃO aborta as outras — reporta POR CHAVE (mandato #1588/@Altair)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 })); // 1ª: valor/opção inválida
    fetchMock.mockResolvedValueOnce(respostaOk({ chave: "b", valor: "ok", tipo: "texto" })); // 2ª grava
    const r = await salvarConfig({ a: "lixo", b: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // o 400 NÃO abortou o loop
    expect(r.ok).toEqual(["b"]);
    expect(r.falhas).toEqual([{ chave: "a", status: 400 }]);
  });

  it("401 a meio PROPAGA (sessão morta = sinal do app, não falha de chave)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(ehNaoAutenticado(await salvarConfig({ a: "x" }).catch((e) => e))).toBe(true);
  });

  it("INVARIANTE: só fala /me/config (escopo vem da sessão, sem id de dono)", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respostaOk({ chave: "x", valor: "true", tipo: "bool" })),
    );
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
