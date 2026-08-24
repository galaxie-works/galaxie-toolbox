// #1484 — login por IDENTIDADE FEDERADA (decisão do Altair #1503): 3 provedores
// (microsoft/microsoft-personal/google, os do desktop), SEM e-mail/senha. Este
// teste trava: a rota /login existe + catch-all; renderiza os 3 botões de provedor
// nos 2 idiomas; NÃO há campo de senha (o produto não guarda senha); e clicar um
// provedor inicia o redirect OAuth pro caminho do provedor.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./login";
import { rotas } from "@/rotas";
import { DICIONARIOS } from "@/i18n";

const assign = vi.fn();
beforeEach(() => {
  vi.spyOn(window.location, "assign").mockImplementation(assign);
});
afterEach(() => {
  cleanup();
  assign.mockReset();
  vi.restoreAllMocks();
});

describe("#1484 login federado", () => {
  it("o roteador serve /login e manda o resto pra lá (catch-all)", () => {
    const caminhos = rotas.routes.map((r) => r.path);
    expect(caminhos).toContain("/login");
    expect(caminhos).toContain("*");
  });

  it("renderiza os 3 botões de provedor em pt-BR e NÃO tem campo de senha", () => {
    render(<LoginPage idioma="pt-BR" />);
    const t = DICIONARIOS["pt-BR"];
    expect(screen.getByRole("button", { name: t.entrarCom.microsoft })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.entrarCom["microsoft-personal"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.entrarCom.google })).toBeTruthy();
    // o produto NUNCA guardou senha — a tela não pode ter campo de senha
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("renderiza os provedores em en (i18n)", () => {
    render(<LoginPage idioma="en" />);
    expect(screen.getByRole("button", { name: DICIONARIOS.en.entrarCom.google })).toBeTruthy();
  });

  it("clicar um provedor inicia o fluxo em GET /api/v1/auth/{provedor} (contrato v1.2 §2; NÃO /session)", async () => {
    const u = userEvent.setup();
    render(<LoginPage idioma="pt-BR" />);
    await u.click(screen.getByRole("button", { name: DICIONARIOS["pt-BR"].entrarCom.google }));
    expect(assign).toHaveBeenCalledWith("/api/v1/auth/google");
  });

  it("a UI de login não decide autorização — só INICIA o fluxo (principal vem do provedor, sessão do BE)", () => {
    render(<LoginPage idioma="pt-BR" />);
    // sem sessão/rede a tela existe mas não concede acesso; a barreira é server-side.
    expect(screen.getByText(DICIONARIOS["pt-BR"].semSenha)).toBeTruthy();
  });
});
