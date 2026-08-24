import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

// #1490 (Admin da org, FE) — o app web não endereça inquilino por id do cliente.
//
// ── O defeito que esta guarda existe para impedir ──────────────────────────
// O delta do Altair no #1473/#1475 é uma regra de arquitetura: **o escopo vem
// da sessão, nunca do cliente**. Recursos de conta e de org são `/me/...`; um
// `/orgs/<id>/membros` convida o backend a confiar num id que veio de fora, e
// transforma cada tela num ponto onde o vazamento de tenancy pode nascer.
//
// O backend é a barreira real (404 pra org alheia, não 403 — pra não enumerar).
// Mas a barreira do BE só é exercitada pelos caminhos que o cliente monta: se o
// cliente parar de usar `/me`, ninguém percebe até alguém medir. Esse é o tipo
// de regressão que entra verde.
//
// ── POR QUE ESTE TESTE MORA AQUI, e não em `web/` ──────────────────────────
// Medido em 2026-08-24 (ruleset da `pre-prod`): os checks OBRIGATÓRIOS são
// `frontend / gate`, `rust` e `clippy`. O job `web` do `ci.yml` RODA mas **não
// barra merge** — mesma classe do `browser`. Uma guarda que só vivesse em
// `web/**` reportaria a regressão sem impedi-la, que é precisamente a armadilha
// do #1374 (guarda no canal que não barra, suíte verde, defeito de pé).
//
// O `frontend / gate` roda `pnpm test` = `node --test "src/**/*.test.ts"` — este
// arquivo. Ele lê a fonte de `web/` pelo sistema de arquivos; não importa nada
// de lá (o `tsc -b` da raiz não inclui `web/`, e o acoplamento por import seria
// pior que o acoplamento por leitura).
//
// O conserto DURÁVEL é tornar o job `web` obrigatório — decisão de configuração
// do repositório, do PO/@Altair, não minha. Enquanto não for, esta guarda é o
// único canal com dente. Quando for, este arquivo pode migrar pra `web/`.
//
// ── Guardas de método (aprendidas em #1306/#1416/#1421) ────────────────────
//   - DERIVAR as listas da fonte, nunca digitá-las;
//   - anti-vazio: varredura que não acha nada passaria pra sempre;
//   - a própria varredura tem asserção, não só o que ela varre.

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const WEB_SRC = join(RAIZ, "web", "src");
const PORTA = join(WEB_SRC, "lib", "api.ts");

/**
 * Prefixos que endereçam um inquilino (org/usuário) por id vindo do cliente.
 *
 * A lista mora AQUI, e não na porta de rede do `web/`, por dois motivos que se
 * somam: (1) é aqui que ela é usada — a porta trabalha por lista-de-permissão
 * ("tem que começar com `/me`"), esta guarda por lista-de-proibição na fonte;
 * (2) a raiz não pode importar de `web/` (o `tsc -b` da raiz não inclui aquele
 * pacote), então compartilhar a constante seria impossível e derivá-la lendo o
 * texto do outro arquivo era um elo falso — foi como eu tinha escrito na 1ª
 * versão, e o ratchet do #1421 expôs o custo: uma constante exportada só pra
 * ser lida como texto é órfã de verdade.
 */
const PREFIXOS_PROIBIDOS = [
  "/orgs",
  "/organizacoes",
  "/users",
  "/usuarios",
  "/contas",
  "/tenants",
] as const;

/**
 * Os literais de string de uma fonte TS/TSX — SEM comentários.
 *
 * Por que um tokenizador e não um regex: a primeira versão desta guarda casava
 * aspas na fonte crua e reprovou o `org.ts` por causa de um COMENTÁRIO que
 * documenta o padrão proibido ("não existe `/orgs/<id>/...`"). Guarda que pune
 * a prosa empurra o conserto errado — apagar a explicação — e é falso-positivo
 * das duas formas: também casaria `//` de uma URL como início de comentário se
 * eu tentasse remover comentários com regex.
 *
 * Anda pelo texto uma vez, sabendo em que estado está. Devolve só o miolo dos
 * literais, que é o que a asserção precisa.
 */
