import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

// #1490 — o app web não inventa rota que o contrato HTTP não declare.
//
// ── O defeito que já aconteceu ─────────────────────────────────────────────
// Eu escrevi `/me/org/membros` no #1490 porque o contrato ainda não existia. O
// contrato nasceu (#1503, `3dac7a5`) e diz `/orgs/{org}/membros`. Ou seja: o FE
// tinha inventado a rota e ninguém percebeu — o @Altair já tinha nomeado a
// classe ("FE sem contrato escrito INVENTA o contrato, e o BE fica obrigado a
// implementar o chute"). Esta guarda existe pra que a próxima invenção morra no
// gate em vez de virar dívida.
//
// ── O que ela pina, e o que NÃO ────────────────────────────────────────────
// Pina UMA direção: **rota usada pelo cliente que o contrato não tem**. O
// contrário — rota do contrato que o FE ainda não usa — NÃO reprova, e é
// deliberado: o BE legitimamente expõe superfície antes do FE consumir, e
// gatear isso exigiria uma lista de exceções, que é a doença que o #1421 e o
// #1221 documentam. Mesma direção que escolhi no `contrato-tauri.test.ts`.
//
// ── Por que este teste mora na RAIZ ────────────────────────────────────────
// Medido no ruleset da `pre-prod`: os checks OBRIGATÓRIOS são `frontend / gate`,
// `rust` e `clippy`. O job `web` roda e **não barra merge**. Guarda que só
// vivesse em `web/**` reportaria sem impedir — a armadilha do #1374. O
// `frontend / gate` roda `pnpm test` = `node --test "src/**/*.test.ts"`, este
// arquivo. Ele lê `web/` e o doc pelo sistema de arquivos; não importa nada de
// lá (o `tsc -b` da raiz não inclui aquele pacote).
//
// ── Método (aprendido em #1306/#1416/#1421) ────────────────────────────────
// DERIVAR as duas listas das fontes, nunca digitá-las; anti-vazio em cada uma;
// e a própria varredura tem asserção.

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const WEB_SRC = join(RAIZ, "web", "src");
const PORTA = join(WEB_SRC, "lib", "api.ts");
const CONTRATO = join(RAIZ, "docs", "plataforma", "contrato-http-v1.md");

/**
 * As rotas declaradas no contrato, lidas das tabelas do doc.
 *
 * As linhas têm a forma `| \`GET\` | \`/me/assinatura\` | ... |`; o caminho é a
 * 2ª célula, entre crases. Derivar do doc (e não repetir a lista aqui) é o que
 * faz esta guarda detectar divergência em vez de congelar a minha cópia.
 */
function rotasDoContrato(): Set<string> {
  const doc = readFileSync(CONTRATO, "utf8");
  const rotas = new Set<string>();
  for (const linha of doc.split("\n")) {
    if (!linha.startsWith("|")) continue;
    const celulas = linha.split("|").map((c) => c.trim());
    // [0]="" [1]=método [2]=caminho
    const metodo = celulas[1]?.replace(/`/g, "");
    const caminho = celulas[2]?.replace(/`/g, "");
    if (!metodo || !caminho) continue;
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(metodo)) continue;
    if (!caminho.startsWith("/")) continue;
    rotas.add(caminho);
  }
  return rotas;
}

/**
 * As superfícies que a porta de rede declara.
 *
 * Ignora linhas de comentário. Não é purismo: a 1ª versão deste parser casou
 * aspas dentro de um comentário MEU dentro da lista e acusou "decisão pendente
 * (§2)" como rota inventada. É a segunda vez que eu escrevo um parser que
 * confunde prosa com código (a outra foi a guarda de tenancy, no mesmo dia) —
 * daí a asserção sobre a própria varredura, mais abaixo.
 */
function superficiesDaPorta(): string[] {
  const fonte = readFileSync(PORTA, "utf8");
  // Sem `export`: a constante é privada de propósito (o ratchet do #1421 cobra
  // export sem consumidor, e o consumidor dela é esta leitura de texto).
  const i = fonte.indexOf("const SUPERFICIES");
  assert.ok(i >= 0, "não achei `SUPERFICIES` na porta de rede do web");
  const abre = fonte.indexOf("[", i);
  const fecha = fonte.indexOf("]", abre);
  assert.ok(abre > 0 && fecha > abre, "não consegui ler a lista de superfícies");
  return fonte
    .slice(abre, fecha)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .flatMap((l) => [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string));
}

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosDe(p, acc);
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(p);
  }
  return acc;
}

/** Fontes do app web, EXCLUÍDOS os testes (que citam rotas ruins de propósito). */
function fontesDoWeb(): string[] {
  return arquivosDe(WEB_SRC).filter((p) => !/\.test\.tsx?$/.test(p));
}

test("#1490 — a varredura enxerga o contrato e a porta (anti-vazio)", () => {
  assert.ok(existsSync(CONTRATO), `não achei o contrato em ${CONTRATO}`);
  assert.ok(existsSync(PORTA), `não achei a porta de rede ${PORTA}`);

  const doDoc = rotasDoContrato();
  assert.ok(
    doDoc.size >= 10,
    `li ${doDoc.size} rotas do contrato — esperava ≥10. Parse quebrado devolve ` +
      `conjunto vazio, e conjunto vazio faria a asserção de baixo passar sempre.`,
  );

  const daPorta = superficiesDaPorta();
  assert.ok(
    daPorta.length >= 10,
    `li ${daPorta.length} superfícies da porta — esperava ≥10`,
  );

  assert.ok(fontesDoWeb().length >= 5, "varredura de web/src veio vazia");

  // A varredura da porta não pode confundir COMENTÁRIO com declaração: a 1ª
  // versão deste parser acusou "decisão pendente (§2)" — texto de um comentário
  // meu dentro da lista — como rota inventada. Toda superfície lida tem que
  // parecer um caminho.
  for (const s of daPorta) {
    assert.ok(
      s.startsWith("/"),
      `"${s}" não é um caminho — o parser da porta está lendo prosa como rota`,
    );
  }
});

test("#1490 — a porta não declara rota que o contrato não tem", () => {
  const doDoc = rotasDoContrato();
  const inventadas = superficiesDaPorta().filter((s) => !doDoc.has(s));
  assert.deepEqual(
    inventadas,
    [],
    `a porta declara rota que o contrato NÃO tem — o cliente estaria ` +
      `inventando o contrato (foi assim que nasceu o \`/me/org/membros\`). ` +
      `Se o backend precisa expor isto, o contrato muda PRIMEIRO:\n  ` +
      `${inventadas.join("\n  ")}`,
  );
});

test("#1490 — ninguém contorna a porta de rede (fetch cru fora do api.ts)", () => {
  const fora: string[] = [];
  for (const arquivo of fontesDoWeb()) {
    if (arquivo === PORTA) continue;
    const fonte = readFileSync(arquivo, "utf8");
    // `fetch(` precedido de início/limite — evita casar `prefetch(`/`refetch(`.
    if (/(^|[^A-Za-z0-9_.$])fetch\s*\(/m.test(fonte)) {
      fora.push(relative(RAIZ, arquivo));
    }
  }
  assert.deepEqual(
    fora,
    [],
    `\`fetch\` cru fora da porta — o caminho escapa da checagem de contrato e ` +
      `do prefixo. Use \`chamar()\` de web/src/lib/api.ts:\n  ${fora.join("\n  ")}`,
  );
});
