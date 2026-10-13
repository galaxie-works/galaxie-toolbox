// #1148: a lógica do relógio de TTL, provada sem montar a tela nem mexer no
// relógio real (o `agora` é um parâmetro). Dois pontos sensíveis:
//  - IMUNIDADE A SKEW da CONTAGEM (o teste de offset absoluto a prova);
//  - o +retry (@Altair, #1148 comment 6137632496): o aviso acende pela CARÊNCIA
//    (renovação pendente > carência) ou por um PISO de ≤1/5 restante — NÃO mais
//    no 1/4. O teste de "no caminho feliz não pisca" e o mutante do piso provam.
import test from "node:test";
import assert from "node:assert/strict";
import {
  horizonteTtl,
  deveAvisarExpiracao,
  CARENCIA_RENOVACAO_SEG,
  type HorizonteTtl,
  type EstadoAvisoExpiracao,
} from "./remote-ttl.ts";
import type { IceServer } from "./remote-signaling";

function srv(expiresAtUnixSeconds: number): IceServer {
  // ttlSeconds (#1148 fatia B) não entra na lógica de aviso — só no handback.
  return { urls: ["turn:x"], username: "u", credential: "c", expiresAtUnixSeconds, ttlSeconds: 0 };
}

/** Monta o estado do aviso (horizonte + pendência da renovação). */
function est(
  horizonte: HorizonteTtl | null,
  renovacaoPendenteDesdeSeg: number | null = null,
): EstadoAvisoExpiracao {
  return { horizonte, renovacaoPendenteDesdeSeg };
}

test("#1148 horizonteTtl: pega o PRIMEIRO a morrer e mede o TTL no relógio do cliente", () => {
  const h = horizonteTtl([srv(3600), srv(1800), srv(7200)], 100);
  assert.deepEqual(h, { medidoEmSeg: 100, ttlEfetivoSeg: 1700 }); // min(1800) − 100
});

test("#1148 horizonteTtl: sem expiração > 0 → null (só STUN, nada a vigiar)", () => {
  assert.equal(horizonteTtl([srv(0)], 100), null);
  assert.equal(horizonteTtl([], 100), null);
});

test("#1148 +retry: a carência é a desenhada (30 s) — mudar é deliberado", () => {
  // Pin do valor (como o guard do literal do #1728): se alguém mexer na carência,
  // é decisão de design (@Altair, #1148), não efeito colateral.
  assert.equal(CARENCIA_RENOVACAO_SEG, 30);
});

test("#1148 +retry: PISO duro acende em ≤1/5 do TTL (sem pendência)", () => {
  const h = horizonteTtl([srv(3600)], 0)!; // ttl 3600, chegou em 0 → 1/5 = 720 s
  assert.equal(deveAvisarExpiracao(est(h), 0), false); // recém-chegado
  assert.equal(deveAvisarExpiracao(est(h), 2879), false); // restante 721 > 720
  assert.equal(deveAvisarExpiracao(est(h), 2880), true); // restante 720 == 1/5 → avisa (≤)
  assert.equal(deveAvisarExpiracao(est(h), 3600), true); // no fim
});

test("#1148 +retry: MUTANTE do piso — na faixa 1/5..1/4 o banner fica APAGADO (sem o antigo 1/4)", () => {
  // Esta é a regressão que o #1148 +retry conserta: às 3/4 decorridas (restante
  // 1/4 = 900 s) a renovação DISPARA; com o piso em 1/5, o banner NÃO acende aí.
  // Se alguém reverter o piso para 1/4, este teste MORDE (passava a true).
  const h = horizonteTtl([srv(3600)], 0)!;
  assert.equal(deveAvisarExpiracao(est(h), 2700), false); // restante 900 (= 1/4) → NÃO avisa
  assert.equal(deveAvisarExpiracao(est(h), 2800), false); // restante 800 (entre 1/5 e 1/4) → NÃO avisa
});