export function literaisDe(fonte: string): string[] {
  const achados: string[] = [];
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    const prox = fonte[i + 1];
    if (c === "/" && prox === "/") {
      while (i < fonte.length && fonte[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && prox === "*") {
      i += 2;
      while (i < fonte.length && !(fonte[i] === "*" && fonte[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const aspas = c;
      i++;
      let miolo = "";
      while (i < fonte.length && fonte[i] !== aspas) {
        if (fonte[i] === "\\") {
          miolo += fonte[i + 1] ?? "";
          i += 2;
          continue;
        }
        miolo += fonte[i];
        i++;
      }
      i++;
      achados.push(miolo);
      continue;
    }
    i++;
  }
  return achados;
}

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosDe(p, acc);
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(p);
  }
  return acc;
}

/** Fontes do app web, EXCLUÍDOS os próprios testes (que citam os caminhos ruins de propósito). */
function fontesDoWeb(): string[] {
  return arquivosDe(WEB_SRC).filter((p) => !/\.test\.tsx?$/.test(p));
}

test("#1490 — a varredura enxerga o app web (anti-vazio)", () => {
  assert.ok(existsSync(WEB_SRC), `não achei ${WEB_SRC} — o pacote web sumiu?`);
  assert.ok(existsSync(PORTA), `não achei a porta de rede ${PORTA}`);
  const fontes = fontesDoWeb();
  assert.ok(
    fontes.length >= 5,
    `esperava ≥5 fontes em web/src, achei ${fontes.length} — varredura cega ` +
      `passaria pra sempre`,
  );
});

test("#1490 — a varredura distingue código de prosa (a guarda tem guarda)", () => {
  // Reprovar isto seria reprovar a documentação: o comentário do `org.ts`
  // EXPLICA o padrão proibido, e a 1ª versão desta guarda o acusou.
  assert.deepEqual(
    literaisDe('// não existe "/orgs/<id>/x"\nconst a = "/me/org";'),
    ["/me/org"],
    "literal dentro de comentário de linha não pode contar",
  );
  assert.deepEqual(
    literaisDe('/* `/users/1` */ const a = "/me";'),
    ["/me"],
    "literal dentro de comentário de bloco não pode contar",
  );
  // ...e o inverso: código de verdade TEM que contar, senão a guarda fica cega.
  assert.deepEqual(literaisDe('const u = "/orgs/9/membros";'), [
    "/orgs/9/membros",
  ]);
  // `//` dentro de string é URL, não começo de comentário.
  assert.deepEqual(literaisDe('const u = "https://x.example/me";'), [
    "https://x.example/me",
  ]);
});

test("#1490 — nenhum caminho do cliente endereça inquilino por id", () => {
  const achados: string[] = [];
  for (const arquivo of fontesDoWeb()) {
    const fonte = readFileSync(arquivo, "utf8");
    if (arquivo === PORTA) continue; // a porta DECLARA os prefixos; é a fonte da lista
    for (const caminho of literaisDe(fonte)) {
      const proibido = PREFIXOS_PROIBIDOS.some(
        (p) => caminho === p || caminho.startsWith(`${p}/`),
      );
      if (proibido) {
        achados.push(`${relative(RAIZ, arquivo)}: "${caminho}"`);
      }
    }
  }
  assert.deepEqual(
    achados,
    [],
    `caminho endereçando inquilino por id no cliente (o escopo tem que vir da ` +
      `sessão — use "${"/me"}/..."):\n  ${achados.join("\n  ")}`,
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
    `\`fetch\` cru fora da porta de rede — o caminho escapa da checagem de ` +
      `escopo. Use \`chamar()\` de web/src/lib/api.ts:\n  ${fora.join("\n  ")}`,
  );
});
