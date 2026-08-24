// #1490 — comportamento do admin da org.
//
// O que estes testes provam e o que NÃO provam:
//
// ✅ A metade CLIENTE do AC2: quando o backend nega, a tela não mostra dado
//    nenhum da org — mostra o aviso de sem permissão. Isso é testável sem o BE
//    porque o que se mede é a REAÇÃO da UI a uma negativa, não a negativa.
// ❌ A metade SERVIDOR do AC2/AC3 (o backend negar de fato, o 404 de org
//    alheia): depende do #1475-BE, que está em `Ready` sem dono. Fica aberto e
//    declarado no card — não vou chamar isto de AC cumprido.
//
// O `fetch` é trocado por um duplo aqui de propósito: quero exercitar a porta
// de rede real (`chamar`), não pular por cima dela. Se alguém tirar a checagem
// de escopo da porta, o teste do caminho continua valendo porque ele mede o que
// SAIU — a URL que a tela pediu.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { AdminOrgPage } from "./admin-org";
import { CAMINHOS } from "@/lib/org";
import { DICIONARIOS } from "@/i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Duplo de rede que registra o que foi pedido e responde o que o teste mandar. */
function fetchFalso(resposta: () => Response) {
  const pedidos: string[] = [];
  vi.stubGlobal("fetch", (entrada: string) => {
    pedidos.push(String(entrada));
    return Promise.resolve(resposta());
  });
  return pedidos;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("#1490 admin da org — a UI reflete, não decide", () => {
  it("AC2 (metade FE): backend negando ⇒ nenhum dado da org na tela", async () => {
    fetchFalso(() => json({ erro: "negado" }, 403));
    render(<AdminOrgPage idioma="pt-BR" />);

    await waitFor(() =>
      expect(
        screen.getByText(DICIONARIOS["pt-BR"].semPermissao),
      ).toBeTruthy(),
    );
    // O que importa não é o aviso aparecer — é NÃO haver linha de membro.
    expect(screen.queryByRole("table")).toBeNull();
  });

  // ── 403 ≠ 404 ────────────────────────────────────────────────────────────
  // A fatia 1 colapsava os dois e o teste de então AFIRMAVA o colapso ("404 cai
  // no mesmo caminho que 403"). Estes dois testes afirmam o oposto, e o mutante
  // que os mata é trocar um status pelo outro — exatamente a regressão possível.
  //
  // Por que são diferentes (nota do @Altair no #1475): quem leva 403 já é da
  // org e já sabe que ela existe; dizer "peça a um admin" é acionável e não
  // revela nada. Quem leva 404 não pertence, e a mensagem não pode confirmar
  // que a org existe. O sigilo vem da ORDEM no servidor, não do colapso aqui.

  it("403 (é da org, não é admin) ⇒ mensagem ACIONÁVEL: peça a um admin", async () => {
    fetchFalso(() => json({}, 403));
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].semPermissao)).toBeTruthy(),
    );
    expect(
      screen.getByText(DICIONARIOS["pt-BR"].semPermissaoDetalhe),
    ).toBeTruthy();
    // E não pode cair na mensagem do 404.
    expect(screen.queryByText(DICIONARIOS["pt-BR"].naoEhSuaOrg)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("404 (não pertence) ⇒ mensagem VAGA, que não confirma que a org existe", async () => {
    fetchFalso(() => json({}, 404));
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].naoEhSuaOrg)).toBeTruthy(),
    );
    // O texto do 403 admite que a org é sua ("da SUA organização"). Se ele
    // aparecesse aqui, o cliente confirmaria a existência de uma org alheia —
    // devolvendo por texto o que o backend recusou dizer pelo status.
    expect(screen.queryByText(DICIONARIOS["pt-BR"].semPermissao)).toBeNull();
    expect(
      screen.queryByText(DICIONARIOS["pt-BR"].semPermissaoDetalhe),
    ).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("200 com corpo não-JSON não deixa a tela presa em 'carregando'", async () => {
    // Regressão MEDIDA no dev server, não imaginada: sem backend, o fallback de
    // SPA devolve `index.html` com 200; o `.json()` estourava, a promessa
    // rejeitava e o painel ficava carregando pra sempre. Nenhum teste pegou
    // porque todos os duplos devolviam JSON válido.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].erroCarregar)).toBeTruthy(),
    );
    expect(screen.queryByText(DICIONARIOS["pt-BR"].carregando)).toBeNull();
  });

  it("AC1: autorizado ⇒ lista os membros da PRÓPRIA org", async () => {
    fetchFalso(() =>
      json([
        { id: "1", email: "ana@galaxie.works", papel: "org_admin" },
        { id: "2", email: "bo@galaxie.works", papel: "member" },
      ]),
    );
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText("ana@galaxie.works")).toBeTruthy(),
    );
    expect(screen.getByText(DICIONARIOS["pt-BR"].papelAdmin)).toBeTruthy();
    expect(screen.getByText(DICIONARIOS["pt-BR"].papelMembro)).toBeTruthy();
  });

  it("AC3: o pedido é escopado na sessão — nenhum id de org na URL", async () => {
    const pedidos = fetchFalso(() => json([]));
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0));

    // Anti-vazio: se a tela parasse de pedir, o `every` abaixo passaria à toa.
    expect(pedidos).toContain(CAMINHOS.membros);
    for (const url of pedidos) {
      expect(url.startsWith("/me/")).toBe(true);
    }
  });

  it("i18n: as duas línguas do DoD renderizam", () => {
    fetchFalso(() => json([]));
    render(<AdminOrgPage idioma="en" />);
    expect(screen.getByText(DICIONARIOS.en.adminOrg)).toBeTruthy();
    cleanup();
    render(<AdminOrgPage idioma="pt-BR" />);
    expect(screen.getByText(DICIONARIOS["pt-BR"].adminOrg)).toBeTruthy();
  });
});
