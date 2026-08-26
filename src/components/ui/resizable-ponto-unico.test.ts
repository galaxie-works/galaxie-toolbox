// #1279: o PADRÃO do splitter do app (barra transparente + `hover:bg-border` +
// margem `mx-1.5`) mora num PONTO ÚNICO — o default de `ResizableHandle` em
// `ui/resizable.tsx`. Foi por REPETIÇÃO desse padrão em cada uso que o Files
// divergiu (ficou sem o hover). Este gate reprova qualquer USO de
// `<ResizableHandle>` que traga esses tokens no `className`: eles têm de vir do
// default, não de cópia. Um uso pode passar `className` só pra ALGO A MAIS
// (ex.: `print:hidden`), nunca pra a barra/hover/margem.
//
// ── Conserto do #1279 (executor fresco: @Pollux) ──────────────────────────
// A @Lúmen reprovou este gate e a @Íris mostrou que o furo tinha DOIS eixos
// ortogonais no mesmo `if`. Ambos estão fechados aqui:
//
//   EIXO 1 — a LISTA (@Lúmen). Era uma **denylist** de 3 literais: apanhava
//   quem REPETIA o padrão e deixava passar quem DIVERGIA dele com outros
//   valores. O mutante `className="mx-4 bg-red-500 hover:bg-primary"` passava
//   589/589 — e é o bug DESTE card a voltar. O DoD diz "diverge", não
//   "duplica"; o comentário acima já dizia "nunca para barra/hover/margem" e o
//   código dizia "nunca estes três". Agora é allowlist por EFEITO. (#1305.)
//
//   EIXO 2 — a LEITURA (@Íris). O detector só casava `className="…"`, literal
//   entre aspas duplas. Ficava cego a `cn(...)` — que é **o idioma deste
//   repo**, o próprio `resizable.tsx` usa `cn` —, a aspas simples, a template
//   literal e a uso não self-closing. Um call-site escrito da forma natural
//   re-criava o #1279 com o gate verde. Agora lê-se qualquer string da tag.
//
// Porque a varredura é da TAG inteira e não só do `className`: não há razão
// legítima para um token de margem/fundo/hover aparecer num uso de
// `<ResizableHandle>` — em prop nenhuma. Sobre-aproximar erra para o lado
// seguro, e o lado inseguro é o bug que este card já teve duas vezes.
//
// Estilo dos gates da casa: parse do fonte, sem montar componente. Rode com
//   node --test --experimental-strip-types src/components/ui/resizable-ponto-unico.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../../", import.meta.url)); // .../src
const PONTO_UNICO = "components/ui/resizable.tsx";
// O trio que É o padrão do app — só pode aparecer no ponto único.
const TOKENS = ["mx-1.5", "bg-transparent", "hover:bg-border"];

/**
 * O que um call-site NÃO pode mexer: **margem horizontal e fundo**.
 *
 * Prefixos, não literais — a diferença entre "não repitas estes três" e "não
 * mexas nisto" (achado da @Lúmen). E testado **depois** de tirar as variantes:
 * `hover:bg-border` e `dark:bg-red-500` normalizam ambos para `bg-…`, portanto
 * `hover:bg-` deixa de precisar de entrada própria.
 */
const PROIBIDOS = /^(mx-|bg-)/;

/**
 * Tira as VARIANTES do Tailwind de um token: `dark:md:bg-red-500` → `bg-red-500`.
 *
 * Achado do Codex nesta PR: a expressão ancorada em `^` não via a utilitária
 * por baixo de um modificador, e `className="dark:bg-red-500 md:mx-4"` mudava
 * fundo e margem em estados normais da app — a divergência que este gate existe
 * para impedir, a passar por baixo dele.
 *
 * Pára no `[`: um valor arbitrário (`bg-[url(a:b)]`) tem `:` que **não** é
 * variante, e cortar por ele mutilaria o token.
 */
function semVariantes(token: string): string {
  let t = token;
  for (;;) {
    const i = t.indexOf(":");
    const colchete = t.indexOf("[");
    if (i < 0 || (colchete >= 0 && colchete < i)) return t;
    t = t.slice(i + 1);
  }
}

