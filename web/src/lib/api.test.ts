// #1490 — a porta de rede recusa caminho não-escopado ANTES de sair da máquina.
//
// A guarda de fonte (`src/lib/pollux-1490-tenancy-fe.test.ts`, canal que barra)
// impede que alguém ESCREVA um caminho de inquilino. Este teste cobre o outro
// vetor: caminho montado em runtime (concatenação, valor vindo de resposta,
// parâmetro de rota). Fonte e runtime são buracos diferentes; um não fecha o
// outro.
import { describe, it, expect, vi, afterEach } from "vitest";
import { chamar, ehEscopadoNaSessao, CaminhoNaoEscopado } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("#1490 porta de rede — escopo vem da sessão", () => {
  it("aceita os caminhos escopados", () => {
    expect(ehEscopadoNaSessao("/me")).toBe(true);
    expect(ehEscopadoNaSessao("/me/org/membros")).toBe(true);
    expect(ehEscopadoNaSessao("/me/org/membros/abc-123")).toBe(true);
  });

  it("recusa caminho que endereça inquilino por id", () => {
    expect(ehEscopadoNaSessao("/orgs/abc-123/membros")).toBe(false);
    expect(ehEscopadoNaSessao("/users/42/perfil")).toBe(false);
    expect(ehEscopadoNaSessao("/tenants/x")).toBe(false);
  });

  it("recusa o quase-certo — prefixo que só PARECE escopado", () => {
    // `/mercado` começa com "/me" como texto e não é escopo nenhum. Foi assim
    // que o #1416 me mordeu: casar por prefixo de string, não por segmento.
    expect(ehEscopadoNaSessao("/mercado/orgs")).toBe(false);
    expect(ehEscopadoNaSessao("/meus-dados")).toBe(false);
  });

  it("recusa caminho absoluto pra outra origem (exfiltração)", () => {
    expect(ehEscopadoNaSessao("https://outro.example/me/org")).toBe(false);
    // Protocol-relative: começa com "/" mas o host é outro. Tem que cair.
    expect(ehEscopadoNaSessao("//outro.example/me")).toBe(false);
  });

  it("`chamar` nem chega a tocar a rede quando o caminho é ruim", async () => {
    const rede = vi.fn();
    vi.stubGlobal("fetch", rede);
    await expect(chamar("/orgs/abc/membros")).rejects.toBeInstanceOf(
      CaminhoNaoEscopado,
    );
    expect(rede).not.toHaveBeenCalled();
  });

  it("`chamar` manda o cookie da sessão, e só na mesma origem", async () => {
    // `same-origin`, não `include`: numa implantação de mesma origem os dois
    // funcionam, mas `include` mandaria o cookie também numa requisição
    // cross-origin. O default tem que falhar do lado seguro.
    const rede = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", rede);
    await chamar("/me/org/membros");
    expect(rede).toHaveBeenCalledWith(
      "/me/org/membros",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
