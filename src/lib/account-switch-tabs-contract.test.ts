// Originalmente lumen-821-account-switch-tabs-contract.test.ts (#821). Renomeado por assunto (#1015 / HG3).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// #821 (P0) — vazamento de estado entre contas: as abas do Navigator vivem em
// useState LOCAL do App.tsx e NÃO são zeradas pelo resetSessaoCompleta (que só
// mexe no store). O fix (#829) adiciona resetNavegadorSessao() após CADA
// fronteira de conta (login / logout / lock-recovery). Este tripwire trava o
// invariante: todo resetSessaoCompleta() é imediatamente seguido de
// resetNavegadorSessao() — senão uma nova fronteira herdaria as abas da conta
// anterior (o bug original). Roda com node --experimental-strip-types --test.

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("#821: resetNavegadorSessao existe e zera abas + aba ativa + pilha de fechadas", () => {
  const at = app.indexOf("function resetNavegadorSessao(");
  assert.notEqual(at, -1, "resetNavegadorSessao removido — abas não são zeradas na troca");
  const corpo = app.slice(at, app.indexOf("}", at) + 1);
  assert.match(corpo, /setAbas\(\[\]\)/, "não zera as abas");
  assert.match(corpo, /setAbaAtiva\(null\)/, "não zera a aba ativa");
  assert.match(corpo, /setFechadas\(\[\]\)/, "não zera a pilha de fechadas (Ctrl+Shift+T reabriria aba alheia)");
});

test("#821: TODA fronteira resetSessaoCompleta() é seguida de resetNavegadorSessao()", () => {
  const linhas = app.split("\n");
  const chamadas: number[] = [];
  linhas.forEach((l, i) => {
    // #1257: o seam virou `async` e agora é AWAITED na fronteira — aceita o prefixo.
    if (/^\s*(await )?resetSessaoCompleta\(\);/.test(l)) chamadas.push(i);
  });
  assert.ok(chamadas.length >= 3, `esperava >=3 fronteiras de conta, achei ${chamadas.length}`);
  for (const i of chamadas) {
    // a próxima linha de código não-vazia tem que ser o reset das abas
    let j = i + 1;
    while (j < linhas.length && linhas[j].trim() === "") j += 1;
    assert.match(
      linhas[j],
      /^\s*resetNavegadorSessao\(\);/,
      `resetSessaoCompleta() na linha ${i + 1} NÃO é seguido de resetNavegadorSessao() — abas vazariam pra conta nova (#821)`,
    );
  }
});
