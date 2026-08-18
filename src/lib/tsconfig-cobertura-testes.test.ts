import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// #1051 (TST-04) — guarda de que o type-check dos testes NÃO SOME em silêncio.
//
// ── Estado medido (`d8c1b1d`, 18/08) ────────────────────────────────────────
// O card #1051 diz que nenhum `*.test.ts` é typechecado. **Isso já não é
// verdade**: o #1016 criou o `tsconfig.test.json` e o referenciou no
// `tsconfig.json`. Conferi injetando um erro de tipo grosseiro num `.test.ts` —
// o `tsc -b` reprovou. O card está resolvido; o que faltava era ISTO.
//
// ── Por que a guarda ────────────────────────────────────────────────────────
// A cobertura mora inteira em CONFIG, e o modo de falha é SILENCIOSO: basta
// alguém tirar a referência do `tsconfig.json`, ou pôr um `exclude` no
// `tsconfig.test.json`, e os 66 arquivos de teste voltam a não ser checados —
// **sem nada ficar vermelho**. O runner (`node --test
// --experimental-strip-types`) só REMOVE os tipos, não os valida, então os
// testes seguem passando e o CI segue verde.
//
// É a mesma família do `icon: true` (#1153, afirmação do gerador que ninguém
// abria) e do `assert total > 100` que pus no gate do #1070: **um verificador
// que deixa de verificar passa para sempre.** A parte perigosa de um gate não é
// falhar — é parar de olhar.
//
// Escopo honesto: isto guarda a CONFIGURAÇÃO. Quem faz o type-check é o
// `tsc -b`; aqui só se garante que ele continua enxergando os testes.

const RAIZ = new URL("../../", import.meta.url);

/**
 * Lê um `tsconfig*.json` com o parser do PRÓPRIO TypeScript.
 *
 * Comecei escrevendo um stripper de comentário à mão e ele quebrou duas vezes,
 * pelo mesmo motivo de fundo: **separador de comentário e conteúdo de glob são
 * o mesmo texto.** O glob `"src/**\/*.test.ts"` contém `/*` e `*\/`, então uma
 * regex de bloco casa de dentro de uma string até outra, engole aspas e quebras
 * de linha, e o `JSON.parse` morre. Somar "e vírgula pendente é válida em
 * JSONC" fecha o caso: JSONC não se lê com regex.
 *
 * O `typescript` já é dependência e traz o leitor certo. Usar o parser do
 * compilador para asserir sobre a config do compilador também é o acoplamento
 * correto — se ele mudar de opinião sobre o arquivo, o teste muda junto.
 */
function lerJsonc(rel: string): Record<string, unknown> {
  const caminho = fileURLToPath(new URL(rel, RAIZ));
  const bruto = readFileSync(caminho, "utf8");
  const { config, error } = ts.parseConfigFileTextToJson(caminho, bruto);
  assert.equal(error, undefined, `${rel} não é um tsconfig legível`);
  return (config ?? {}) as Record<string, unknown>;
}

test("#1051: o tsconfig raiz continua referenciando o projeto dos testes", () => {
  const raiz = lerJsonc("tsconfig.json");
  const refs = (raiz.references as { path: string }[] | undefined) ?? [];
  assert.ok(
    refs.some((r) => r.path.includes("tsconfig.test.json")),
    "sem esta referência o `tsc -b` não olha nenhum *.test.ts — e nada fica vermelho, " +
      "porque o runner faz type-stripping (remove tipos sem validar)",
  );
});

test("#1051: o projeto dos testes cobre TODOS os *.test.ts(x), sem exclude", () => {
  const cfg = lerJsonc("tsconfig.test.json");
  const include = (cfg.include as string[] | undefined) ?? [];
  const exclude = (cfg.exclude as string[] | undefined) ?? [];

  const problemas: string[] = [];
  for (const alvo of ["src/**/*.test.ts", "src/**/*.test.tsx"]) {
    if (!include.includes(alvo)) problemas.push(`include perdeu \`${alvo}\``);
  }
  if (exclude.length > 0) {
    problemas.push(
      `exclude deixou de ser vazio (${JSON.stringify(exclude)}) — é assim que a cobertura some sem alarme`,
    );
  }

  // Conta os arquivos reais: se um dia aparecer teste fora de `src/`, o include
  // acima não o pega, e este número denuncia.
  const naDisco = globSync("src/**/*.test.ts{,x}").length;
  if (naDisco === 0) {
    problemas.push("nenhum *.test.ts encontrado — o glob quebrou, não o código");
  }

  assert.deepEqual(problemas, []);
});

test("#1051: o projeto dos testes é noEmit e o build do app segue sem os testes", () => {
  const teste = lerJsonc("tsconfig.test.json");
  const opts = (teste.compilerOptions as Record<string, unknown>) ?? {};
  assert.equal(opts.noEmit, true, "o projeto de teste não pode emitir artefato");
  assert.equal(
    opts.strict,
    true,
    "sem `strict` o type-check dos testes passa a aceitar o que a app rejeita",
  );

  // AC #2 do card: o exclude do app existe para manter os testes FORA do bundle.
  // Guardar os dois juntos evita "resolver" um quebrando o outro.
  const app = lerJsonc("tsconfig.app.json");
  const excludeApp = (app.exclude as string[] | undefined) ?? [];
  assert.ok(
    excludeApp.includes("src/**/*.test.ts"),
    "o build do app precisa continuar excluindo os testes do bundle",
  );
});
