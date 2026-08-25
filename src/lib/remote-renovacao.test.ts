// #1148 — prova a renovação COM O RELÓGIO ADIANTADO (DoD), sem `sleep`: relógio e
// timer são injetados, então o teste avança o tempo e verifica que o agendador
// pede a renovação a 3/4, aplica a credencial nova, reagenda pelo NOVO expires_at,
// e avisa+retry se a renovação não voltar na janela de risco.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularAtrasoRenovacaoMs,
  expiraMaisCedo,
  criarAgendadorRenovacao,
} from "./remote-renovacao.ts";

function ice(expiresAt: number) {
  return [{ urls: ["turn:x"], username: "u", credential: "c", expiresAtUnixSeconds: expiresAt }];
}

test("#1148 atraso = 3/4 do restante (do expires_at, nunca constante)", () => {
  // 1800s restantes → 3/4 = 1350s
  assert.equal(calcularAtrasoRenovacaoMs(1000 + 1800, 1000), 1_350_000);
  // 3600s restantes → 2700s (escala com o expires_at, não é fixo)
  assert.equal(calcularAtrasoRenovacaoMs(1000 + 3600, 1000), 2_700_000);
  // já vencida → renova já
  assert.equal(calcularAtrasoRenovacaoMs(500, 1000), 0);
});

test("#1148 expiraMaisCedo pega o primeiro a vencer", () => {
  assert.equal(
    expiraMaisCedo([
      { urls: [], username: "", credential: "", expiresAtUnixSeconds: 5000 },
      { urls: [], username: "", credential: "", expiresAtUnixSeconds: 3000 },
    ]),
    3000,
  );
});

// --- Relógio + timer FALSOS (injetados) -------------------------------------
function ambiente(baseSeg: number) {
  let relogioMs = 0;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let seq = 0;
  const eventos = { pedidos: 0, aplicados: [] as unknown[], avisos: [] as boolean[] };
  const deps = {
    agoraUnixSeconds: () => baseSeg + Math.floor(relogioMs / 1000),
    agendar: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.push({ id, at: relogioMs + ms, fn });
      return id;
    },
    cancelar: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    pedirRenovacao: () => {
      eventos.pedidos++;
    },
    aplicar: (ice: unknown) => {
      eventos.aplicados.push(ice);
    },
    aoAvisar: (r: boolean) => {
      eventos.avisos.push(r);
    },
  };
  function avancarMs(ms: number) {
    relogioMs += ms;
    for (let guarda = 0; guarda < 1000; guarda++) {
      const due = timers.filter((t) => t.at <= relogioMs).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  }
  return { deps, eventos, avancarMs };
}

test("#1148 pede renovação a 3/4, aplica a nova e reagenda pelo NOVO expires_at", () => {
  const { deps, eventos, avancarMs } = ambiente(1000);
  const ag = criarAgendadorRenovacao(deps);
  ag.iniciar(ice(1000 + 1800)); // vence em 1800s → renova em 1350s

  avancarMs(1_349_000); // quase lá
  assert.equal(eventos.pedidos, 0, "não pede antes de 3/4");
  avancarMs(2_000); // cruza 1350s
  assert.equal(eventos.pedidos, 1, "pediu a renovação a 3/4");

  // servidor responde com credencial fresca (novo expires_at bem à frente)
  const agoraAoRenovar = 1000 + Math.floor((1_351_000) / 1000);
  ag.aoRenovado(ice(agoraAoRenovar + 1800));
  assert.equal(eventos.aplicados.length, 1, "aplicou a credencial nova");
  assert.deepEqual(eventos.avisos.at(-1), false, "limpou o aviso ao renovar");

  // o próximo ciclo agenda pelo NOVO expires_at (mais 1350s), não repete cedo
  eventos.pedidos = 0;
  avancarMs(1_349_000);
  assert.equal(eventos.pedidos, 0, "não re-pede antes de 3/4 do NOVO prazo");
  avancarMs(2_000);
  assert.equal(eventos.pedidos, 1, "re-pediu a 3/4 do novo prazo (gatilho vem do expires_at)");
});

test("#1148 renovação que não volta → avisa (≥1/4 TTL) e re-pede (retry)", () => {
  const { deps, eventos, avancarMs } = ambiente(1000);
  const ag = criarAgendadorRenovacao(deps);
  ag.iniciar(ice(1000 + 1800));

  avancarMs(1_350_000); // dispara o pedido a 3/4
  assert.equal(eventos.pedidos, 1);
  assert.equal(eventos.avisos.length, 0, "sem aviso enquanto a janela de risco não estoura");

  // NÃO chega IceServersRenewed; a janela de risco (1/4 = 450s) estoura
  avancarMs(450_000);
  assert.deepEqual(eventos.avisos.at(-1), true, "avisou o risco antes do vencimento");
  assert.equal(eventos.pedidos, 2, "re-pediu (retry) — a antiga ainda pode estar de pé");
});

test("#1148 parar cancela os timers (fim de sessão não renova mais)", () => {
  const { deps, eventos, avancarMs } = ambiente(1000);
  const ag = criarAgendadorRenovacao(deps);
  ag.iniciar(ice(1000 + 1800));
  ag.parar();
  avancarMs(5_000_000);
  assert.equal(eventos.pedidos, 0, "parado: não pede renovação");
});
