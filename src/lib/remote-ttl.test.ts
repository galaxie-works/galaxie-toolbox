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

test("#1148 imunidade a skew: mesmo TTL do cliente → mesmo gatilho, qualquer relógio de servidor", () => {
  // A: servidor alinhado ao cliente. B: servidor ~1e6 s adiantado. Mesmo TTL
  // efetivo (3600) porque a duração é medida no cliente na chegada. A decisão só
  // olha o DECORRIDO no cliente — nunca o `expiresAt` absoluto do servidor.
  const chegadaA = 0;
  const chegadaB = 1_000_000;
  const a = horizonteTtl([srv(chegadaA + 3600)], chegadaA)!;
  const b = horizonteTtl([srv(chegadaB + 3600)], chegadaB)!;
  assert.equal(a.ttlEfetivoSeg, b.ttlEfetivoSeg); // 3600 nos dois

  for (const decorrido of [0, 2699, 2700, 3599]) {
    assert.equal(
      deveAvisarExpiracao(a, chegadaA + decorrido),
      deveAvisarExpiracao(b, chegadaB + decorrido),
      `o skew do servidor mudou a decisão em decorrido=${decorrido} — não devia`,
    );
  }
  assert.equal(deveAvisarExpiracao(a, chegadaA + 2700), true);
  assert.equal(deveAvisarExpiracao(b, chegadaB + 2700), true);
});
