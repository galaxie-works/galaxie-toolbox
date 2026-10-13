// #1484 + contrato #1734 (Alcor; desenho aprovado pelo @Altair) — aviso de login
// falhado. Trava as 2 condições do Altair que moram no FE:
//  1. texto FIXO do i18n — NADA da query é renderizado (qualquer um monta o link);
//  2. o parâmetro sai da URL depois de lido (`history.replaceState`).
// E o caminho até a tela: `/?login=falhou` → `/login` com o sinal; `/` puro → `/conta`
// (antes, o catch-all descartava a query e mandava o recém-logado ao `/login`).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { LoginPage } from "./login";
import { RaizPage } from "./raiz";
import { rotas } from "@/rotas";
import { DICIONARIOS } from "@/i18n";
import { lerLoginFalhou, semLoginFalhou } from "@/lib/login-falhou";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("contrato #1734 — lerLoginFalhou / semLoginFalhou", () => {
  it.each([
    ["?login=falhou", true],
    ["?x=1&login=falhou", true],
    ["", false],
    ["?login=ok", false],
    ["?login=FALHOU", false],
    ["?falhou", false],
  ])("lerLoginFalhou(%j) === %s (só o valor exato do contrato)", (search, esperado) => {
    expect(lerLoginFalhou(search)).toBe(esperado);
  });

  it("semLoginFalhou tira só o `login` e preserva o resto", () => {
    expect(semLoginFalhou("http://localhost/login?login=falhou")).toBe("/login");
    expect(semLoginFalhou("http://localhost/login?x=1&login=falhou#h")).toBe("/login?x=1#h");
  });
});

describe("LoginPage — aviso de login falhado", () => {
  it.each(["pt-BR", "en"] as const)("com ?login=falhou mostra o aviso FIXO do i18n (%s)", (idioma) => {
    window.history.replaceState(null, "", "/login?login=falhou");
    render(<LoginPage idioma={idioma} />);
    const t = DICIONARIOS[idioma];
    expect(screen.getByRole("status", { name: t.loginFalhou })).toBeTruthy();
    expect(screen.getByText(t.loginFalhouDetalhe)).toBeTruthy();
  });

  it("NÃO renderiza nada da query — qualquer um monta o link (condição 1 do Altair)", () => {
    window.history.replaceState(null, "", "/login?login=falhou&msg=%3Cb%3EPAGUE-AQUI%3C%2Fb%3E");
    const { container } = render(<LoginPage idioma="pt-BR" />);
    expect(container.textContent).not.toContain("PAGUE-AQUI");
    expect(container.innerHTML).not.toContain("<b>");
  });

  it("tira o parâmetro da URL depois de ler, e o aviso FICA (condição 2 do Altair)", () => {
    window.history.replaceState(null, "", "/login?login=falhou");
    render(<LoginPage idioma="pt-BR" />);
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("status", { name: DICIONARIOS["pt-BR"].loginFalhou })).toBeTruthy();
  });

  it("sem o sinal: nenhum aviso e a URL fica como está", () => {
    window.history.replaceState(null, "", "/login?x=1");
    render(<LoginPage idioma="pt-BR" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.location.search).toBe("?x=1");
  });
});

describe("RaizPage — `/` é o destino do callback OAuth", () => {
  function montar(entrada: string) {
    const router = createMemoryRouter(
      [
        { path: "/", element: <RaizPage /> },
        { path: "/login", element: <div>TELA LOGIN</div> },
        { path: "/conta", element: <div>TELA CONTA</div> },
      ],
      { initialEntries: [entrada] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it("falha (`/?login=falhou`) → /login levando SÓ o sinal canônico", async () => {
    const r = montar("/?login=falhou&msg=x");
    expect(await screen.findByText("TELA LOGIN")).toBeTruthy();
    expect(r.state.location.pathname).toBe("/login");
    expect(r.state.location.search).toBe("?login=falhou");
  });

  it("sucesso (`/`) → /conta — o recém-logado não volta pro /login", async () => {
    const r = montar("/");
    expect(await screen.findByText("TELA CONTA")).toBeTruthy();
    expect(r.state.location.pathname).toBe("/conta");
  });

  it("o roteador REAL serve `/` com a RaizPage (não cai no catch-all, que descarta a query)", () => {
    const raiz = rotas.routes.find((r) => r.path === "/");
    expect(raiz, "o roteador perdeu a rota `/`").toBeTruthy();
    expect((raiz!.element as { type?: unknown } | undefined)?.type).toBe(RaizPage);
  });
});
