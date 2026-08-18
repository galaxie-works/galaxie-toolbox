import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// #1257 (P0) — vazamento de sessão entre contas: `resetSessaoCompleta` zerava o
// store FE + o memo curto do Graph (`void resetSessionMemo()`, fire-and-forget),
// mas NÃO a sessão de conta no Rust (token em memória + `sessao.bin` no disco).
// Nos boundaries de LOGOUT havia `api.logout()` compensando; no boundary de
// LOGIN/troca (`handleLogin`) NÃO — então um login cancelado/interrompido deixava
// o token da conta anterior vivo e o Bridge servia a caixa dela.
//
// O fix funil: `resetSessaoCompleta` virou async e chama `clearAccountSession()`
// AWAITED (token/sessao.bin/identidade/memo, sem o PIN). Estes tripwires travam o
// invariante em código-fonte (o node --test não carrega o store real — alias `@/`
// + persist/localStorage), do jeito dos contratos irmãos (#821/#555).

const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

function corpoResetSessao(src: string): string {
  const at = src.indexOf("export async function resetSessaoCompleta(");
  assert.notEqual(
    at,
    -1,
    "resetSessaoCompleta não é mais `export async function` — o clear Rust precisa ser awaited (#1257)",
  );
  const fim = src.indexOf("\n}", at);
  assert.notEqual(fim, -1, "corpo de resetSessaoCompleta não fechou");
  return src.slice(at, fim + 2);
}

test("#1257: resetSessaoCompleta limpa a SESSÃO DE CONTA no Rust, awaited", () => {
  const corpo = corpoResetSessao(index);
  assert.match(
    corpo,
    /await\s+clearAccountSession\(\)/,
    "resetSessaoCompleta NÃO chama `await clearAccountSession()` — o token da conta anterior sobrevive no Rust (vazamento entre contas, #1257)",
  );
});

test("#1257: o boundary NÃO volta ao clear memo-only fire-and-forget (o bug de origem)", () => {
  const corpo = corpoResetSessao(index);
  assert.doesNotMatch(
    corpo,
    /void\s+resetSessionMemo\(\)/,
    "resetSessaoCompleta voltou ao `void resetSessionMemo()` — isso só zera o memo de 2,5s, não o token/sessão da conta (regressão do #1257)",
  );
});

test("#1257: TODA fronteira de conta faz `await resetSessaoCompleta()` (senão o clear corre com o novo login)", () => {
  const chamadas = app
    .split("\n")
    .filter((l) => /resetSessaoCompleta\(\)/.test(l));
  assert.ok(
    chamadas.length >= 3,
    `esperava >=3 fronteiras de conta chamando resetSessaoCompleta, achei ${chamadas.length}`,
  );
  for (const l of chamadas) {
    assert.match(
      l,
      /await\s+resetSessaoCompleta\(\)/,
      `fronteira sem await: "${l.trim()}" — sem await, o clear da sessão Rust corre com o api.login() e pode zerar o token novo (#1257)`,
    );
  }
});
