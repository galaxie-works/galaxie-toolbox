import assert from "node:assert/strict";
import { test } from "node:test";

import {
  criarAtom,
  ordenarAtoms,
  pontuar,
  type AtomItem,
} from "./atoms.ts";

const AGORA = 1_700_000_000_000; // epoch fixo (sem relógio real nos testes)
const MIN = 60_000;
const HORA = 3_600_000;

test("#183 iminência: evento em ≤30 min lidera e ramp aumenta perto do início", () => {
  const em10 = pontuar({ origem: "agenda", quando: AGORA + 10 * MIN }, AGORA);
  const em25 = pontuar({ origem: "agenda", quando: AGORA + 25 * MIN }, AGORA);
  assert.equal(em10.motivo, "iminente");
  assert.equal(em10.minutos, 10);
  assert.ok(em10.score > em25.score, "mais perto = score maior");
  assert.ok(em10.score > 0.8 && em10.score <= 1);
});

test("#183 evento fora da janela de 30 min não é iminente", () => {
  const em90 = pontuar(
    { origem: "agenda", quando: AGORA + 90 * MIN, hoje: true },
    AGORA,
  );
  assert.equal(em90.motivo, "hoje");
  assert.ok(em90.score < 0.5);
});

test("#183 to-do vencido > vence hoje", () => {
  const vencido = pontuar({ origem: "todo", vencido: true }, AGORA);
  const hoje = pontuar({ origem: "todo", hoje: true }, AGORA);
  assert.equal(vencido.motivo, "vencido");
  assert.equal(hoje.motivo, "prazoHoje");
  assert.ok(vencido.score > hoje.score);
});

test("#183 sinalizado > não-lido recente; não-lido decai com a idade", () => {
  const sinalizado = pontuar({ origem: "email", flagged: true }, AGORA);
  const naoLidoNovo = pontuar(
    { origem: "email", naoLido: true, quando: AGORA - 1 * HORA },
    AGORA,
  );
  const naoLidoVelho = pontuar(
    { origem: "email", naoLido: true, quando: AGORA - 20 * HORA },
    AGORA,
  );
  assert.equal(sinalizado.motivo, "sinalizado");
  assert.equal(naoLidoNovo.motivo, "naoLido");
  assert.ok(sinalizado.score > naoLidoNovo.score);
  assert.ok(naoLidoNovo.score > naoLidoVelho.score, "não-lido decai");
});

test("#183 e-mail sinalizado E não-lido pega o motivo mais forte (sinalizado)", () => {
  const r = pontuar(
    { origem: "email", flagged: true, naoLido: true, quando: AGORA - 1 * HORA },
    AGORA,
  );
  assert.equal(r.motivo, "sinalizado");
});

test("#183 sem sinal relevante → futuro, score baixo", () => {
  const r = pontuar({ origem: "email" }, AGORA);
  assert.equal(r.motivo, "futuro");
  assert.ok(r.score < 0.1);
});

test("#183 ordenarAtoms: score desc, empate por quando asc", () => {
  const itens: AtomItem[] = [
    criarAtom("a", "agenda", "Depois", { origem: "agenda", quando: AGORA + 20 * MIN }, AGORA),
    criarAtom("b", "agenda", "Já já", { origem: "agenda", quando: AGORA + 5 * MIN }, AGORA),
    criarAtom("c", "email", "Flag", { origem: "email", flagged: true }, AGORA),
  ];
  const ordem = ordenarAtoms(itens).map((i) => i.id);
  // b (iminente 5min) > a (iminente 20min) > c (sinalizado 0.6)
  assert.deepEqual(ordem, ["b", "a", "c"]);
});
