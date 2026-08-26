// #1279 / #1629: o PADRÃO do splitter do app (barra transparente + `hover:bg-border`
// + margem `mx-1.5`) mora num PONTO ÚNICO — o default de `ResizableHandle` em
// `ui/resizable.tsx`. Foi por REPETIÇÃO desse padrão em cada uso que o Files
// divergiu (ficou sem o hover).
//
// ── A regra, na forma que ela devia ter tido desde o início ────────────────
//
// O `className` de um uso de `<ResizableHandle>` só pode conter o que está
// EXPLICITAMENTE PERMITIDO aqui. Tudo o resto reprova — inclusive o que ninguém
// previu.
//
// ## Porque isto mudou de forma três vezes, e porque esta é a certa
//
// v1 (@Castor) — **denylist de 3 literais** (`mx-1.5`/`bg-transparent`/
// `hover:bg-border`). Apanhava quem REPETIA o padrão; cega a quem DIVERGIA com
// outros valores. A @Lúmen mediu: `mx-4 bg-red-500 hover:bg-primary` passava
// 589/589 — o bug do card a voltar.
//
// v2 (@Pollux) — **prefixos** (`mx-`/`bg-`) + leitura do `className` em qualquer
// invólucro (achado da @Íris: `cn()` é o idioma deste repo) + varredura da tag
// com aspas e profundidade de chaveta (achados do Codex). Melhor, e **ainda uma
// denylist** — só que com prefixos em vez de literais.
//
// 🔑 v3, esta (@Altair, #1629) — **ALLOWLIST de facto.** Ele mediu no artefato
// já mesclado: `ml-2 mr-2` é exatamente `mx-2` e passava; `m-4` também. E deu o
// diagnóstico que interessa mais que o buraco:
//
//   > "Os casos de teste e a blocklist saem do MESMO modelo mental. Quem
//   > escreveu `/^(mx-|bg-)/` escreveu casos que exercitam `mx-` e `bg-`.
//   > O teste CONFIRMA a blocklist em vez de a desafiar."
//
// Os meus 12 casos verdes não podiam ver o buraco: tinham a minha cegueira. A
// prova está na história — o `semVariantes` só nasceu depois de o Codex morder.
// **Uma lista de proibidos só cresce quando alguém é mordido; uma lista de
// permitidos falha sozinha diante do que ninguém previu.**
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
 * O que um uso PODE acrescentar ao `className` — e nada mais.
 *
 * Acrescentar aqui é um ato deliberado, com motivo escrito, do mesmo tipo que
 * baixar um piso de catraca. É essa a fricção que se quer: a lista de
 * permitidos não cresce por descuido.
 *
 * `print:hidden` — `message-detail.tsx:1292` esconde o splitter na impressão.
 * Não toca em barra, hover nem margem no ecrã.
 */
const PERMITIDAS = new Set(["print:hidden"]);

/**
 * As tags de abertura de `<ResizableHandle …>`, self-closing ou não.
 *
 * Varredura caractere a caractere, com **aspas E profundidade de chaveta** — os
 * dois entraram por serem furos medidos: um `>` dentro de string, ou o `>` de um
 * operador (`disabled={count > 0}`, uma arrow `=>`), cortava a tag ao meio e o
 * detector lia METADE dos atributos declarando-a limpa. Cegueira parcial é pior
 * que nenhuma: passa por medição.
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

/**
 * A região do valor do `className` dentro de uma tag, ou `null` se não houver.
 *
 * Devolve sempre uma **EXPRESSÃO**, não o conteúdo: para `className="a b"`
 * devolve `"a b"` COM as aspas, e para `className={…}` devolve o miolo das
 * chavetas. Uniformizar isto não é detalhe — a 1ª versão devolvia conteúdo num
 * caso e expressão no outro, e o consumidor (que procura strings) lia
 * `print:hidden` sem aspas, não encontrava string nenhuma e declarava o uso
 * legítimo como "não verificável". O teste apanhou-o **na árvore real**, que é
 * exatamente para isso que existe o piso anti-cegueira.
 *
 * Ao contrário da v2, isto NÃO varre a tag inteira: com uma allowlist, varrer
 * tudo faria `withHandle`, `onDragging` e `aria-label` contarem como tokens
 * desconhecidos e reprovarem todos os usos legítimos. O preço é este recorte.
 */
