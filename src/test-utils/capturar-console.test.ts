import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLogou,
  assertNaoLogou,
  capturarConsole,
  comConsole,
} from "./capturar-console.ts";

// #1301 — os testes do próprio helper. O que importa provar aqui não é que ele
// captura (isso é o caminho feliz óbvio), e sim que ele **restaura** e que não
// deixa a suíte silenciosamente mockada.

test("#1301: captura por nível e casa por trecho", () => {
  const c = capturarConsole();
  console.error("falha ao minimizar a janela");
  console.warn("aviso qualquer");
  c.restaurar();

  assert.equal(c.chamadas.error.length, 1);
  assertLogou(c, "error", "minimizar");
  assertNaoLogou(c, "error", "maximizar");
  assertLogou(c, "warn", "aviso");
});

test("#1301: junta Error e objeto no texto — o código real loga assim", () => {
  const c = capturarConsole();
  console.error("falha:", new Error("window.minimize not allowed"), { botao: "minimizar" });
  c.restaurar();

  assertLogou(c, "error", "not allowed");
  assertLogou(c, "error", "minimizar");
});

test("#1301: restaura o console — o próximo teste não herda o mock", () => {
  const original = console.error;
  const c = capturarConsole();
  assert.notEqual(console.error, original, "durante a captura o console é trocado");
  c.restaurar();
  assert.equal(console.error, original, "depois de restaurar, o console é o mesmo objeto");
});

test("#1301: comConsole restaura MESMO se o corpo lançar", async () => {
  const original = console.error;
  await assert.rejects(
    comConsole(() => {
      console.error("antes de explodir");
      throw new Error("explodiu");
    }),
    /explodiu/,
  );
  assert.equal(
    console.error,
    original,
    "o finally tem de devolver o console; é isto que o spy ad hoc do #1179 não garantia",
  );
});

test("#1301: comConsole devolve resultado e captura juntos", async () => {
  const { resultado, capturado } = await comConsole(async () => {
    console.warn("processando");
    return 42;
  });
  assert.equal(resultado, 42);
  assertLogou(capturado, "warn", "processando");
});

test("#1301: assertLogou lista o que foi capturado quando falha", () => {
  const c = capturarConsole();
  console.error("mensagem que existe");
  c.restaurar();

  assert.throws(
    () => assertLogou(c, "error", "mensagem que NAO existe"),
    (e: Error) => {
      // a mensagem de falha precisa mostrar o que havia — senão quem depura
      // fica adivinhando.
      assert.match(e.message, /mensagem que existe/);
      return true;
    },
  );
});
