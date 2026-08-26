// #1599 — A MARCA CHEGA AO ECRÃ. Navegador real, estilo COMPUTADO.
//
// Este ficheiro existe por causa de um achado do Codex na PR #1624, e o achado é
// a continuação exata do defeito que pôs o card em `Rejected`:
//
//   "quando a marca fica no DOM mas escondida por CSS, ou a animação de
//    revelação nunca corre, o `textContent` continua a contê-la e todas as
//    asserções passam."
//
// É verdade, e é grave aqui em particular: o `SoftBlurIn` renderiza cada
// caractere a `opacity: 0` e só depois anima para 1. O irmão deste ficheiro
// (`.component.test.tsx`, happy-dom) prova DOM + nome acessível + fiação, e diz
// por escrito que NÃO prova pixel — o `happy-dom` não faz layout, portanto
// `opacity` computada nem existe lá.
//
// Aqui há chromium a sério: espero a animação ASSENTAR e leio a `opacity`
// computada. Se a transição partir e o utilizador ficar sem marca, este teste
// cai — que é precisamente o que o outro não consegue fazer.
import "@/index.css";
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { OnboardingEmpresaScreen } from "@/screens/onboarding-empresa";
import type { AppUser } from "@/lib/types";

const SUITE = "The GALAXIE";

const UTILIZADOR: AppUser = {
  displayName: "Ana Ribeiro",
  email: "ana@exemplo.pt",
  initials: "AR",
  provider: "microsoft",
  accountKind: "work",
  orgStatus: "uncontracted",
  capabilities: ["identity"],
};

/** Espera uma condição, com teto — teste que PENDURA é pior que teste que falha. */
async function ate<T>(busca: () => T | null, ms = 8000): Promise<T | null> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const v = busca();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

/**
 * O elemento que contém a marca, procurado pelo `aria-label` do `SoftBlurIn`.
 *
 * O texto está partido caractere a caractere em spans `aria-hidden`, então não
 * há um nó de texto com "The GALAXIE" inteiro — a âncora tem de ser o wrapper.
 */
function wrapperDaMarca(): HTMLElement | null {
  const todos = Array.from(document.querySelectorAll<HTMLElement>("[aria-label]"));
  return todos.find((el) => (el.getAttribute("aria-label") ?? "").includes(SUITE)) ?? null;
}

describe("#1599 no navegador — a marca fica VISÍVEL depois da animação", () => {
  it("os caracteres da marca assentam com opacity > 0 (a revelação corre mesmo)", async () => {
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <OnboardingEmpresaScreen
            user={UTILIZADOR}
            onContinuar={() => {}}
            onSair={() => {}}
          />
        </TooltipProvider>
      </IdiomaProvider>,
    );

    const wrapper = await ate(wrapperDaMarca);
    expect(
      wrapper,
      "não achei wrapper com `aria-label` a conter a marca — ou o ecrã não " +
        "renderizou, ou o `SoftBlurIn` deixou de expor nome acessível",
    ).toBeTruthy();

    // Os spans por caractere são o que o olho vê. Basta um assentar opaco para
    // provar que a animação CORREU; se a transição partir, ficam todos a 0.
    const spans = Array.from(wrapper!.querySelectorAll<HTMLElement>("span"));
    expect(
      spans.length,
      "o wrapper não tem spans por caractere — o `SoftBlurIn` mudou de forma e " +
        "esta asserção passou a medir outra coisa",
    ).toBeGreaterThan(SUITE.length);

    const opaco = await ate(() => {
      const visiveis = spans.filter(
        (s) => Number.parseFloat(getComputedStyle(s).opacity || "0") > 0.9,
      );
      return visiveis.length > 0 ? visiveis.length : null;
    });

    expect(
      opaco,
      "os caracteres da marca continuam a `opacity: 0` depois de esperar a " +
        "animação: o nome ESTÁ no DOM e o utilizador NÃO o vê — que é " +
        "exatamente o defeito deste card, uma camada abaixo",
    ).toBeTruthy();
  });

  it("a marca não está escondida por `display`/`visibility`", async () => {
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <OnboardingEmpresaScreen
            user={UTILIZADOR}
            onContinuar={() => {}}
            onSair={() => {}}
          />
        </TooltipProvider>
      </IdiomaProvider>,
    );

    const wrapper = await ate(wrapperDaMarca);
    expect(wrapper).toBeTruthy();

    // Sobe a árvore: basta um ancestral escondido para o utilizador não ver nada.
    for (let el: HTMLElement | null = wrapper; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      expect(s.display, `\`display:none\` em <${el.tagName.toLowerCase()}>`).not.toBe("none");
      expect(s.visibility, `\`visibility:hidden\` em <${el.tagName.toLowerCase()}>`).not.toBe(
        "hidden",
      );
    }

    // E o elemento ocupa área: `getBoundingClientRect` só é real em navegador.
    const caixa = wrapper!.getBoundingClientRect();
    expect(caixa.width, "o wrapper da marca tem largura 0 — não ocupa ecrã").toBeGreaterThan(0);
    expect(caixa.height, "o wrapper da marca tem altura 0 — não ocupa ecrã").toBeGreaterThan(0);
  });
});