test("#1148 +retry: caminho FELIZ não pisca — renovação resolvida (pendência limpa) e > 1/5 → apagado", () => {
  // No sucesso, o FE limpa a pendência (onIceServersRenovados → registrarExpiracao)
  // e repõe o horizonte. Enquanto resta > 1/5, o aviso fica apagado — sem flicker.
  const h = horizonteTtl([srv(3600)], 0)!;
  assert.equal(deveAvisarExpiracao(est(h, null), 2700), false);
});

test("#1148 +retry: CARÊNCIA acende quando a renovação está pendente > 30 s", () => {
  const h = horizonteTtl([srv(3600)], 0)!;
  const desde = 2700; // pendente desde o disparo (3/4), relógio do cliente
  assert.equal(deveAvisarExpiracao(est(h, desde), 2700), false); // 0 s pendente
  assert.equal(deveAvisarExpiracao(est(h, desde), desde + 30), false); // 30 s — "mais de" é estrito
  assert.equal(deveAvisarExpiracao(est(h, desde), desde + 31), true); // 31 s → avisa
});

test("#1148 +retry: a CARÊNCIA vence mesmo sem horizonte (renovação pendente implica credencial que existiu)", () => {
  // Se a pendência passa da carência, o aviso acende independentemente do piso —
  // inclusive com horizonte null. Prova que a pendência é o sinal PRIMÁRIO.
  assert.equal(deveAvisarExpiracao(est(null, 0), 30), false);
  assert.equal(deveAvisarExpiracao(est(null, 0), 31), true);
});

test("#1148 sem pendência e sem horizonte (ou TTL ≤ 0) NÃO avisa", () => {
  assert.equal(deveAvisarExpiracao(est(null, null), 100), false);
  const semFuturo = horizonteTtl([srv(50)], 100)!; // expira < chegada → ttl 0
  assert.equal(semFuturo.ttlEfetivoSeg, 0);
  assert.equal(deveAvisarExpiracao(est(semFuturo, null), 100), false);
});

test("#1148 a decisão só depende do DECORRIDO no cliente (offset absoluto não muda nada)", () => {
  // ⚠️ Correção do @Altair (#1682): isto prova a imunidade da CONTAGEM a um
  // offset ABSOLUTO da linha do tempo (chegada e expira deslocadas JUNTAS) — NÃO
  // imunidade a skew entre os relógios servidor↔cliente. Esse skew entra inteiro
  // no `ttlEfetivo` na MEDIÇÃO inicial (`expira` do servidor − `agora` do
  // cliente) e não é testável aqui; a cura de raiz é `ttl_seconds` do servidor
  // (fatia B/#1527). O que se garante: o piso olha só `agora − medidoEm` e a
  // carência só `agora − pendenteDesde`, então o epoch absoluto é irrelevante.
  const baseA = 0;
  const baseB = 1_000_000;
  const a = horizonteTtl([srv(baseA + 3600)], baseA)!;
  const b = horizonteTtl([srv(baseB + 3600)], baseB)!;
  assert.equal(a.ttlEfetivoSeg, b.ttlEfetivoSeg); // 3600 nos dois

  // Piso (sem pendência) e carência (pendente desde o disparo) — ambos imunes.
  for (const decorrido of [0, 2879, 2880, 3599]) {
    assert.equal(
      deveAvisarExpiracao(est(a), baseA + decorrido),
      deveAvisarExpiracao(est(b), baseB + decorrido),
      `piso: o offset absoluto mudou a decisão em decorrido=${decorrido} — não devia`,
    );
  }
  for (const pend of [0, 30, 31, 120]) {
    assert.equal(
      deveAvisarExpiracao(est(a, baseA + 2700), baseA + 2700 + pend),
      deveAvisarExpiracao(est(b, baseB + 2700), baseB + 2700 + pend),
      `carência: o offset absoluto mudou a decisão em pendente=${pend}s — não devia`,
    );
  }
  assert.equal(deveAvisarExpiracao(est(a), baseA + 2880), true);
  assert.equal(deveAvisarExpiracao(est(b), baseB + 2880), true);
});
