// #1148 (fatia B): o forwarding do `ttl_seconds` é LOAD-BEARING — se cair, o Rust
// rearma `reemitir_em` em `None` e a 2ª reemissão nunca acontece (auto-desliga em
// silêncio). Esta guarda mata exatamente essa regressão.
import test from "node:test";
import assert from "node:assert/strict";
import { iceServersParaTransporte } from "./remote-renew.ts";

test("#1148 iceServersParaTransporte: forwarda o ttl_seconds (camelCase→snake_case)", () => {
  const out = iceServersParaTransporte([
    { urls: ["turn:a"], username: "u1", credential: "c1", ttlSeconds: 3600 },
    { urls: ["turn:b"], username: "u2", credential: "c2", ttlSeconds: 900 },
  ]);
  assert.deepEqual(out, [
    { urls: ["turn:a"], username: "u1", credential: "c1", ttl_seconds: 3600 },
    { urls: ["turn:b"], username: "u2", credential: "c2", ttl_seconds: 900 },
  ]);
});

test("#1148 iceServersParaTransporte: ttl_seconds=0 fica PRESENTE (não omitido) — desarmar é decisão do Rust, não do FE", () => {
  const [out] = iceServersParaTransporte([
    { urls: ["turn:a"], username: "u", credential: "c", ttlSeconds: 0 },
  ]);
  assert.ok(out && "ttl_seconds" in out, "o campo sumiu — o Rust cairia no default e desarmaria");
  assert.equal(out.ttl_seconds, 0);
});
