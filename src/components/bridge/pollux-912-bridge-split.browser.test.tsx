// #912 — o splitter do Bridge: existe, e as larguras são em PIXELS.
//
// Guarda por EFEITO e amarrada à grandeza que o card pede. A asserção central é
// a INVARIÂNCIA: a largura do sidebar é a mesma em pixels num grupo de 1200px e
// num de 800px. Uma guarda que só perguntasse "tem painel?" passaria com uma
// porcentagem fixa — que é justamente o jeito errado, porque incharia o sidebar
// junto com a janela e reintroduziria o corte de "Caixa de entrada" que o #466
// resolveu escolhendo 256px a dedo.
//
// Navegador real: largura de painel não existe em happy-dom.
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import {
  BridgeSplit,
  BRIDGE_SIDEBAR_LAYOUT,
  LARGURA_RAIL_PX,
  LARGURA_SIDEBAR_PX,
} from "./bridge-split";
import { chaveLayout } from "@/lib/largura-painel";

async function ate<T extends Element>(busca: () => T | null, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

const painelSidebar = () =>
  document.querySelector<HTMLElement>('[data-panel][data-panel-id="bridge-sidebar"]');

async function montar(larguraGrupoPx: number, colapsada = false) {
  render(
    <div id="palco-1392" style={{ width: larguraGrupoPx, height: 500, display: "flex" }}>
      <BridgeSplit
        colapsada={colapsada}
        onColapsadaMudou={() => {}}
        sidebar={<aside data-teste="sidebar">Caixa de entrada</aside>}
      >
        <div data-teste="conteudo">conteúdo</div>
      </BridgeSplit>
    </div>
  );
  const painel = await ate(painelSidebar);
  expect(painel, "o painel do sidebar não montou").toBeTruthy();
  await new Promise((r) => setTimeout(r, 300));
  return painel!;
}

const px = (el: HTMLElement) => el.getBoundingClientRect().width;

describe("#912 splitter do Bridge", () => {
  beforeEach(() => {
    // `cleanup()` no MEIO de um teste quebra o React (act sobreposto); por isso
    // ele só mora aqui, e cada teste monta uma vez só.
    cleanup();
    localStorage.clear();
  });

  it("existe um handle de arrasto entre sidebar e conteúdo", async () => {
    await montar(1200);
    const handle = document.querySelector('[data-slot="resizable-handle"]');
    expect(handle, "não há splitter entre os painéis").toBeTruthy();
    // E os dois painéis são irmãos dele, não um dentro do outro.
    expect(painelSidebar()).toBeTruthy();
    expect(
      document.querySelector('[data-panel][data-panel-id="bridge-content"]')
    ).toBeTruthy();
  });

  it("o sidebar nasce com a largura do #466 — em PIXELS, não em % da janela", async () => {
    const largura = px(await montar(1200));
    expect(
      Math.abs(largura - LARGURA_SIDEBAR_PX),
      `sidebar nasceu com ${largura.toFixed(1)}px, esperado ~${LARGURA_SIDEBAR_PX}px`
    ).toBeLessThanOrEqual(8);
  });

  it("#1392: numa tela LARGA continua ~256px — onde o clamp percentual mordia", async () => {
    // Esta e a largura que faltava na guarda original. Em 1200 e 800, 256px cai
    // DENTRO da faixa min/max, entao a regua percentual nao aparecia. Em 3000px
    // ela aparecia: o painel ia a 358px (o  de 12%) e, no app real, a
    //  mediu 591px. Escolher so pontos dentro da regiao segura foi o que
    // fez a guarda anterior passar com o defeito vivo.
    const largura = px(await montar(3000));
    expect(
      Math.abs(largura - LARGURA_SIDEBAR_PX),
      `numa tela de 3000px o sidebar deu ${largura.toFixed(1)}px — a regua voltou a ser percentual`
    ).toBeLessThanOrEqual(8);
  });

  it("#1392: MAXIMIZAR a janela nao engorda o sidebar", async () => {
    // Medir no mount bastaria se a janela nunca mudasse. Ela muda — e era af
    // que a fatia calculada pra 1280 continuava valendo.
    await montar(1200);
    const palco = document.getElementById("palco-1392")!;
    palco.style.width = "3000px";
    await new Promise((r) => setTimeout(r, 600));
    const largura = px(painelSidebar()!);
    expect(
      Math.abs(largura - LARGURA_SIDEBAR_PX),
      `depois de maximizar o sidebar foi pra ${largura.toFixed(1)}px`
    ).toBeLessThanOrEqual(8);
  });

  it("a mesma largura num grupo menor — a janela não engorda o sidebar", async () => {
    const largura = px(await montar(800));
    expect(
      Math.abs(largura - LARGURA_SIDEBAR_PX),
      `num grupo de 800px o sidebar deu ${largura.toFixed(1)}px — está seguindo a janela, não os 256px do #466`
    ).toBeLessThanOrEqual(8);
  });

  it("colapsada, o painel encolhe pro rail", async () => {
    const largura = px(await montar(1200, true));
    expect(
      Math.abs(largura - LARGURA_RAIL_PX),
      `colapsada o painel ficou com ${largura.toFixed(1)}px, esperado ~${LARGURA_RAIL_PX}px`
    ).toBeLessThanOrEqual(8);
  });

  it("com layout salvo, a largura default NÃO é aplicada por mim", async () => {
    // Presença basta: quem já arrastou manda, e quem lê o layout é a biblioteca.
    localStorage.setItem(chaveLayout(BRIDGE_SIDEBAR_LAYOUT), "{}");
    const largura = px(await montar(1200));
    // Sem o meu ajuste sobra o `defaultSize` cru, calculado sobre a janela
    // suposta de 1280px — num grupo de 1200 isso dá ~240px, não 256.
    expect(
      Math.abs(largura - LARGURA_SIDEBAR_PX),
      `largura ficou em ${largura.toFixed(1)}px: o ajuste rodou apesar do layout salvo`
    ).toBeGreaterThan(8);
  });
});
