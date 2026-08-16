// #1062 (UX12) — prova o wiring da animação-no-foco dos ícones da toolbar do
// compose SEM precisar do app/Tauri. Dois elos do end-to-end:
//   (A) o ToolbarButton (base de pen-tool/templates/anexar) REPASSA
//       onFocus/onBlur/onMouseEnter/onMouseLeave pro botão DOM — é o pass-through
//       de que depende o `{...anim}` que penduro no botão.
//   (B) os ícones animados (incl. os 2 novos do #1062) expõem o handle
//       startAnimation/stopAnimation via ref — a ponta que o handler do botão chama.
// Se (A) e (B) valem, focar o botão por Tab dispara a animação (o visual em si é
// confirmado no passe desktop; aqui trava o contrato do wiring contra regressão).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRef } from "react";

import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import { StrikethroughIcon } from "@/components/ui/strikethrough";
import { FileType2Icon } from "@/components/ui/file-type-2";
import { BoldIcon } from "@/components/ui/bold";

describe("#1062: wiring da animação-no-foco da toolbar do compose", () => {
  it("(A) ToolbarButton repassa foco e hover pro botão DOM", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const { getByRole } = render(
      <Toolbar>
        <ToolbarButton
          aria-label="tachado"
          onFocus={onFocus}
          onBlur={onBlur}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <span>x</span>
        </ToolbarButton>
      </Toolbar>
    );
    const botao = getByRole("button", { name: "tachado" });
    fireEvent.focus(botao);
    fireEvent.mouseEnter(botao);
    fireEvent.mouseLeave(botao);
    fireEvent.blur(botao);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("(B) os ícones animados expõem startAnimation/stopAnimation via ref", () => {
    for (const Icon of [StrikethroughIcon, FileType2Icon, BoldIcon]) {
      const ref = createRef<{ startAnimation: () => void; stopAnimation: () => void }>();
      render(<Icon ref={ref} />);
      expect(typeof ref.current?.startAnimation).toBe("function");
      expect(typeof ref.current?.stopAnimation).toBe("function");
      // não deve lançar ao ser dirigido de fora (o que o handler do botão faz)
      expect(() => ref.current?.startAnimation()).not.toThrow();
      expect(() => ref.current?.stopAnimation()).not.toThrow();
    }
  });
});
