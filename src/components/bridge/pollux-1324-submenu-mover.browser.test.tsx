// #1324 — o `ScrollArea` do "Mover para pasta…" clipa de verdade?
//
// Eu abri este card durante o #1321 e escrevi, com todas as letras, que **não**
// estava afirmando defeito: a construção é a mesma que eu tinha acabado de
// consertar (`max-h-*` no Root do `ScrollArea`, cujo viewport é `size-full`),
// mas aqui ela vive dentro de um `ContextMenuSub` do Radix, que **pode** estar
// impondo altura por fora. Isto mede, em navegador real, antes de qualquer
// conserto — foi o que o #1260 e a parte A do #1283 me ensinaram.
//
// Precisa de layout REAL: em happy-dom nada tem altura e a medição seria ficção.
import "@/index.css";
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SubmenuMover, type PastaDestino } from "./message-shared";
import { IdiomaProvider, useIdioma } from "@/lib/idioma";

/** Muitas pastas: é o cenário do card ("conta com MUITAS pastas"). */
const PASTAS: PastaDestino[] = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i}`,
  rotulo: `Pasta ${i}`,
  caminho: `Inbox/Pasta ${i}`,
  profundidade: 0,
}));

function Palco() {
  const { t } = useIdioma();
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div data-alvo="1" style={{ width: 300, height: 80, background: "#eee" }}>
          alvo
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <SubmenuMover
          alvos={["m1"]}
          pastas={PASTAS}
          carregando={false}
          onAbrir={() => {}}
          onMover={() => {}}
          t={t}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

async function ate(cond: () => Element | null, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = cond();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

describe("#1324 o scrollbox do 'Mover para pasta…'", () => {
  it("com 60 pastas, o viewport CLIPA e rola (não estica o menu)", async () => {
    render(
      <IdiomaProvider>
        <Palco />
      </IdiomaProvider>
    );
    const alvo = (await ate(() => document.querySelector('[data-alvo="1"]')))!;
    expect(alvo, "o palco não montou").toBeTruthy();

    // abre o menu de contexto e depois o submenu
    await userEvent.click(alvo, { button: "right" });
    const gatilho = await ate(() =>
      document.querySelector('[data-slot="context-menu-sub-trigger"]')
    );
    expect(gatilho, "o gatilho do submenu não apareceu").toBeTruthy();
    await userEvent.hover(gatilho as HTMLElement);

    const viewport = (await ate(() =>
      document.querySelector('[data-slot="scroll-area-viewport"]')
    )) as HTMLElement | null;
    expect(viewport, "o ScrollArea do submenu não montou").toBeTruthy();

    const alturaVisivel = viewport!.clientHeight;
    const alturaConteudo = viewport!.scrollHeight;

    // O card pergunta exatamente isto: `max-h-64` (=16rem=256px) está valendo?
    // Se o viewport crescer com o conteúdo, o menu estica e nada rola — que é o
    // defeito que eu consertei no #1321 nesta mesma construção.
    expect(alturaConteudo).toBeGreaterThan(300); // 60 itens: o conteúdo é grande
    expect(
      alturaVisivel,
      `viewport com ${alturaVisivel}px — o teto de 256px não está clipando`
    ).toBeLessThanOrEqual(300);
  });
});
