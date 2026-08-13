// #786: teste em NAVEGADOR REAL (vitest browser-mode / Playwright chromium) da
// recorrência crônica (#268/#298/#606) — o input do compose APAGA um destinatário
// externo enquanto se digita. Diferente do happy-dom (que NÃO reproduz o
// auto-select/erase do Base UI), o navegador real dispara os eventos de
// foco/ponteiro de verdade → é o repro fiel que trava o fix pra sempre.
// Roda com `pnpm test:browser`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { useState, type ReactNode } from "react";

import { IdiomaProvider } from "@/lib/idioma";
import type { Pessoa } from "@/lib/types";

// O Graph devolve um contato "por relevância" pra QUALQUER query — inclusive
// enquanto se digita um endereço externo. É o gatilho do auto-select do Base UI.
// Tipagem via implementação / cast (sem type-arg em `vi.fn`/`importOriginal`)
// pra não depender da assinatura genérica do vitest entre versões.
const crPessoasMock = vi.fn(async (_q: string): Promise<Pessoa[]> => []);
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/api");
  return { ...actual, crPessoas: (q: string) => crPessoasMock(q) };
});
vi.mock("@/lib/fotos", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/fotos");
  return {
    ...actual,
    useFotos: () => ({ getFoto: () => undefined, pedirFotos: () => {} }),
  };
});
vi.mock("@/components/people/person-hover-card", () => ({
  PersonHoverCard: ({ children }: { children: ReactNode }) => children,
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
  crPessoasMock.mockReset();
  crPessoasMock.mockResolvedValue([CONTATO]);
});

describe("CampoPessoas (navegador real) — destinatário externo #786", () => {
  it("NÃO apaga o input ao digitar um e-mail externo com o popup aberto", async () => {
    render(<Harness />);
    const input = page.getByLabelText("Para");

    await userEvent.type(input, "externo@cliente.com");
    // Espera o popup do combobox (debounce + crPessoas + auto-highlight) — é
    // DEPOIS disso que o auto-select do Base UI apagava o input.
    await expect.element(page.getByText("Fulano da Silva")).toBeVisible();

    await expect.element(input).toHaveValue("externo@cliente.com");
  });

  it("Enter transforma o e-mail externo em destinatário", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = page.getByLabelText("Para");

    await userEvent.type(input, "externo@cliente.com");
    await expect.element(page.getByText("Fulano da Silva")).toBeVisible();
    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(["externo@cliente.com"]);
  });
});
