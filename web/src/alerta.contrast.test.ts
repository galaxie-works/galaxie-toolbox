// #1640 — o `Alerta` LÊ em ambos os tons (contraste AA real, não só o token).
//
// ## Porque este teste existe
//
// O `styles.test.ts` prova que o TOKEN `--destructive-foreground` está certo
// (quase-branco, contrasta com o vermelho sólido) e DECLAROU o próprio limite:
// "NÃO computa contraste real ... candidato a card próprio, o oráculo do motor".
// O Codex entrou exatamente por esse buraco (P1 na #1640): o token está certo,
// mas o COMPONENTE usava-o sobre `bg-destructive/10` (tinta clara) — quase-branco
// sobre tinta = ~1.14:1, ilegível. Um teste de token não pega um mau consumo.
//
// Este é o oráculo: resolve a cascata que o `Alerta` realmente produz (fundo do
// tom ⊕ cor do texto, compostos sobre a página branca) e exige AA (4.5:1). Ele
// PARSEIA `alerta.tsx` — se alguém trocar a cor do texto, o teste re-resolve e
// mede de novo. Contra o componente pré-fix, morre no 1.14. É a guarda anti-
// cegueira: de qual mutante morre (voltar ao `-foreground`), em qual canal (aqui).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src", "components", "alerta.tsx"), "utf8");
const CSS = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

// ── Cor: oklch → sRGB linear → luminância relativa → contraste WCAG ──────────
type RGB = [number, number, number];

function oklchToLinear(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const lin2srgb = (c: number): number => {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
function oklchToSrgb(L: number, C: number, h: number): RGB {
  return oklchToLinear(L, C, h).map(lin2srgb) as RGB;
}
const srgb2lin = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
function relLum([r, g, b]: RGB): number {
  return 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b);
}
function contrast(fg: RGB, bg: RGB): number {
  const a = relLum(fg);
  const b = relLum(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
// Composição alfa em sRGB — como o browser mistura `bg-<cor>/<alpha>` sobre o fundo.
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as RGB;
}

const WHITE: RGB = [1, 1, 1]; // página web = light-only, sem bg de root (styles.css)

// Constantes da paleta Tailwind v4 usadas como cor CRUA no componente (não são
// tokens do tema). Se a paleta mudar de major, revalidar.
const TAILWIND_V4: Record<string, RGB> = {
  "red-800": oklchToSrgb(0.444, 0.177, 26.899),
  "yellow-900": oklchToSrgb(0.421, 0.095, 57.708),
  "neutral-900": oklchToSrgb(0.205, 0, 0),
};

/** Lê um token do `:root` do `web/styles.css` e resolve `var(--color-*)`. */
function tokenCss(nome: string): RGB {
  const m = new RegExp(`--${nome}\\s*:\\s*([^;]+);`).exec(CSS);
  expect(m, `token --${nome} sumiu do styles.css`).toBeTruthy();
  return parseColor(m![1]!.trim());
}
function parseColor(valor: string): RGB {
  const oklch = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(valor);
  if (oklch) return oklchToSrgb(+oklch[1]!, +oklch[2]!, +oklch[3]!);
  const varRef = /var\(--color-([\w-]+)\)/.exec(valor);
  if (varRef) {
    const c = TAILWIND_V4[varRef[1]!];
    expect(c, `paleta v4 não tem ${varRef[1]}`).toBeTruthy();
    return c!;
  }
  throw new Error(`cor não resolúvel: ${valor}`);
}

/** Resolve uma utility `text-*` do componente para a cor efetiva. */
function corDoTexto(cls: string): RGB {
  const nome = cls.replace(/^text-/, "");
  if (nome in TAILWIND_V4) return TAILWIND_V4[nome]!;
  return tokenCss(nome); // ex.: warning-foreground, destructive-foreground
}
/** Resolve o fundo efetivo de uma caixa: `bg-<token>/<alpha>` composto na página. */
function fundoDaCaixa(caixa: string): RGB {
  const m = /bg-([\w-]+)\/(\d+)/.exec(caixa);
  if (!m) return WHITE; // sem caixa (tom "simples") = página
  return over(tokenCss(m[1]!), +m[2]! / 100, WHITE);
}

/** Extrai, na ordem-fonte, as strings de classe de uma atribuição `const X = ...;`. */
function ramos(nomeConst: string): string[] {
  const bloco = new RegExp(`const ${nomeConst}\\s*=([\\s\\S]*?);`).exec(SRC);
  expect(bloco, `não achei o const ${nomeConst} em alerta.tsx`).toBeTruthy();
  // Remove os literais de comparação (`tom === "aviso"`) — senão "aviso"/"erro"
  // entram como se fossem classes e desalinham os ramos. Só queremos as CLASSES.
  const corpo = bloco![1]!.replace(/tom\s*===\s*"[^"]*"/g, "");
  const strs = [...corpo.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  expect(strs.length, `esperava ≥2 ramos em ${nomeConst}`).toBeGreaterThanOrEqual(2);
  return strs;
}

describe("#1640 — Alerta lê em AA (contraste real da cascata)", () => {
  // caixa e corTitulo têm a MESMA ordem de ramos: [aviso, erro, (simples/else)].
  const caixas = ramos("caixa");
  const cores = ramos("corTitulo");
  // corDetalhe reusa corTitulo nos tons com caixa — logo checar o título cobre ambos.
  const casos = [
    { tom: "aviso", i: 0 },
    { tom: "erro", i: 1 },
  ] as const;

  it.each(casos)("tom '$tom' — título/detalhe ≥ 4.5:1 sobre a própria caixa", ({ tom, i }) => {
    const fg = corDoTexto(cores[i]!);
    const bg = fundoDaCaixa(caixas[i]!);
    const razao = contrast(fg, bg);
    expect(
      razao,
      `tom "${tom}": "${cores[i]}" sobre "${caixas[i]}" dá ${razao.toFixed(2)}:1 (< 4.5 AA). ` +
        `Texto sobre tinta clara precisa de cor ESCURA — ver o comentário em alerta.tsx.`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("sentinela: o quase-branco reprovaria na caixa de erro (a guarda morde)", () => {
    // Prova que o oráculo mata o mutante exato do P1: se o erro voltar ao
    // `--destructive-foreground`, o contraste desaba (~1.14). Sem isto, a guarda
    // poderia passar por acidente e não provar que pega a regressão.
    const quaseBranco = tokenCss("destructive-foreground");
    const tinta = fundoDaCaixa("bg-destructive/10");
    expect(contrast(quaseBranco, tinta)).toBeLessThan(1.5);
  });
});
