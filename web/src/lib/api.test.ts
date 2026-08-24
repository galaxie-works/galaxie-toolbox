// #1490 — a porta de rede recusa rota fora do contrato ANTES de sair da máquina,
// e põe o prefixo `/api/v1` num lugar só.
//
// A guarda de fonte (`src/lib/pollux-1490-contrato-fe.test.ts`, canal que barra)
// amarra a lista de superfícies ao doc do contrato. Este teste cobre o outro
// vetor: caminho montado em RUNTIME (concatenação, valor vindo de resposta,
// parâmetro de rota). Fonte e runtime são buracos diferentes; um não fecha o
// outro — e o do runtime é o que pega `/orgs/${orgQueVeioDeAlgumLugar}`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { chamar, ehRotaDoContrato, RotaForaDoContrato } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("#1490 porta de rede — só rota do contrato", () => {
  it("aceita as superfícies declaradas, com parâmetro preenchido", () => {
    expect(ehRotaDoContrato("/me")).toBe(true);
    expect(ehRotaDoContrato("/me/dispositivos/abc-123")).toBe(true);
    expect(ehRotaDoContrato("/orgs/acme/membros")).toBe(true);
    expect(ehRotaDoContrato("/orgs/acme/membros/u1")).toBe(true);
    expect(ehRotaDoContrato("/orgs/acme/dominios/exemplo.com/verificacao")).toBe(
      true,
    );
    expect(ehRotaDoContrato("/admin/orgs/acme/suspensao")).toBe(true);
  });

  it("recusa rota que o contrato não declara", () => {
    // Foi assim que nasceu o defeito: eu inventei `/me/org/membros` quando não
    // havia contrato. Hoje morre aqui.
    expect(ehRotaDoContrato("/me/org/membros")).toBe(false);
    expect(ehRotaDoContrato("/usuarios/42")).toBe(false);
    expect(ehRotaDoContrato("/orgs/acme")).toBe(false);
    expect(ehRotaDoContrato("/orgs/acme/faturas")).toBe(false);
  });

  it("recusa parâmetro vazio — `/orgs//membros` não é `/orgs/{org}/membros`", () => {
    expect(ehRotaDoContrato("/orgs//membros")).toBe(false);
    expect(ehRotaDoContrato("/me/dispositivos/")).toBe(false);
  });

  it("recusa o quase-certo e a fuga de origem", () => {
    // `/mercado` começa com "/me" como TEXTO e não é rota nenhuma. Foi assim que
    // o #1416 me mordeu: casar por prefixo de string em vez de por segmento.
    expect(ehRotaDoContrato("/mercado/orgs")).toBe(false);
    expect(ehRotaDoContrato("/meus-dados")).toBe(false);
    expect(ehRotaDoContrato("https://outro.example/me")).toBe(false);
    // Protocol-relative: começa com "/" mas o host é outro.
    expect(ehRotaDoContrato("//outro.example/me")).toBe(false);
    // Travessia que o navegador normalizaria pra fora da superfície.
    expect(ehRotaDoContrato("/orgs/acme/../../admin/orgs")).toBe(false);
  });

  it("`chamar` nem toca a rede quando a rota está fora do contrato", async () => {
    const rede = vi.fn();
    vi.stubGlobal("fetch", rede);
    await expect(chamar("/me/org/membros")).rejects.toBeInstanceOf(
      RotaForaDoContrato,
    );
    expect(rede).not.toHaveBeenCalled();
  });

  it("põe o prefixo `/api/v1` — uma vez, num lugar só", async () => {
    const rede = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", rede);
    await chamar("/orgs/acme/membros");
    expect(rede).toHaveBeenCalledWith(
      "/api/v1/orgs/acme/membros",
      expect.anything(),
    );
  });

  it("manda o cookie da sessão, e só na mesma origem", async () => {
    // `same-origin`, não `include`: numa implantação de mesma origem os dois
    // funcionam, mas `include` mandaria o cookie também numa requisição
    // cross-origin. O default tem que falhar do lado seguro.
    const rede = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", rede);
    await chamar("/me");
    expect(rede).toHaveBeenCalledWith(
      "/api/v1/me",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
