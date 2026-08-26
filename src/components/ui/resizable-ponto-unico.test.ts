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
 * O que um call-site NÃO pode mexer: margem horizontal, fundo e hover de fundo.
 *
 * Prefixos, não literais — é essa a diferença entre "não repitas estes três" e
 * "não mexas nisto". `mx-4` e `bg-red-500` não estavam em lista nenhuma e
 * quebravam o padrão na mesma.
 */
const PROIBIDOS = /^(mx-|bg-|hover:bg-)/;

/**
 * Todas as strings literais de um trecho, em qualquer invólucro: `"…"`, `'…'`
 * e `` `…` ``. É isto que tira a cegueira ao `cn()`: o conteúdo de
 * `{cn("a", "b")}` são duas strings, e as duas passam a ser lidas.
 */
function stringsDe(trecho: string): string[] {
  return [...trecho.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
}

/**
 * As tags de abertura de `<ResizableHandle …>`, self-closing ou não.
 *
 * Varredura caractere a caractere em vez de regex porque o `>` pode aparecer
 * dentro de uma string da própria tag, e um `[^>]*` cortaria a tag ao meio —
 * lendo metade dos atributos e declarando-a limpa. Cegueira PARCIAL é pior que
 * nenhuma: passa por medição.
 */
function tagsDeUso(texto: string): string[] {
  const tags: string[] = [];
  const abre = /<ResizableHandle\b/g;
  let m: RegExpExecArray | null;
  while ((m = abre.exec(texto)) !== null) {
    let i = m.index;
    let aspa: string | null = null;
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
      if (c === ">") break;
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
        const tokens = stringsDe(tag)
          .flatMap((s) => s.split(/\s+/))
          .filter(Boolean);
        const divergentes = tokens.filter((t) => PROIBIDOS.test(t));
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
