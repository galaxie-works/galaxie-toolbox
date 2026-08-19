// #1260 — PINA O ESTADO BOM do pirata (Lottie) da aba privada.
//
// Por que existe: o defeito do card ("o pirata não renderiza") apareceu por
// colateral de uma fatia e sumiu por colateral de outra. Ninguém sabe qual
// mudança o causou nem qual o curou — e ele já escapou até uma release (v0.44.0),
// onde quem viu foi o PO, no app, com print. **O canal que falhou foi o olho
// humano em produção.** Este arquivo é a guarda que faltava.
//
// Por que em NAVEGADOR REAL (`.browser.test.tsx`, Playwright/chromium) e não em
// happy-dom: o `lottie-web` injeta o SVG em runtime e mede o container. Em
// happy-dom não há layout nem canvas, e o único teste que hoje encosta em Lottie
// (`sirius-1154-item-unificado-layout.component.test.tsx`) **mocka o `useLottie`
// fora** (`() => ({ View: null })`) — é cego para este defeito por construção.
//
// Escopo deliberado: monto o `PirataIcon`, que é o que o DoD nomeia ("montagem
// do PirataIcon"), e NÃO a tela inteira do Navigator. Importar `navegador.tsx`
// aqui puxaria `@/lib/api` para dentro do browser-mode, que é exatamente o
// deadlock de carregamento do #1267 (>2 h de CI travado). A fidelidade que
// importa — o Lottie montando de verdade — está inteira aqui.
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";

import { PirataIcon } from "@/components/ui/icons/marca/pirata";

/** Espera o `lottie-web` injetar o SVG (ele monta num efeito, não no 1º frame). */
async function esperarSvg(raiz: HTMLElement, limiteMs = 4000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const svg = raiz.querySelector("svg");
    if (svg && svg.querySelectorAll("path").length > 0) return svg;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("o Lottie não injetou SVG com paths dentro do limite");
}

function montar() {
  // O `render` do vitest-browser-react não devolve `container` (a API é por
  // locators de `page`); o componente monta dentro do body real do navegador.
  render(<PirataIcon className="size-10" />);
  return document.body;
}

describe("#1260 PirataIcon (Lottie) monta de verdade", () => {
  it("injeta um SVG com paths — não um container vazio", async () => {
    const svg = await esperarSvg(montar());
    const paths = svg.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    // Path sem geometria desenharia nada e ainda passaria numa contagem crua.
    const comGeometria = [...paths].filter(
      (p) => (p.getAttribute("d") ?? "").length > 10
    );
    expect(comGeometria.length).toBeGreaterThan(0);
  });

  it("ocupa área real na tela (não colapsa para 0×0)", async () => {
    const svg = await esperarSvg(montar());
    const r = svg.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(8);
    expect(r.height).toBeGreaterThan(8);
  });

  it("está visível e pintado — não é um SVG transparente", async () => {
    const svg = await esperarSvg(montar());
    const cs = getComputedStyle(svg);
    expect(cs.visibility).toBe("visible");
    expect(Number(cs.opacity)).toBeGreaterThan(0);

    const path = svg.querySelector("path")!;
    const fill = getComputedStyle(path).fill;
    // O sintoma do card era "o espaço do ícone fica VAZIO": um fill
    // transparente/none produziria exatamente isso, com o SVG presente.
    expect(fill).not.toBe("none");
    expect(fill).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  });

  it("ANIMA — os transforms internos mudam com o tempo", async () => {
    const svg = await esperarSvg(montar());
    const assinatura = () =>
      [...svg.querySelectorAll("g")]
        .map((g) => g.getAttribute("transform") ?? "")
        .join("|");
    const inicial = assinatura();
    expect(inicial.length).toBeGreaterThan(0);

    // O DoD pede "pirata ANIMADO". Presença parada seria meio-conserto, então a
    // guarda tem de morder isso também. Espero até 3 s por uma mudança.
    const fim = Date.now() + 3000;
    let mudou = false;
    while (Date.now() < fim && !mudou) {
      await new Promise((r) => setTimeout(r, 100));
      mudou = assinatura() !== inicial;
    }
    expect(mudou, "os <g> do Lottie não se moveram: animação parada").toBe(true);
  });
});