function valorDoClassName(tag: string): string | null {
  const at = /className\s*=\s*/.exec(tag);
  if (!at) return null;
  let i = at.index + at[0].length;
  const inicio = tag[i];
  if (inicio === '"' || inicio === "'") {
    const fim = tag.indexOf(inicio, i + 1);
    // COM as aspas: o consumidor procura literais de string.
    return fim < 0 ? tag.slice(i) : tag.slice(i, fim + 1);
  }
  if (inicio !== "{") return null;
  let fundo = 0;
  const de = i;
  for (; i < tag.length; i++) {
    const c = tag[i]!;
    if (c === "{") fundo++;
    else if (c === "}") {
      fundo--;
      if (fundo === 0) return tag.slice(de + 1, i);
    }
  }
  return tag.slice(de + 1);
}

/**
 * Os tokens de classe de uma expressão de `className`, e se ela é
 * INTEIRAMENTE legível.
 *
 * `legivel: false` quando sobra código fora das strings (uma variável, uma
 * chamada com argumento dinâmico). Aí a guarda **reprova**: não conseguir
 * verificar não é o mesmo que estar bem. É a mesma direção restritiva do
 * `razaoDo403` — na dúvida, o lado seguro.
 */
function tokensDoClassName(expr: string): { tokens: string[]; legivel: boolean } {
  const tokens: string[] = [];
  // Tira as strings (em qualquer invólucro) e guarda o que sobra para julgar.
  const resto = expr.replace(/"([^"]*)"|'([^']*)'|`([^`]*)`/g, (_m, a, b, c) => {
    for (const t of String(a ?? b ?? c ?? "").split(/\s+/)) if (t) tokens.push(t);
    return " ";
  });
  // O que pode sobrar sem ser código: `cn(`, vírgulas, parênteses, espaços.
  const legivel = resto.replace(/[\s(),]|cn/g, "") === "";
  return { tokens, legivel };
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

test("#1629: o `className` de um uso de <ResizableHandle> só tem o que está PERMITIDO", () => {
  const infratores: string[] = [];
  let usosVistos = 0;

  for (const arquivo of arquivosTsx(SRC)) {
    if (arquivo.replace(/\\/g, "/").endsWith(PONTO_UNICO)) continue; // o dono do padrão
    const texto = readFileSync(arquivo, "utf8");
    for (const tag of tagsDeUso(texto)) {
      usosVistos++;
      const expr = valorDoClassName(tag);
      if (expr === null) continue; // sem className: herda o ponto único, é o caso bom
      const { tokens, legivel } = tokensDoClassName(expr);
      const nome = arquivo.replace(/\\/g, "/");
      if (!legivel) {
        infratores.push(`${nome}: className não é verificável estaticamente (${expr.trim()})`);
        continue;
      }
      const forasteiros = tokens.filter((t) => !PERMITIDAS.has(t));
      if (forasteiros.length) {
        infratores.push(`${nome}: [${forasteiros.join(", ")}]`);
      }
    }
  }

  // Anti-cegueira: se a varredura deixar de achar usos, tudo acima passa vazio
  // — e vazio diz "conferido", que é pior que errado.
  assert.ok(
    usosVistos >= 5,
    `só ${usosVistos} usos de <ResizableHandle> encontrados — a varredura ficou cega`,
  );

  assert.deepEqual(
    infratores,
    [],
    "`className` de <ResizableHandle> com token NÃO permitido. A barra, o hover e a " +
      "margem vêm do ponto único (ui/resizable.tsx). Se o token é mesmo legítimo, " +
      "acrescente-o a `PERMITIDAS` com o motivo escrito — é um ato deliberado, não " +
      "um contorno:\n" +
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
