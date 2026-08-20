// #1290 — o sino da central de status tem tooltip, e ele diz a mesma coisa que
// o leitor de tela ouve.
//
// Precisa de navegador real: tooltip nasce de `pointerover` de VERDADE e o
// conteúdo vai pra um portal. Em happy-dom eu estaria testando o meu mock de
// hover, não o componente.
import "@/index.css";
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { ActivityDropdown } from "./activity-dropdown";
import type { OpAtiva } from "./progresso-panel";

/** Uma op concluída basta: o sino só aparece quando há atividade. */
function op(opId: number): OpAtiva {
  return {
    opId,
    tipo: "copy",
    velocidade: 0,
    destino: "Destino",
    progresso: {
      opId,
      processedBytes: 10,
      totalBytes: 10,
      percent: 100,
      etaMs: null,
      filesTotal: 1,
      filesDone: 1,
      bytesPerSec: 0,
      verifying: false,
      done: true,
      canceled: false,
      error: null,
      opKind: "copy",
      phase: "done",
      status: "success",
      currentFile: null,
      startedAtMs: 1_000,
      completedAtMs: 2_000,
    },
  };
}

function Palco({ ops }: { ops: OpAtiva[] }) {
  return (
    <IdiomaProvider>
      <TooltipProvider>
        <ActivityDropdown
          ops={ops}
          agoraMs={3_000}
          onCancelar={() => {}}
          onPausar={() => {}}
          onResumir={() => {}}
          onDispensar={() => {}}
          onDesfazer={() => {}}
          desfeitos={new Set()}
          onLimparConcluidas={() => {}}
        />
      </TooltipProvider>
    </IdiomaProvider>
  );
}

async function ate<T extends Element>(busca: () => T | null, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe("#1290 tooltip do sino", () => {
  it("hover no sino abre tooltip com o MESMO texto do aria-label", async () => {
    render(<Palco ops={[op(1)]} />);

    const sino = (await ate(() =>
      document.querySelector<HTMLButtonElement>("button[aria-label]")
    ))!;
    expect(sino, "o sino não montou").toBeTruthy();
    const rotulo = sino.getAttribute("aria-label")!;
    expect(rotulo, "o rótulo do sino ficou vazio").toBeTruthy();

    // Antes do hover não pode haver tooltip aberto (senão o teste passaria por
    // acidente, medindo uma caixa que já estava lá).
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    await userEvent.hover(sino);

    const caixa = (await ate(() =>
      document.querySelector('[data-slot="tooltip-content"]')
    )) as HTMLElement | null;
    expect(caixa, "hover no sino não abriu tooltip nenhum").toBeTruthy();
    expect(caixa!.textContent?.trim()).toBe(rotulo);
    // Mesmo lado dos vizinhos de chrome (a title bar é o topo da tela).
    expect(caixa!.closest("[data-side]")?.getAttribute("data-side") ?? caixa!.getAttribute("data-side")).toBe("bottom");
  });

  it("o rótulo conta as não-vistas — 2 ops = '2 novas'", async () => {
    render(<Palco ops={[op(10), op(11)]} />);
    const sino = (await ate(() =>
      document.querySelector<HTMLButtonElement>("button[aria-label]")
    ))!;
    // A string é "Central de status — {n} novas": o número tem de estar lá.
    expect(sino.getAttribute("aria-label")).toContain("2");
  });
});
