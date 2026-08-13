import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rustLib = readFileSync(
  new URL("../../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);

const loginStart = rustLib.indexOf("async fn login(");
const logoutStart = rustLib.indexOf("async fn logout(", loginStart);
const loginCommand = rustLib.slice(loginStart, logoutStart);
const signatureEnd = loginCommand.indexOf(") ->");
const loginSignature = loginCommand.slice(0, signatureEnd);

test("o comando Tauri login recebe o provider escolhido pelo frontend", () => {
  assert.ok(loginStart >= 0 && signatureEnd >= 0, "comando login nao encontrado");
  assert.match(
    loginSignature,
    /\bprovider\s*:/,
    "o frontend envia provider, mas a assinatura Rust nao o recebe",
  );
});

test("o comando Tauri login nao fixa Microsoft ao escolher o provider", () => {
  assert.doesNotMatch(
    loginCommand,
    /provider_de\(auth::Provider::Microsoft\)/,
    "a selecao do frontend e ignorada e o backend fixa Microsoft",
  );
});
