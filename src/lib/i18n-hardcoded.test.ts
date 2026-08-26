// Originalmente lumen-i18n-hardcoded.test.ts (#861). Renomeado por assunto (#1015 / HG3).
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";

// #861 (gate da Lumen II) — acha TEXTO DE UI HARDCODED que fura o i18n (`t.*` de
// strings.ts). É a classe do #788 (`"That didn't go through"` cravado). O app é
// pt-BR/en; string literal visível ao usuário num .tsx não traduz e só o PO pega.
//
// Escaneia superfícies AUTORAIS do app; exclui o registry vendored (Plate/shadcn/
// ReUI — inglês de propósito, fora do i18n). Ratchet: baseline congela o conhecido,
// falha em QUALQUER string hardcoded nova. Exceção pontual: `// i18n-ignore` na linha.

const VENDOR = [
  "/components/ui/",
  "/components/reui/",
  "/components/examples/",
  "/components/smoothui/",
  "/components/animate-ui/",
  "/components/editor/",
  "/components/magicui/",
  "/components/kibo-ui/",
  "/components/motion-primitives/",
  "/components/prompt-kit/",
];

// Literais que NÃO são i18n: marcas, provedores, tokens técnicos, unidades.
//
// `The GALAXIE` entrou no #1599 (@Pollux) — é o nome da SUITE, decidido pelo PO,
// e **não se traduz**: é igual em PT e EN, como `Galaxie Works` logo ao lado.
// Vai no ALLOW e não no BASELINE de propósito: o BASELINE é dívida a pagar
// (vira `t.*` um dia), e uma marca nunca vira `t.*`. O rótulo anterior escapava
// desta guarda por ser palavra única — o detector de prosa só vê 2+ palavras.
const ALLOW =
  /^(The GALAXIE|GALAXIE|Galaxie Works|Galaxie|VOAZ|Bridge|Navigator|Files|Remote|OneDrive|SharePoint|Microsoft|Google|Outlook|Gmail|M365|Stripe|https?:\/\/|E = mc|[0-9.,]+ ?(GB|MB|KB|TB|px|ms)?)$/;

// Dívida i18n PRÉ-EXISTENTE (medida no feat). Remover a entrada ao corrigir o
// componente (vira `t.*`). NÃO adicionar novas aqui — string nova = corrigir na fonte.
const BASELINE = new Set<string>([
  "src/components/brand.tsx::Acesso aos arquivos",
  "src/components/telemetry-settings.tsx::Telemetry inspector",
]);

const ATTR =
  /\b(placeholder|aria-label|title|alt)\s*=\s*"([^"{}]*?[A-Za-zÀ-ÿ]{2,}[^"{}]*?)"/g;
const TOAST =
  /\b(toast\.(?:success|error|info|loading|warning)|setError)\(\s*"([^"]*?[A-Za-zÀ-ÿ]{2,}[^"]*?)"/g;
const PROSE =
  />\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.,!?:-]*(?:\s+[A-Za-zÀ-ÿ'.,!?:-]+){1,6})\s*</g;

/** Zera o conteúdo dos comentários de bloco preservando as quebras de linha. */
function semComentariosDeBloco(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Tira o comentário de linha, poupando `https://` (o `//` colado no `:`). */
function semComentarioDeLinha(linha: string): string {
  return linha.replace(/(^|[^:])\/\/.*$/, "$1");
}

function normalizar(p: string): string {
  return p.replaceAll("\\", "/");
}

function coletarViolacoes(): string[] {
  const arquivos = globSync("src/**/*.tsx").filter((f) => {
    const p = normalizar(f);
    return !/\.(test|spec|stories)\./.test(p) && !VENDOR.some((v) => p.includes(v));
  });

  const violacoes: string[] = [];
  for (const arquivo of arquivos) {
    const rel = normalizar(arquivo);
    const linhas = semComentariosDeBloco(readFileSync(arquivo, "utf8")).split("\n");
    linhas.forEach((linhaBruta, i) => {
      if (/i18n-ignore/.test(linhaBruta)) return; // exceção explícita
      const linha = semComentarioDeLinha(linhaBruta);
      for (const re of [ATTR, TOAST, PROSE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(linha))) {
          const texto = (m[2] ?? m[1]).trim();
          if (ALLOW.test(texto)) continue;
          const chave = `${rel}::${texto}`;
          if (BASELINE.has(chave)) continue;
          violacoes.push(`${rel}:${i + 1}  «${texto}»`);
        }
      }
    });
  }
  return violacoes;
}

test("#861: nenhuma string de UI hardcoded nova (fora do i18n / t.*)", () => {
  const violacoes = coletarViolacoes();
  assert.deepEqual(
    violacoes,
    [],
    `Texto de UI hardcoded — mova pra strings.ts (t.*) ou marque // i18n-ignore se for técnico:\n` +
      violacoes.map((v) => "  " + v).join("\n"),
  );
});
