// #991 (correção do Wagner, prints do Windows) — trava a SEPARAÇÃO chevron/label
// da árvore do Explorer:
//   • clicar o CHEVRON = expande/colapsa (dispara onOpenChange do accordion) e NÃO
//     navega (stopPropagation impede o clique de borbulhar pro container);
//   • clicar o LABEL = navega (clique borbulha pro container) e NÃO expande (o
//     label não é gatilho do accordion).
// Antes disso um único clique fazia as duas coisas (árvore sempre abrindo, subpastas
// despejadas inline). O runtime do Explorer é o passe desktop; aqui trava o contrato
// de clique contra regressão.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
} from "@/components/animate-ui/components/radix/files";

function montar(onOpen: () => void, onNav: () => void) {
  return render(
    <Files open={[]} onOpenChange={onOpen}>
      <FolderItem value="/x">
        {/* Mesmo padrão do arvore.tsx: container que navega ao clicar. */}
        <div onClick={onNav}>
          <FolderTrigger expandLabel="expandir">Minha Pasta</FolderTrigger>
        </div>
        <FolderContent>
          <div>filho</div>
        </FolderContent>
      </FolderItem>
    </Files>,
  );
}

describe("#991 árvore do Explorer: chevron expande, label navega", () => {
  it("clicar o CHEVRON expande (onOpenChange) e NÃO navega", () => {
    const onOpen = vi.fn();
    const onNav = vi.fn();
    montar(onOpen, onNav);
    fireEvent.click(screen.getByRole("button", { name: "expandir" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(["/x"]);
    expect(onNav).not.toHaveBeenCalled();
  });

  it("clicar o LABEL navega e NÃO expande", () => {
    const onOpen = vi.fn();
    const onNav = vi.fn();
    montar(onOpen, onNav);
    fireEvent.click(screen.getByText("Minha Pasta"));
    expect(onNav).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
