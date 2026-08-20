// #1287: teste de montagem do RootView — a view de tiles genérica das raízes
// semânticas (Cloud/Rede/Acesso rápido). Afirma: título + ícone da raiz, um card
// por item com o ícone que o shell escolheu, clique navega pro `path`, lista
// vazia mostra o rótulo de vazio (sem cards) e item indisponível fica esmaecido.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Cloud, Folder, House, type LucideIcon } from "lucide-react";

import { IdiomaProvider } from "@/lib/idioma";
import { RootView, type ItemRaiz } from "./root-view";

function montar(itens: ItemRaiz[], onNavegar = vi.fn()) {
  render(
    <IdiomaProvider>
      <RootView
        titulo="Acesso rápido"
        icone={House}
        itens={itens}
        vazioLabel="Vazio"
        onNavegar={onNavegar}
      />
    </IdiomaProvider>,
  );
  return onNavegar;
}

const item = (path: string, label: string, Icon: LucideIcon): ItemRaiz => ({
  path,
  label,
  Icon,
});

describe("#1287 RootView", () => {
  it("mostra o título e um card por item", () => {
    montar([
      item("C:/Users/consa", "Início", House),
      item("C:/Users/consa/Downloads", "Downloads", Folder),
    ]);
    expect(screen.getByText("Acesso rápido")).toBeTruthy();
    expect(screen.getByText("Início")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    // Um <button> por item (foco/teclado nativos — o padrão dos cards).
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renderiza o ícone que o shell escolheu para cada item", () => {
    // O RootView é burro: pinta o `Icon` de cada item. A ESCOLHA (Home/pasta
    // conhecida/nuvem) mora no shell; aqui provamos que o prop chega à tela.
    const { container } = render(
      <IdiomaProvider>
        <RootView
          titulo="x"
          icone={House}
          vazioLabel="Vazio"
          onNavegar={vi.fn()}
          itens={[
            item("a", "Início", House),
            item("b", "OneDrive", Cloud),
          ]}
        />
      </IdiomaProvider>,
    );
    // lucide marca cada ícone com a classe `lucide-<nome>`.
    expect(container.querySelector(".lucide-house")).toBeTruthy();
    expect(container.querySelector(".lucide-cloud")).toBeTruthy();
  });

  it("clicar num card navega pro caminho do item", () => {
    const onNavegar = montar([item("C:/Users/consa/Downloads", "Downloads", Folder)]);
    fireEvent.click(screen.getByText("Downloads"));
    expect(onNavegar).toHaveBeenCalledWith("C:/Users/consa/Downloads");
  });

  it("lista vazia mostra o rótulo de vazio e nenhum card", () => {
    montar([]);
    expect(screen.getByText("Vazio")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("item indisponível (atalho de rede offline) fica esmaecido, mas listado", () => {
    const { container } = render(
      <IdiomaProvider>
        <RootView
          titulo="Locais de rede"
          icone={Folder}
          vazioLabel="Vazio"
          onNavegar={vi.fn()}
          itens={[
            { path: "\\\\host\\Eir", label: "Eir", Icon: Folder, indisponivel: true },
          ]}
        />
      </IdiomaProvider>,
    );
    // Continua na lista (nunca some em silêncio — #1288) …
    expect(screen.getByText("Eir")).toBeTruthy();
    // … só marcado: o Card ganha `opacity-60`.
    expect(container.querySelector(".opacity-60")).toBeTruthy();
  });
});
