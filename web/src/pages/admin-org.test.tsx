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
import { MemoryRouter, Routes, Route } from "react-router-dom";
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

  // ── 401: o defeito que só a borda REAL revelou ───────────────────────────
  // Nenhum duplo devolvia 401, então o 401 caía em `erro`, a descoberta ficava
  // nula, e a tela dizia "organização não identificada" a quem simplesmente
  // **não estava logado**. Achado contra o binário de verdade (#1505 fatia 1),
  // com 54 testes verdes ao lado — verde que não cobre um status não prova nada
  // sobre ele.

  it("401 na descoberta ⇒ vai pro LOGIN, não fala de organização", async () => {
    fetchFalso(() => json({ erro: "nao_autenticado" }, 401));
    render(
      <MemoryRouter initialEntries={["/admin/org"]}>
        <Routes>
          <Route path="/admin/org" element={<AdminOrgPage idioma="pt-BR" />} />
          <Route path="/login" element={<p>TELA DE LOGIN</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("TELA DE LOGIN")).toBeTruthy());
    // A mensagem errada NÃO pode aparecer: ela manda o usuário procurar
    // problema de org quando o problema é ausência de sessão.
    expect(
      screen.queryByText(DICIONARIOS["pt-BR"].orgIndefinida),
    ).toBeNull();
  });

  it("401 num painel (org já conhecida) também vai pro login", async () => {
    fetchFalso(() => json({ erro: "nao_autenticado" }, 401));
    render(
      <MemoryRouter initialEntries={["/admin/org"]}>
        <Routes>
          <Route
            path="/admin/org"
            element={<AdminOrgPage idioma="pt-BR" org="acme" />}
          />
          <Route path="/login" element={<p>TELA DE LOGIN</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("TELA DE LOGIN")).toBeTruthy());
    expect(screen.queryByText(DICIONARIOS["pt-BR"].semPermissao)).toBeNull();
    expect(screen.queryByText(DICIONARIOS["pt-BR"].erroCarregar)).toBeNull();
  });

  // ── Domínios: o painel que o contrato v1.3 destravou ─────────────────────
  // Só `dominios` ganhou shape declarado (`[{ dominio, estado }]`). `settings`
  // diz "mesmo shape do PATCH" — que não declara corpo — e `assinatura` espelha
  // um `PUT` cuja shape nasce com o #1470. Por isso só este painel virou tela.

  it("domínios: renderiza os dois estados que o contrato declara", async () => {
    fetchFalso(() =>
      json([
        { dominio: "acme.com", estado: "verificado" },
        { dominio: "acme.dev", estado: "pendente" },
      ]),
    );
    const { container } = render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    const t = DICIONARIOS["pt-BR"];
    // Vai pra aba de domínios.
    const abaDominios = [...container.querySelectorAll("nav button")].find(
      (b) => b.textContent === t.dominios,
    );
    abaDominios?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => expect(screen.getByText("acme.com")).toBeTruthy());
    expect(screen.getByText(t.verificado)).toBeTruthy();
    expect(screen.getByText(t.pendente)).toBeTruthy();
  });

  it("domínios: lista vazia diz que não há, em vez de tabela vazia", async () => {
    fetchFalso(() => json([]));
    const { container } = render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    const t = DICIONARIOS["pt-BR"];
    [...container.querySelectorAll("nav button")]
      .find((b) => b.textContent === t.dominios)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => expect(screen.getByText(t.semDominios)).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("domínios: 403 e 404 seguem DISTINTOS — a máquina de estados é uma só", async () => {
    // O painel novo reusa `useRecurso`. Se alguém duplicar a máquina, esta
    // asserção é a que cobra: a distinção 403≠404 tem que valer aqui também,
    // sem ninguém ter escrito de novo.
    fetchFalso(() => json({}, 404));
    const { container } = render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    const t = DICIONARIOS["pt-BR"];
    [...container.querySelectorAll("nav button")]
      .find((b) => b.textContent === t.dominios)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => expect(screen.getByText(t.naoEhSuaOrg)).toBeTruthy());
    expect(screen.queryByText(t.semPermissao)).toBeNull();
  });

  // -- 403 `org_suspensa` != 403 `negado` (contrato v1.4, #1544) ------------
  // O servidor gasta uma ordem inteira de checagem (visibilidade -> suspensao ->
  // papel) pra que um membro de org suspensa NAO veja "papel insuficiente". Se
  // o cliente colapsar os dois no mesmo aviso, ele desfaz no ultimo metro a
  // distincao que o servidor fez -- e o resultado pratico e a pessoa pedir a um
  // admin um acesso que nenhum admin pode conceder.

  it("403 `org_suspensa` diz que a ORG esta suspensa, nao que falta papel", async () => {
    fetchFalso(() => json({ erro: "org_suspensa" }, 403));
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    const t = DICIONARIOS["pt-BR"];

    await waitFor(() => expect(screen.getByText(t.orgSuspensa)).toBeTruthy());
    expect(screen.getByText(t.orgSuspensaDetalhe)).toBeTruthy();
    // O mutante que este `queryByText` mata e o colapso: mapear os dois codigos
    // de 403 pro mesmo estado faria a mensagem de papel aparecer aqui.
    expect(screen.queryByText(t.semPermissao)).toBeNull();
    expect(screen.queryByText(t.semPermissaoDetalhe)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("403 `negado` continua na mensagem de PAPEL -- a distincao corta dos dois lados", async () => {
    // Sem esta, um mapeamento invertido (tudo vira `orgSuspensa`) passaria: o
    // teste de cima so cobra uma direcao.
    fetchFalso(() => json({ erro: "negado" }, 403));
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    const t = DICIONARIOS["pt-BR"];

    await waitFor(() => expect(screen.getByText(t.semPermissao)).toBeTruthy());
    expect(screen.queryByText(t.orgSuspensa)).toBeNull();
  });

  it("403 com codigo DESCONHECIDO cai no restritivo, nunca no permissivo", async () => {
    // Condicao (2) do @Altair na v1.4: "desconhecido no FE = neutro, nunca
    // permissivo". Um build velho contra um servidor novo tem que continuar
    // barrando. O que NAO pode acontecer e a tela mostrar dado, ou oferecer
    // "tente de novo" a quem foi negado.
    const corpos = [
      () => json({ erro: "codigo_que_ainda_nao_existe" }, 403),
      () => json({}, 403),
      () => json({ erro: 7 }, 403),
      () => new Response("<!doctype html>", { status: 403 }), // nem JSON e
    ];
    for (const corpo of corpos) {
      cleanup();
      fetchFalso(corpo);
      render(<AdminOrgPage idioma="pt-BR" org="acme" />);
      const t = DICIONARIOS["pt-BR"];
      await waitFor(() => expect(screen.getByText(t.semPermissao)).toBeTruthy());
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByText(t.erroCarregar)).toBeNull();
    }
  });

  it("a suspensao vale nos DOIS paineis -- o aviso mora num ponto so", async () => {
    // Irmao do teste de 403!=404 em dominios. Se alguem voltar a escrever a
    // escada de estados dentro de cada painel, um deles esquece o estado novo --
    // e e este teste que cobra.
    fetchFalso(() => json({ erro: "org_suspensa" }, 403));
    const { container } = render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    const t = DICIONARIOS["pt-BR"];
    [...container.querySelectorAll("nav button")]
      .find((b) => b.textContent === t.dominios)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => expect(screen.getByText(t.orgSuspensa)).toBeTruthy());
    expect(screen.queryByText(t.semPermissao)).toBeNull();
  });

  it("i18n: as duas linguas do DoD renderizam", () => {
    fetchFalso(() => json([]));
    render(<AdminOrgPage idioma="en" org="acme" />);
    expect(screen.getByText(DICIONARIOS.en.adminOrg)).toBeTruthy();
    cleanup();
    render(<AdminOrgPage idioma="pt-BR" org="acme" />);
    expect(screen.getByText(DICIONARIOS["pt-BR"].adminOrg)).toBeTruthy();
  });
});
