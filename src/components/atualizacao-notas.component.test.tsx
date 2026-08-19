// #1321 — teste-que-reproduz: notas longas estouravam o modal e o Markdown
// aparecia cru. Os dois defeitos vieram da MINHA fatia do #1258.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Preserva o módulo real e troca SÓ o `openUrl` — mockar `@/lib/api` inteiro
// derruba o store (`agenda-slice` importa `crAgenda` daqui).
vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openUrl: vi.fn(),
}));

import { ScrollArea } from "@/components/ui/scroll-area";
import { NotasRelease } from "@/components/notas-release";

/** Mesma composição do modal (`atualizacao.tsx`), isolada do gate `estaNoTauri`. */
function Bloco({ markdown }: { markdown: string }) {
  return (
    <ScrollArea className="w-full rounded-lg border bg-background/60 p-3 **:data-[slot=scroll-area-viewport]:max-h-40">
      <NotasRelease markdown={markdown} />
    </ScrollArea>
  );
}

const LONGO = Array.from({ length: 100 }, (_, i) => `- linha ${i}`).join("\n");

describe("#1321 o scrollbox das notas", () => {
  it("põe o teto de altura no VIEWPORT, não no Root (o defeito de origem)", () => {
    const { container } = render(<Bloco markdown={LONGO} />);
    const root = container.querySelector('[data-slot="scroll-area"]')!;

    // ATENÇÃO ao que este teste pode e não pode afirmar: `**:data-[...]` é
    // VARIANTE do Tailwind — a classe fica no Root e o CSS gerado aplica o
    // `max-height` no viewport. Ela não é copiada para o elemento filho, e
    // neste harness não há CSS carregado, então altura computada não é
    // observável aqui (o pixel é da `iris`, QA-V).
    // O que ESTE teste trava é o contrato que regrediu na v0.46.0: o teto tem
    // de estar MIRANDO o viewport, e não solto no Root.
    expect(root.className).toContain("data-[slot=scroll-area-viewport]:max-h-40");
    expect(root.className).not.toMatch(/(^|\s)max-h-40(\s|$)/);
  });

  it("100 linhas continuam todas no DOM (rola, não corta conteúdo)", () => {
    render(<Bloco markdown={LONGO} />);
    expect(screen.getByText("linha 0")).toBeTruthy();
    expect(screen.getByText("linha 99")).toBeTruthy();
  });
});

describe("#1321 o Markdown das notas", () => {
  it("`##` vira heading e não aparece literal", () => {
    render(<NotasRelease markdown="## 🪟 Janela" />);
    expect(screen.getByRole("heading").textContent).toContain("Janela");
    expect(screen.queryByText(/##/)).toBeNull();
  });

  it("`**` vira <strong> e não aparece literal", () => {
    const { container } = render(<NotasRelease markdown="- **Minimizar** voltou" />);
    expect(container.querySelector("strong")?.textContent).toBe("Minimizar");
    expect(container.textContent).not.toContain("**");
  });

  it("`- ` vira item de lista", () => {
    const { container } = render(<NotasRelease markdown={"- um\n- dois"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("HTML do feed NÃO vira elemento — chega como texto", () => {
    const { container } = render(<NotasRelease markdown="<img src=x onerror=alert(1)>" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("link http vira <a>; `javascript:` não vira link nenhum", () => {
    const { container: bom } = render(<NotasRelease markdown="[docs](https://galaxie.works)" />);
    expect(bom.querySelector("a")?.getAttribute("href")).toBe("https://galaxie.works");

    const { container: mau } = render(<NotasRelease markdown="[x](javascript:alert(1))" />);
    expect(mau.querySelector("a")).toBeNull();
  });

  it("notas vazias não renderizam bloco nenhum", () => {
    const { container } = render(<NotasRelease markdown="   " />);
    expect(container.firstChild).toBeNull();
  });
});
