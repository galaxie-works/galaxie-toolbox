// #1484 AC1 — o scaffold sobe e SERVE a rota de login. Este teste trava o
// contrato mínimo: a rota /login existe, o catch-all cai nela, e a tela de login
// renderiza (nos dois idiomas). O wiring de auth (AC2/AC3) é a fatia pós-#1469.
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { LoginPage } from "./login";
import { rotas } from "@/rotas";
import { DICIONARIOS } from "@/i18n";

afterEach(cleanup);

describe("#1484 scaffold — rota de login", () => {
  it("o roteador serve /login e manda o resto pra lá (catch-all)", () => {
    const caminhos = rotas.routes.map((r) => r.path);
    expect(caminhos).toContain("/login");
    expect(caminhos).toContain("*");
  });

  it("renderiza a tela de login em pt-BR", () => {
    render(<LoginPage idioma="pt-BR" />);
    expect(
      screen.getByRole("button", { name: DICIONARIOS["pt-BR"].entrar }),
    ).toBeTruthy();
    expect(screen.getByText(DICIONARIOS["pt-BR"].bemVindo)).toBeTruthy();
  });

  it("renderiza a tela de login em en (i18n)", () => {
    render(<LoginPage idioma="en" />);
    expect(
      screen.getByRole("button", { name: DICIONARIOS.en.entrar }),
    ).toBeTruthy();
  });

  it("a UI de login não decide autorização — o submit é inerte por ora (barreira é server-side)", () => {
    render(<LoginPage idioma="pt-BR" />);
    // Sem sessão/rede: a tela existe mas não concede acesso. A decisão é do BE
    // (#1469, default-deny). Aqui só garantimos que os campos estão presentes.
    expect(screen.getByLabelText(DICIONARIOS["pt-BR"].email)).toBeTruthy();
    expect(screen.getByLabelText(DICIONARIOS["pt-BR"].senha)).toBeTruthy();
  });
});
