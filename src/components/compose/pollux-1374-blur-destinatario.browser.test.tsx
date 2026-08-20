// #1374 (4ª volta de #268/#606/#786) — SAIR DO CAMPO não pode perder o que foi
// digitado.
//
// Este arquivo nasceu como sonda: a guarda do #786 estava VERDE e o bug voltou,
// então fui procurar o caminho que ela não cobre. Ela testa digitar + Enter, e
// sempre com UM contato voltando do Graph (que responde "por relevância" a
// qualquer query). Faltavam duas coisas: nenhuma sugestão, e sair do campo.
//
// O que a medição achou, em navegador real:
//   • digitar sem sugestão nenhuma, sem sair: o texto FICA (caso A);
//   • digitar e sair com Tab: o texto SOME — nem vira chip, nem permanece.
//     Estado medido depois do Tab: input vazio e ZERO chamadas de onChange.
//
// Por isso o caso A continua aqui: ele é o controle. Se um dia o defeito voltar
// pelo caminho da digitação, é o A que cai — e a diferença entre A e C diz na
// hora QUAL dos dois caminhos quebrou.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { useState, type ReactNode } from "react";

import { IdiomaProvider } from "@/lib/idioma";
import type { Pessoa } from "@/lib/types";
import * as api from "@/lib/api";
import * as fotos from "@/lib/fotos";

vi.mock("@/lib/api", { spy: true });
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
      <>
        <CampoPessoas
          rotulo="Para"
          valor={valor}
          onChange={(v) => {
            setValor(v);
            onChange?.(v);
          }}
        />
        <button type="button">fora</button>
      </>
    </IdiomaProvider>
  );
}

beforeEach(() => {
  vi.mocked(api.crPessoas).mockReset();
  vi.mocked(fotos.useFotos).mockReturnValue({
    getFoto: () => undefined,
    pedirFotos: () => {},
  });
});

describe("#1374 — sair do campo não perde o destinatário digitado", () => {
  it("A) sem sugestão e sem sair do campo, o texto FICA (controle)", async () => {
    vi.mocked(api.crPessoas).mockResolvedValue([]);
    render(<Harness />);
    const input = page.getByLabelText("Para");

    await userEvent.type(input, "externo@cliente.com");
    await new Promise((r) => setTimeout(r, 900)); // debounce + resposta vazia

    await expect.element(input).toHaveValue("externo@cliente.com");
  });

  it("B) com sugestão, sair do campo commita o e-mail externo", async () => {
    vi.mocked(api.crPessoas).mockResolvedValue([CONTATO]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = page.getByLabelText("Para");

    await userEvent.type(input, "externo@cliente.com");
    await expect.element(page.getByText("Fulano da Silva")).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await new Promise((r) => setTimeout(r, 500));

    // O que importa é não PERDER o que foi digitado: ou virou chip, ou o texto
    // continua no input. Sumir das duas formas é o defeito do card.
    const virouChip = onChange.mock.calls.some(
      ([v]) => Array.isArray(v) && v.includes("externo@cliente.com"),
    );
    const aindaNoInput =
      (await page.getByLabelText("Para").element()).getAttribute("value") ===
        "externo@cliente.com" ||
      (page.getByLabelText("Para").element() as HTMLInputElement).value ===
        "externo@cliente.com";
    expect(
      virouChip || aindaNoInput,
      "o e-mail digitado sumiu no blur: não virou chip e não ficou no input",
    ).toBe(true);
  });

  it("C) sem sugestão, sair do campo commita — o pior caso do relato", async () => {
    vi.mocked(api.crPessoas).mockResolvedValue([]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = page.getByLabelText("Para");

    await userEvent.type(input, "externo@cliente.com");
    await new Promise((r) => setTimeout(r, 900));
    await userEvent.keyboard("{Tab}");
    await new Promise((r) => setTimeout(r, 500));

    const virouChip = onChange.mock.calls.some(
      ([v]) => Array.isArray(v) && v.includes("externo@cliente.com"),
    );
    const aindaNoInput =
      (page.getByLabelText("Para").element() as HTMLInputElement).value ===
      "externo@cliente.com";
    expect(
      virouChip || aindaNoInput,
      "sem sugestão e saindo do campo, o e-mail sumiu",
    ).toBe(true);
  });
});
