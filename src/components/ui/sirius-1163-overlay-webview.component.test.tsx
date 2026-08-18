// #1163 (D1/D2/D4 do desenho do Altair) — trava o mecanismo que esconde a webview
// do Navigator sob os overlays. ANTES disto NÃO havia nenhum teste tocando o
// mecanismo (grep por `OcultarWebview` em *.test.* → nada) e ele regrediu DUAS
// vezes (#275, #1163). Aqui gateamos as três garantias que produzem/impedem a
// tela preta:
//   1. abertura CONTROLADA/PROGRAMÁTICA conta (o Radix não sinaliza por onOpenChange
//      quando o pai controla `open` direto — era a fonte do Furo);
//   2. o contador é aditivo (abre 2, fecha 1 → 1) e clampa em 0;
//   3. DESMONTE com o overlay aberto libera a conta (auto-cura anti-tela-preta).
// E um teste de integração com o `<Dialog>` real prova que o D2 está de fato ligado
// NO primitivo — não só no hook.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";

import { useRegistroOverlayWebview } from "@/lib/navigator-overlay";
import { useAppStore } from "@/store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function conta() {
  return useAppStore.getState().overlaysWebview;
}

/** Consumidor mínimo do hook D2 — `open` controlado pelo pai (como um diálogo). */
function OverlayControlado({ open }: { open: boolean }) {
  useRegistroOverlayWebview(open, undefined);
  return null;
}

beforeEach(() => {
  useAppStore.setState({ overlaysWebview: 0 });
});

describe("#1163 conta de overlays sobre a webview (D2)", () => {
  it("abertura PROGRAMÁTICA (open controlado) conta e some ao fechar", () => {
    const { rerender } = render(<OverlayControlado open={false} />);
    expect(conta()).toBe(0);
    // O pai abre por estado — o Radix NÃO dispara onOpenChange aqui; o efeito do
    // hook é quem pega. Sem isso a webview cortaria o diálogo (o bug do #1163).
    rerender(<OverlayControlado open={true} />);
    expect(conta()).toBe(1);
    rerender(<OverlayControlado open={false} />);
    expect(conta()).toBe(0);
  });

  it("conta é aditiva: abre 2, fecha 1 → 1", () => {
    const a = render(<OverlayControlado open={true} />);
    const b = render(<OverlayControlado open={true} />);
    expect(conta()).toBe(2);
    a.unmount();
    expect(conta()).toBe(1);
    b.unmount();
    expect(conta()).toBe(0);
  });

  it("DESMONTE com o overlay aberto libera a conta (auto-cura, anti-tela-preta)", () => {
    const { unmount } = render(<OverlayControlado open={true} />);
    expect(conta()).toBe(1);
    // O dono some SEM fechar o overlay (chip de aba re-render por timer). Se a conta
    // ficasse presa em 1, a webview ficaria escondida pra sempre — tela preta.
    unmount();
    expect(conta()).toBe(0);
  });

  it("o primitivo <Dialog> real se registra sozinho (D2 ligado no primitivo)", () => {
    const { rerender, unmount } = render(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(conta()).toBe(0);
    rerender(
      <Dialog open={true}>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(conta()).toBe(1);
    unmount();
    expect(conta()).toBe(0);
  });
});
