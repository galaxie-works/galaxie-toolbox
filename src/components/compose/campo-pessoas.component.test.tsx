// #786: teste de COMPONENTE (happy-dom + @testing-library) do fluxo do compose.
// As funções puras (campo-pessoas-logic) já estão cobertas; aqui exercitamos a
// RENDERIZAÇÃO + a interação (digitar → popup → Enter → chip), travando o
// comportamento correto. Roda no vitest (`pnpm test:component`), não no node --test.
//
// ⚠️ LIMITE conhecido (medido): o happy-dom NÃO reproduz o auto-select/erase do
// Base UI que aparece no NAVEGADOR real — nem com `autoHighlight={true}` o input
// esvazia aqui. Ou seja, este teste trava a lógica/wiring (pega regressão de
// código: aplicar/deveLimparAposAplicar/onKeyDown), mas NÃO é um repro fiel da
// recorrência crônica. Um repro fiel exige vitest browser-mode / Playwright (num
// navegador de verdade). Ver #786 e a discussão na #133.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { IdiomaProvider } from "@/lib/idioma";
import type { Pessoa } from "@/lib/types";

// Simula o Graph retornando um contato "por relevância" pra QUALQUER query —
// inclusive enquanto se digita um endereço externo. Era o gatilho do auto-select
// do Base UI que limpava o input (o repro real da recorrência).
const crPessoasMock = vi.fn<(q: string) => Promise<Pessoa[]>>();
// Mock PARCIAL: mantém os demais exports reais (o grafo do módulo — store/agenda
// — importa `@/lib/api`), sobrescrevendo só a busca de pessoas.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, crPessoas: (q: string) => crPessoasMock(q) };
});

// Fotos: no-op (sem rede/cache no teste).
vi.mock("@/lib/fotos", () => ({
  useFotos: () => ({ getFoto: () => undefined, pedirFotos: () => {} }),
}));

// PersonHoverCard puxa dados/estado que não interessam ao teste do input.
vi.mock("@/components/people/person-hover-card", () => ({
  PersonHoverCard: ({ children }: { children: React.ReactNode }) => children,
}));

import { CampoPessoas } from "./campo-pessoas";

const CONTATO: Pessoa = {
  nome: "Fulano da Silva",
  email: "fulano@contoso.com",
  origem: "organizacao",
} as Pessoa;

function Harness({ onChange }: { onChange?: (v: string[]) => void }) {
  const [valor, setValor] = useState<string[]>([]);
  return (
    <IdiomaProvider>
      <CampoPessoas
        rotulo="Para"
        valor={valor}
        onChange={(v) => {
          setValor(v);
          onChange?.(v);
        }}
      />
    </IdiomaProvider>
  );
}

beforeEach(() => {
  cleanup();
  crPessoasMock.mockReset();
  crPessoasMock.mockResolvedValue([CONTATO]);
});

describe("CampoPessoas — destinatário externo (recorrência #268/#298/#606/#786)", () => {
  it("NÃO apaga o input enquanto digita um e-mail externo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Para") as HTMLInputElement;

    await user.type(input, "externo@cliente.com");

    // Espera o popup do combobox aparecer (debounce + crPessoas + auto-highlight)
    // — é DEPOIS disso que o auto-select do Base UI apagava o input. Sem esperar,
    // o teste passa trivial (as sugestões nem chegaram a abrir).
    await screen.findByText("Fulano da Silva");

    // O bug: o input esvazia. Tem que preservar o endereço digitado.
    expect(input.value).toBe("externo@cliente.com");
  });

  it("Enter transforma o e-mail externo em destinatário (onChange com o endereço)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Para") as HTMLInputElement;

    await user.type(input, "externo@cliente.com");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(["externo@cliente.com"]);
  });
});
