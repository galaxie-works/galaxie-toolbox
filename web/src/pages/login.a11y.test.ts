// #1484 — os 2 bloqueantes da QA-V (@Íris, 13/10) no próprio login: o idioma
// DECLARADO da página (WCAG 3.1.1) e o contraste do rodapé de segurança (WCAG 1.4.3).
//
// Mesmo desenho do `alerta.contrast.test.ts`: os oráculos LEEM A FONTE, então se
// alguém trocar a cor ou tirar a chamada, o teste re-mede e morre. Cada guarda tem
// um sentinela que prova que ela MORDE no valor pré-fix (senão podia passar por
// acidente e não provar nada).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aplicarIdiomaNoDocumento } from "@/i18n";

const LOGIN = readFileSync(join(process.cwd(), "src", "pages", "login.tsx"), "utf8");
const MAIN = readFileSync(join(process.cwd(), "src", "main.tsx"), "utf8");

// Neutros do Tailwind v4 são `oklch(L 0 0)`. Com croma 0 o oklch é acromático:
// r=g=b em sRGB linear valem exatamente L³, logo a luminância relativa É L³ — não
// precisa da matriz completa do `alerta.contrast.test.ts`. Revalidar se a paleta
// mudar de major.
const NEUTRAL_L: Record<string, number> = {
  "neutral-400": 0.708,
  "neutral-500": 0.556,
  "neutral-600": 0.439,
};
const contrasteSobreBranco = (L: number): number => (1 + 0.05) / (L ** 3 + 0.05);

describe("#1484 a11y — idioma do documento (WCAG 3.1.1)", () => {
  afterEach(() => {
    document.documentElement.lang = "";
  });

  it.each(["en", "pt-BR"] as const)(
    "aplicarIdiomaNoDocumento('%s') declara esse idioma no <html>",
    (idioma) => {
      aplicarIdiomaNoDocumento(idioma);
      expect(document.documentElement.lang).toBe(idioma);
    },
  );

  it("o main.tsx aplica o idioma ativo ANTES do render (a função está fiada, não só existe)", () => {
    const chamada = MAIN.indexOf("aplicarIdiomaNoDocumento(idiomaAtual())");
    const render = MAIN.indexOf("createRoot(");
    expect(chamada, "main.tsx não chama aplicarIdiomaNoDocumento(idiomaAtual())").toBeGreaterThan(-1);
    expect(render, "main.tsx perdeu o createRoot").toBeGreaterThan(-1);
    expect(chamada, "a chamada tem de vir antes do createRoot").toBeLessThan(render);
  });
});

describe("#1484 a11y — contraste do rodapé de segurança do login (WCAG 1.4.3 AA)", () => {
  // A classe REAL do parágrafo que renderiza `t.semSenha`.
  const p = /<p className="([^"]+)">\{t\.semSenha\}<\/p>/.exec(LOGIN);

  it("o rodapé fica ≥ 4.5:1 sobre o fundo branco da seção", () => {
    expect(p, "não achei o <p> do t.semSenha em login.tsx").toBeTruthy();
    expect(LOGIN, "o rodapé deixou de estar sobre a seção bg-white").toMatch(
      /<section className="[^"]*\bbg-white\b/,
    );
    const cor = /\btext-(neutral-\d+)\b/.exec(p![1]!)?.[1];
    expect(cor !== undefined && cor in NEUTRAL_L, `cor do rodapé não resolúvel: "${p![1]}"`).toBe(true);
    const razao = contrasteSobreBranco(NEUTRAL_L[cor!]!);
    expect(razao, `text-${cor} sobre branco = ${razao.toFixed(2)}:1 (< 4.5 AA)`).toBeGreaterThanOrEqual(4.5);
  });

  it("sentinela: o neutral-400 pré-fix reprovaria (a guarda morde)", () => {
    // A Íris mediu 2.58:1 por canvas readback no elemento renderizado.
    expect(contrasteSobreBranco(NEUTRAL_L["neutral-400"]!)).toBeLessThan(4.5);
  });
});
