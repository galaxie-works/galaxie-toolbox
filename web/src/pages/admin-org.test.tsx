// #1490 — comportamento do admin da org.
//
// O que estes testes provam e o que NÃO provam:
//
// ✅ A metade CLIENTE do AC2: quando o backend nega, a tela não mostra dado
//    nenhum da org — mostra o aviso de sem permissão. Isso é testável sem o BE
//    porque o que se mede é a REAÇÃO da UI a uma negativa, não a negativa.
// ❌ A metade SERVIDOR do AC2/AC3 (o backend negar de fato, o 404 de org
//    alheia): depende da BORDA HTTP (#1505), que ainda não existe — os crates
//    `platform-*` são bibliotecas. Fica aberto e declarado no card; não chamo
//    isto de AC cumprido.
//
// O `fetch` é trocado por um duplo aqui de propósito: quero exercitar a porta
// de rede real (`chamar`), não pular por cima dela. Assim o que os testes medem
// é o que SAIU — a URL de verdade, com prefixo e tudo.
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
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);

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
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
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
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
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
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].erroCarregar)).toBeTruthy(),
    );
    expect(screen.queryByText(DICIONARIOS["pt-BR"].carregando)).toBeNull();
  });

  it("AC1: autorizado ⇒ lista os membros da PRÓPRIA org", async () => {
    fetchFalso(() =>
      json([
        { uid: "1", nome: "Ana", email: "ana@galaxie.works", papel: "org_admin" },
        { uid: "2", nome: "Bo", email: "bo@galaxie.works", papel: "member" },
      ]),
    );
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    await waitFor(() =>
      expect(screen.getByText("ana@galaxie.works")).toBeTruthy(),
    );
    expect(screen.getByText(DICIONARIOS["pt-BR"].papelAdmin)).toBeTruthy();
    expect(screen.getByText(DICIONARIOS["pt-BR"].papelMembro)).toBeTruthy();
  });

  // O nome deste teste era "nenhum id de org na URL" — e envelheceu junto com a
  // minha premissa. O contrato v1 PÕE a org na URL (`/orgs/{org}`), conferida
  // contra a sessão no servidor. O que o cliente pode afirmar não é a ausência
  // do id; é que a rota pedida é **a do contrato**, com o prefixo, e que a org
  // pedida é a que lhe deram — nunca uma que ele escolheu.
  it("pede exatamente a rota do contrato, com prefixo, para a org recebida", async () => {
    const pedidos = fetchFalso(() => json([]));
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0));

    // Anti-vazio: se a tela parasse de pedir, o `for` abaixo passaria à toa.
    expect(pedidos).toContain(`/api/v1${CAMINHOS.membros("acme")}`);
    for (const url of pedidos) {
      expect(url.startsWith("/api/v1/orgs/acme/")).toBe(true);
    }
  });

  it("sem org injetada, DESCOBRE pelo `/me/orgs` — não guarda slug", async () => {
    // A fonte do `{org}` é o servidor, não a memória do cliente: o @Altair criou
    // o `GET /me/orgs` exatamente pra fechar esta lacuna. Guardar um slug vindo
    // de qualquer lugar é o que o invariante 6 impede.
    const pedidos = fetchFalso(() =>
      json([{ org: "acme", papel: "org_admin" }]),
    );
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
    // A PRIMEIRA coisa que a tela faz é perguntar quem ela é.
    expect(pedidos[0]).toBe("/api/v1/me/orgs");
    // E só então endereça a org que o servidor devolveu.
    await waitFor(() =>
      expect(pedidos).toContain(`/api/v1${CAMINHOS.membros("acme")}`),
    );
  });

  it("lista de orgs VAZIA ⇒ a tela diz que não sabe, e não chuta uma org", async () => {
    // O caminho que importa: sem org, nada de `/orgs/...`. Uma tela que
    // "escolhesse" um valor aqui estaria inventando inquilino.
    const pedidos = fetchFalso(() => json([]));
    render(<AdminOrgPage idioma="pt-BR" />);
    await waitFor(() =>
      expect(screen.getByText(DICIONARIOS["pt-BR"].orgIndefinida)).toBeTruthy(),
    );
    expect(pedidos.some((u) => u.includes("/orgs/"))).toBe(false);
  });

  it("i18n: as duas línguas do DoD renderizam", () => {
    fetchFalso(() => json([]));
    render(<AdminOrgPage idioma="en" org="acme" />);
    expect(screen.getByText(DICIONARIOS.en.adminOrg)).toBeTruthy();
    cleanup();
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    expect(screen.getByText(DICIONARIOS["pt-BR"].adminOrg)).toBeTruthy();
  });
});
