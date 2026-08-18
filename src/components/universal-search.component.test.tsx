// #1065 (raia Vega): a busca do Bridge foi REMONTADA (OPÇÃO A do Wagner) depois
// que o #876 orfanou o componente ao tirar o mount da title bar. O componente
// (`universal-search.tsx`) sempre esteve intacto — este teste prova que ele
// FUNCIONA: renderiza o input `[data-universal-search-input]` e, ao digitar,
// escreve na store (`busca` no mail). Roda no vitest/happy-dom
// (`pnpm test:component`). O gate estático irmão (lumen-1060) prova que o
// control-room o MONTA — os dois juntos travam o re-orfanamento.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

import { UniversalSearch } from "./universal-search";
import { IdiomaProvider } from "@/lib/idioma";
import { useAppStore } from "@/store";

afterEach(() => {
  cleanup();
  // Não vaza busca entre casos.
  useAppStore.getState().setBusca("");
  useAppStore.getState().setPeopleSearchQuery("");
});

function renderMail() {
  return render(
    <IdiomaProvider>
      <UniversalSearch tela="control-room" screenLabel="Bridge" bridgeView="mail" />
    </IdiomaProvider>,
  );
}

describe("UniversalSearch — remontada no Bridge (#1065)", () => {
  it("monta o input alvo do atalho '/' ([data-universal-search-input])", () => {
    const { container } = renderMail();
    const input = container.querySelector("[data-universal-search-input]");
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).tagName).toBe("INPUT");
  });

  it("digitar no input escreve a query de mail na store (setBusca)", () => {
    const { container } = renderMail();
    const input = container.querySelector(
      "[data-universal-search-input]",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "voaz" } });
    expect(useAppStore.getState().busca).toBe("voaz");
  });
});