/**
 * Os candidatos a classe dentro de uma tag — **de qualquer sítio dela**.
 *
 * Deliberadamente grosseiro: parte a tag inteira por tudo o que não pode fazer
 * parte de uma classe Tailwind. Isto atravessa de uma vez os invólucros que já
 * cegaram este gate — `"…"`, `'…'`, `` `…` ``, `{cn(…)}`, ternários, e
 * **interpolações `${…}` dentro de template** (3º achado do Codex: o conteúdo
 * do template era consumido como UMA string e as literais lá dentro nunca eram
 * lidas).
 *
 * Sobre-aproximar é a direção segura: não há razão legítima para um token de
 * margem ou fundo aparecer num uso de `<ResizableHandle>`, em prop nenhuma.
 */
function candidatos(tag: string): string[] {
  return tag.split(/[^A-Za-z0-9_:\-[\]/.%]+/).filter(Boolean);
}

/**
 * As tags de abertura de `<ResizableHandle …>`, self-closing ou não.
 *
 * Varredura caractere a caractere, com **aspas E profundidade de chaveta**.
 *
 * As aspas entraram primeiro (um `>` dentro de string cortava a tag ao meio).
 * A profundidade entrou depois, por achado do Codex — e é o mesmo erro uma
 * camada abaixo: em `<ResizableHandle disabled={count > 0} className="bg-red-500" />`
 * o `>` do OPERADOR terminava a tag antes do `className`, e a classe proibida
 * nunca chegava a ser lida. `=>` de uma arrow tem o mesmo efeito.
 *
 * Cegueira PARCIAL é pior que nenhuma: passa por medição. Tem caso de teste.
 */
function tagsDeUso(texto: string): string[] {
  const tags: string[] = [];
  const abre = /<ResizableHandle\b/g;
  let m: RegExpExecArray | null;
  while ((m = abre.exec(texto)) !== null) {
    let i = m.index;
    let aspa: string | null = null;
    let fundo = 0;
    for (; i < texto.length; i++) {
      const c = texto[i]!;
      if (aspa) {
        if (c === aspa) aspa = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        aspa = c;
        continue;
      }
      if (c === "{") fundo++;
      else if (c === "}") fundo--;
      else if (c === ">" && fundo === 0) break;
    }
    tags.push(texto.slice(m.index, Math.min(i + 1, texto.length)));
  }
  return tags;
}

function arquivosTsx(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) achados.push(...arquivosTsx(p));
    else if (entrada.endsWith(".tsx")) achados.push(p);
  }
  return achados;
}

test("#1279: nenhum uso de <ResizableHandle> DIVERGE do padrão (barra/hover/margem vêm do ponto único)", () => {
  const infratores: string[] = [];
  for (const arquivo of arquivosTsx(SRC)) {
    if (arquivo.replace(/\\/g, "/").endsWith(PONTO_UNICO)) continue; // o dono do padrão
    const texto = readFileSync(arquivo, "utf8");
      for (const tag of tagsDeUso(texto)) {
        // Qualquer string da tag, em qualquer invólucro — e cada uma partida em
        // tokens de classe.
        const divergentes = candidatos(tag).filter((t) =>
          PROIBIDOS.test(semVariantes(t)),
        );
        if (divergentes.length) {
          infratores.push(
            `${arquivo.replace(/\\/g, "/")}: [${divergentes.join(", ")}]`,
          );
        }
      }
  }
  assert.deepEqual(
    infratores,
    [],
    "Uso de <ResizableHandle> que DIVERGE do padrão: margem/fundo/hover vêm do " +
        "ponto único (ui/resizable.tsx) e não do call-site. Um uso pode acrescentar " +
        "algo a mais (ex.: `print:hidden`), nunca mexer na barra:\n" +
      infratores.map((i) => "  " + i).join("\n"),
  );
});

test("#1279: o ponto único (ui/resizable.tsx) É quem carrega o padrão (senão o gate acima vira decoração)", () => {
  const dono = readFileSync(join(SRC, "components/ui/resizable.tsx"), "utf8");
  for (const t of TOKENS) {
    assert.ok(
      dono.includes(t),
      `ui/resizable.tsx perdeu o token "${t}" do padrão — o default do ResizableHandle precisa dele, ou os usos ficam sem o padrão do app.`,
    );
  }
});
