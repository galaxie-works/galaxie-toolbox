// #1290 — a fileira de chrome da title bar: ordem e estabilidade.
//
// O PO pediu `sino · favoritos · histórico · paleta · tema · avatar`. Três
// guardas, cada uma com o alcance que ela realmente tem — digo qual é qual em
// vez de fingir que todas medem a mesma coisa:
//
//  1. ORDEM ENTRE OS TRÊS ÍCONES — DOM real, componente real (`ChromeNavegador`).
//  2. ORDEM NO `App.tsx` — leitura do FONTE. Montar o `App` pediria login e
//     webviews nativas; então guardo a ordem dos quatro marcadores no arquivo.
//     É guarda de segunda classe e está aqui rotulada como tal: pega quem
//     reordenar a fileira, não pega quem quebrar o CSS.
//  3. ESTABILIDADE quando o sino some (AC 3) — DOM real e medida de verdade,
//     com as classes do cluster LIDAS DO PRÓPRIO `App.tsx`: se alguém tirar o
//     `shrink-0` de lá, esta medição muda junto. Sem cópia que envelhece.
import "@/index.css";
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { ChromeNavegador } from "./chrome-navegador";
import fonteApp from "../App.tsx?raw";

async function ate<T extends Element>(busca: () => T | null, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe("#1290 fileira de chrome da title bar", () => {
  it("os três ícones do Navigator saem na ordem favoritos · histórico · paleta", async () => {
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <ChromeNavegador
            mostrarBarraFav={false}
            onAlternarBarraFav={() => {}}
            historicoAberto={false}
            onAlternarHistorico={() => {}}
            onAbrirPaleta={() => {}}
          />
        </TooltipProvider>
      </IdiomaProvider>
    );
    await ate(() => document.querySelector("button[aria-label]"));
    const rotulos = [...document.querySelectorAll("button[aria-label]")].map(
      (b) => b.getAttribute("aria-label")!
    );
    expect(rotulos).toHaveLength(3);
    // Não fixo o texto (é i18n): fixo QUEM é quem pelo ícone que cada um carrega.
    const icones = [...document.querySelectorAll("button[aria-label] svg")].map(
      (svg) => svg.getAttribute("class") ?? ""
    );
    expect(icones).toHaveLength(3);
    const [b1, b2, b3] = [...document.querySelectorAll("button[aria-label]")];
    expect(b1.querySelector(".lucide-bookmark"), "1º não é o favoritos").toBeTruthy();
    expect(b2.querySelector(".lucide-history"), "2º não é o histórico").toBeTruthy();
    expect(b3.querySelector(".lucide-command"), "3º não é a paleta").toBeTruthy();
  });

  it("no App.tsx o sino vem ANTES do slot, e o slot antes de tema e avatar", () => {
    const pos = (marcador: string) => {
      const i = fonteApp.indexOf(marcador);
      expect(i, `não achei "${marcador}" no App.tsx`).toBeGreaterThan(-1);
      return i;
    };
    const sino = pos("<ActivityDropdown");
    const slot = pos("ref={setChromeSlot}");
    const tema = pos("<ThemeToggle");
    const avatar = pos("<MenuUsuario");
    expect(sino).toBeLessThan(slot);
    expect(slot).toBeLessThan(tema);
    expect(tema).toBeLessThan(avatar);
  });

  it("o sino sumindo NÃO desloca tema e avatar (AC 3, medido)", async () => {
    // As classes vêm do fonte: o cluster de chrome é o `div` que tem o
    // `pr-[140px]` (a faixa dos controles de janela). Se ele mudar, muda aqui.
    const m = fonteApp.match(/className="([^"]*pr-\[140px\][^"]*)"/);
    expect(m, "não achei o cluster de chrome no App.tsx").toBeTruthy();
    const classesCluster = m![1];

    const palco = document.createElement("div");
    palco.style.width = "900px";
    palco.className = "flex h-11 items-stretch";
    palco.innerHTML = `
      <div class="flex min-w-0 flex-1 items-stretch"></div>
      <div class="${classesCluster}">
        <span data-p="sino" class="size-8"></span>
        <span data-p="tema" class="size-8"></span>
        <span data-p="avatar" class="size-8"></span>
      </div>`;
    document.body.append(palco);
    try {
      const x = (p: string) =>
        palco
          .querySelector<HTMLElement>(`[data-p="${p}"]`)!
          .getBoundingClientRect().x;
      const temaCom = x("tema");
      const avatarCom = x("avatar");

      palco.querySelector('[data-p="sino"]')!.remove();
      const temaSem = x("tema");
      const avatarSem = x("avatar");

      expect(
        temaSem,
        `tema andou ${temaSem - temaCom}px quando o sino sumiu`
      ).toBe(temaCom);
      expect(avatarSem).toBe(avatarCom);
    } finally {
      palco.remove();
    }
  });
});
