// #1060 — regressão do round-trip de foco do Esc no Explorer. O AC: ESC no campo
// de busca LIMPA a busca E devolve o foco ao container da lista (as setas voltam
// a navegar itens, não texto). A navbar cumpre isso chamando `onSairBusca` no
// Escape (o shell liga isso a `listaRef.current?.focus()` — #968/#995). Aqui
// montamos a mesma fiação e travamos: depois do Esc, o foco está na lista.
//
// Roda no vitest (`pnpm test:component`, happy-dom).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";

import { IdiomaProvider } from "@/lib/idioma";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavBarArquivos } from "./navbar";

function Harness({ onLimparBusca }: { onLimparBusca: () => void }) {
  const listaRef = useRef<HTMLDivElement>(null);
  return (
    <IdiomaProvider>
      <TooltipProvider>
      {/* container da lista, foco programático (à moda do content-pane) */}
      <div ref={listaRef} tabIndex={-1} data-testid="lista">
        lista
      </div>
      <NavBarArquivos
        currentPath="C:\\Users\\wagner"
        canBack={false}
        canForward={false}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onUp={vi.fn()}
        onRefresh={vi.fn()}
        onNavegar={vi.fn()}
        buscaAtiva={false}
        onBuscar={vi.fn()}
        onLimparBusca={onLimparBusca}
        onSairBusca={() => listaRef.current?.focus({ preventScroll: true })}
        podeBuscar
        editando={false}
        onEditandoChange={vi.fn()}
      />
      </TooltipProvider>
    </IdiomaProvider>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("#1060 Esc do Explorer devolve o foco à lista", () => {
  it("Esc no campo de busca limpa a busca e foca o container da lista", async () => {
    const user = userEvent.setup();
    const onLimparBusca = vi.fn();
    render(<Harness onLimparBusca={onLimparBusca} />);

    const busca = screen.getByRole("textbox");
    await user.click(busca);
    await user.type(busca, "relatorio");
    expect(document.activeElement).toBe(busca);

    await user.keyboard("{Escape}");

    expect(onLimparBusca).toHaveBeenCalledTimes(1);
    // Round-trip: o foco saiu do input e voltou pro container da lista.
    const lista = screen.getByTestId("lista");
    expect(document.activeElement).toBe(lista);
  });
});
