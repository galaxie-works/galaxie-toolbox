// #1063 (UX11): teste de componente (happy-dom) provando que os 3 estados do
// Explorer (carregando/erro/vazio) — e os 2 da busca — renderizam com o `Empty`
// do registry (data-slot="empty"), em vez dos blocos manuais duplicados de antes.
// Roda no vitest (`pnpm test:component`).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { EstadoConteudoExplorer } from "./estado-conteudo";
import { ResultadosBusca } from "./resultados-busca";
import { IdiomaProvider } from "@/lib/idioma";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(cleanup);

describe("EstadoConteudoExplorer — reusa o Empty do registry (#1063)", () => {
  it("carregando: renderiza um Empty (sem rótulo)", () => {
    const { container } = render(<EstadoConteudoExplorer estado="carregando" />);
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  });

  it("erro: Empty com o rótulo de erro", () => {
    const { container } = render(
      <EstadoConteudoExplorer estado="erro" rotulo="Erro ao ler a pasta" />,
    );
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="empty-title"]')).not.toBeNull();
    expect(screen.getByText("Erro ao ler a pasta")).toBeTruthy();
  });

  it("vazio: Empty com o rótulo de pasta vazia", () => {
    const { container } = render(
      <EstadoConteudoExplorer estado="vazio" rotulo="Pasta vazia" />,
    );
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getByText("Pasta vazia")).toBeTruthy();
  });
});

describe("ResultadosBusca — estados vazio/carregando também via Empty (#1063)", () => {
  const base = {
    query: "foo",
    onAbrir: () => {},
    onFechar: () => {},
    truncado: false,
  };

  it("buscando sem resultados: renderiza Empty", () => {
    const { container } = render(
      <IdiomaProvider>
        <TooltipProvider>
          <ResultadosBusca {...base} resultados={[]} buscando={true} />
        </TooltipProvider>
      </IdiomaProvider>,
    );
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  });

  it("busca sem resultados (terminada): renderiza Empty", () => {
    const { container } = render(
      <IdiomaProvider>
        <TooltipProvider>
          <ResultadosBusca {...base} resultados={[]} buscando={false} />
        </TooltipProvider>
      </IdiomaProvider>,
    );
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  });
});
