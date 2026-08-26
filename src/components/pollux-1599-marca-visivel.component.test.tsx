// #1599 (re-escopado pela @Mira em 26/08) — ORÁCULO DE RENDERIZAÇÃO.
//
// PORQUE ESTE FICHEIRO EXISTE, e é a lição que o card custou:
// a minha entrega anterior provou o AC por `grep` sobre `src/` e eu chamei-lhe
// "artefato conferido". A @Íris mediu o produto e o nome não aparecia em ecrã
// nenhum: eu tinha editado o rótulo dentro do `Wordmark`, que é CÓDIGO MORTO
// (0 consumidores). A @Lúmen generalizou-o: as guardas que leem por
// `readFileSync` provam *"o nome antigo não está na fonte"*, nunca *"o
// utilizador vê o nome novo"* — matam o mutante na mesma quando ele está em
// código morto.
//
// Este teste faz a pergunta do DOMÍNIO certo: **MONTA** a superfície e lê o
// TEXTO VISÍVEL. Se o `Wordmark` tivesse sido o alvo, este ficheiro não
// conseguiria sequer escrever a asserção — não há o que montar.
//
// DIVISÃO DE TRABALHO, de propósito: o nome ANTIGO não aparece aqui. Quem
// responde "o rótulo velho saiu da fonte" é o `pollux-1599-nome-da-suite.test.ts`
// (varredura de fonte). Este responde "o utilizador vê o novo". Duas perguntas
// diferentes, dois instrumentos diferentes — juntá-las foi o erro de origem.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { IdiomaProvider, preencher } from "@/lib/idioma";
import { DICIONARIOS, type Idioma } from "@/lib/strings";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store";
import { RecursoOrgEmpty } from "@/components/recurso-org-empty";
import { OnboardingEmpresaScreen } from "@/screens/onboarding-empresa";
import type { AppUser } from "@/lib/types";

/** A marca que o utilizador tem de ler. Decisão do PO: a SUITE. */
const SUITE = "The GALAXIE";

// Derivado do dicionário, não escrito à mão: um idioma novo entra coberto em vez
// de entrar esquecido. (À mão eu já tinha escrito `"pt"`, e a chave real é
// `"pt-BR"` — a lista teria ficado a mentir em silêncio.)
const IDIOMAS = Object.keys(DICIONARIOS) as Idioma[];

// `orgStatus: "uncontracted"` é o estado que ABRE este ecrã (#698/PS5: o
// funcionário loga, a empresa ainda não contratou). Com outro valor o `App`
// nem encaminharia para aqui — a fixture tem de ser a do caminho real.
const UTILIZADOR: AppUser = {
  displayName: "Ana Ribeiro",
  email: "ana@exemplo.pt",
  initials: "AR",
  provider: "microsoft",
  accountKind: "work",
  orgStatus: "uncontracted",
  capabilities: ["identity"],
};

function montar(ui: React.ReactNode, idioma: Idioma) {
  useAppStore.setState({ idioma });
  return render(
    <IdiomaProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </IdiomaProvider>,
  );
}

/**
 * O texto que o olho lê, com o espaço em branco NORMALIZADO.
 *
 * 🔑 Medido, e custa uma hora a quem não souber: o onboarding envolve as frases
 * no `SoftBlurIn`, que parte o texto **caractere a caractere** em spans e troca
 * cada espaço por **NBSP** (`U+00A0`) — `soft-blur-in/index.tsx:64`, porque um
 * espaço normal colapsaria dentro de spans inline. O ecrã mostra `The GALAXIE`
 * ao olho e devolve `The GALAXIE` ao `textContent`.
 *
 * Sem esta normalização a asserção falha com "expected 'Your company doesn't use
 * The GALAXIE…' to contain 'The GALAXIE'" — uma mensagem que parece um bug do
 * matcher e é apenas um code point invisível. `\s` do JS já apanha o NBSP.
 */
function visivel(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

afterEach(cleanup);

describe("#1599 — a marca é VISÍVEL nas superfícies que a renderizam", () => {
  beforeEach(() => {
    useAppStore.setState({ idioma: "pt-BR" });
  });

  // A lista de idiomas é derivada; se o dicionário viesse vazio, todo o `it.each`
  // abaixo desapareceria e a suíte ficaria verde por não ter corrido nada.
  it("há idiomas para cobrir (a lista derivada não veio vazia)", () => {
    expect(IDIOMAS.length).toBeGreaterThanOrEqual(2);
  });

  // ── anti-cegueira ────────────────────────────────────────────────────────
  // Sem isto, um render que rebenta (ou um componente que devolve `null`) daria
  // `textContent === ""`, e "" não contém nada de errado — um teste que só
  // proíbe passaria VERDE sobre um ecrã vazio. Empty-por-erro ≠ empty-de-facto.
  it("as superfícies renderizam de facto (senão as asserções seguintes são vácuo)", () => {
    const empty = montar(<RecursoOrgEmpty />, "pt-BR");
    expect(visivel(empty.container).length).toBeGreaterThan(20);
    cleanup();

    const onboarding = montar(
      <OnboardingEmpresaScreen
        user={UTILIZADOR}
        onContinuar={() => {}}
        onSair={() => {}}
      />,
      "pt-BR",
    );
    expect(visivel(onboarding.container).length).toBeGreaterThan(20);
  });

  // ── a fiação: o nome chega por SUBSTITUIÇÃO, não por acaso ───────────────
  // Se o molde perdesse o `{app}`, o nome deixaria de vir da const `APP` e o
  // ecrã passaria a mentir em silêncio no dia seguinte a alguém a mudar.
  it("os moldes i18n declaram o `{app}` — é por lá que a marca entra", () => {
    for (const idioma of IDIOMAS) {
      const d = DICIONARIOS[idioma];
      expect(d.tier.upgradeOrg).toContain("{app}");
      expect(d.onboarding.empresaSemApp).toContain("{app}");
      expect(d.onboarding.empresaSemAppDesc).toContain("{app}");
    }
  });

  // ── AC1/AC2/AC3: o utilizador LÊ "The GALAXIE", nos dois idiomas ─────────
  it.each(IDIOMAS)("empty-state de recurso de org exibe a marca (%s)", (idioma) => {
    const { container } = montar(<RecursoOrgEmpty />, idioma);
    const texto = visivel(container);

    expect(texto).toContain(SUITE);

    // Amarra ao molde REAL do dicionário: se a const `APP` mudar, a frase
    // esperada deixa de bater. É isto que impede o teste de ser satisfeito por
    // um "The GALAXIE" solto em qualquer canto do ecrã.
    expect(texto).toContain(
      preencher(DICIONARIOS[idioma].tier.upgradeOrg, { app: SUITE }),
    );
  });

  it.each(IDIOMAS)("onboarding de empresa exibe a marca (%s)", (idioma) => {
    const { container } = montar(
      <OnboardingEmpresaScreen
        user={UTILIZADOR}
        onContinuar={() => {}}
        onSair={() => {}}
      />,
      idioma,
    );
    const texto = visivel(container);

    expect(texto).toContain(SUITE);
    expect(texto).toContain(
      preencher(DICIONARIOS[idioma].onboarding.empresaSemApp, { app: SUITE }),
    );
    expect(texto).toContain(
      preencher(DICIONARIOS[idioma].onboarding.empresaSemAppDesc, { app: SUITE }),
    );
  });
});
