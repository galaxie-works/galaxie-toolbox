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
import * as api from "@/lib/api";
import * as fotos from "@/lib/fotos";

// O Graph devolve um contato "por relevância" pra QUALQUER query — inclusive
// enquanto se digita um endereço externo. É o gatilho do auto-select do Base UI.
//
// ⚠️ #1267 — NÃO troque isto por `vi.mock("@/lib/api", async (importOriginal) => …)`.
// No browser-mode aquele padrão PENDURA o arquivo pra sempre (>2h no CI; foi o P0
// que travava toda release). É deadlock de CARREGAMENTO de módulo: este arquivo
// importa `campo-pessoas`, que importa o `@/lib/api` MOCKADO; resolver o mock exige
// rodar a factory, que fica esperando o `importOriginal()` do MESMO módulo que já
// está em resolução. Nada roda — nenhuma ação chega ao Playwright, o navegador fica
// ocioso (0% de CPU) e o `testTimeout` NÃO dispara, porque o timer dele também vive
// dentro do browser. Medido: com `importOriginal` >5 min sem sair do lugar; com
// `{ spy: true }` 2,4 s. O irmão happy-dom (`campo-pessoas.component.test.tsx`) pode
// usar `importOriginal` — lá o module runner do vitest resolve; só o browser trava.
// `{ spy: true }` mantém os demais exports REAIS (o grafo do módulo importa o
// `@/lib/api` inteiro) e deixa sobrescrever só a busca de pessoas.
vi.mock("@/lib/api", { spy: true });
// Fotos: no-op (sem rede/cache no teste). Aqui também é `{ spy: true }`, e pelo
// mesmo motivo do `@/lib/api`: factory TOTAL quebra o import (o grafo puxa outros
// exports, ex. `limparFotos`) e `importOriginal` pendura. O no-op vem do
// `mockReturnValue` no `beforeEach`.
vi.mock("@/lib/fotos", { spy: true });
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
  vi.mocked(api.crPessoas).mockReset();
  vi.mocked(api.crPessoas).mockResolvedValue([CONTATO]);
  vi.mocked(fotos.useFotos).mockReturnValue({
    getFoto: () => undefined,
    pedirFotos: () => {},
  });
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
