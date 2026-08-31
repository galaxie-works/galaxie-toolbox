// #1148 (fatia C): a lógica do relógio de TTL, provada sem montar a tela nem
// mexer no relógio real (o `agora` é um parâmetro). O ponto sensível é a
// IMUNIDADE A SKEW — o último teste é o que a prova.
import test from "node:test";
import assert from "node:assert/strict";
import { horizonteTtl, deveAvisarExpiracao } from "./remote-ttl.ts";
import type { IceServer } from "./remote-signaling";

function srv(expiresAtUnixSeconds: number): IceServer {
  return { urls: ["turn:x"], username: "u", credential: "c", expiresAtUnixSeconds };
}

test("#1148 horizonteTtl: pega o PRIMEIRO a morrer e mede o TTL no relógio do cliente", () => {
  const h = horizonteTtl([srv(3600), srv(1800), srv(7200)], 100);
  assert.deepEqual(h, { medidoEmSeg: 100, ttlEfetivoSeg: 1700 }); // min(1800) − 100
});

test("#1148 horizonteTtl: sem expiração > 0 → null (só STUN, nada a vigiar)", () => {
  assert.equal(horizonteTtl([srv(0)], 100), null);
  assert.equal(horizonteTtl([], 100), null);
});

test("#1148 deveAvisarExpiracao: gatilho no último 1/4 do TTL", () => {
  const h = horizonteTtl([srv(3600)], 0)!; // ttl 3600, chegou em 0
  assert.equal(deveAvisarExpiracao(h, 0), false); // recém-chegado
  assert.equal(deveAvisarExpiracao(h, 2699), false); // restante 901 > 900
  assert.equal(deveAvisarExpiracao(h, 2700), true); // restante 900 == 1/4 → avisa (≤)
  assert.equal(deveAvisarExpiracao(h, 3600), true); // no fim
});

test("#1148 deveAvisarExpiracao: horizonte ausente ou sem futuro NÃO avisa", () => {
  assert.equal(deveAvisarExpiracao(null, 100), false);
  const semFuturo = horizonteTtl([srv(50)], 100)!; // expira < chegada → ttl 0
  assert.equal(semFuturo.ttlEfetivoSeg, 0);
  assert.equal(deveAvisarExpiracao(semFuturo, 100), false);
});

test("#1148 a decisão só depende do DECORRIDO no cliente (offset absoluto não muda nada)", () => {
  // ⚠️ Correção do @Altair (#1682): isto prova a imunidade da CONTAGEM a um
  // offset ABSOLUTO da linha do tempo (chegada e expira deslocadas JUNTAS) — NÃO
  // imunidade a skew entre os relógios servidor↔cliente. Esse skew entra inteiro
  // no `ttlEfetivo` na MEDIÇÃO inicial (`expira` do servidor − `agora` do
  // cliente) e não é testável aqui; a cura de raiz é `ttl_seconds` do servidor
  // (fatia B/#1527). O que se garante: `deveAvisar` olha só `agora − medidoEm`,
  // então o epoch absoluto é irrelevante.
  const baseA = 0;
  const baseB = 1_000_000;
  const a = horizonteTtl([srv(baseA + 3600)], baseA)!;
  const b = horizonteTtl([srv(baseB + 3600)], baseB)!;
  assert.equal(a.ttlEfetivoSeg, b.ttlEfetivoSeg); // 3600 nos dois

  for (const decorrido of [0, 2699, 2700, 3599]) {
    assert.equal(
      deveAvisarExpiracao(a, baseA + decorrido),
      deveAvisarExpiracao(b, baseB + decorrido),
      `o offset absoluto mudou a decisão em decorrido=${decorrido} — não devia`,
    );
  }
  assert.equal(deveAvisarExpiracao(a, baseA + 2700), true);
  assert.equal(deveAvisarExpiracao(b, baseB + 2700), true);
});
