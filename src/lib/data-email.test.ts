import { test } from "node:test";
import assert from "node:assert/strict";

import { comZ, hora, faixaHora, quandoCurto } from "./data-email.ts";

// Nota: hora/faixaHora/quandoCurto usam `toLocaleTimeString` (fuso LOCAL da
// máquina), então o HH:MM exato varia por TZ. Os testes checam FORMA e
// comportamento (TZ-invariantes), não o horário absoluto.

test("comZ: adiciona Z só quando falta (puro, sem TZ)", () => {
  assert.equal(comZ("2026-08-17T10:00:00"), "2026-08-17T10:00:00Z");
  assert.equal(comZ("2026-08-17T10:00:00Z"), "2026-08-17T10:00:00Z");
});

test("hora: HH:MM pra ISO válido; vazio pra inválido", () => {
  assert.match(hora("2026-08-17T13:05:00Z", "pt-BR"), /^\d{1,2}:\d{2}$/);
  assert.equal(hora("lixo", "pt-BR"), "");
  assert.equal(hora("", "pt-BR"), "");
});

test("faixaHora: 'a – b' com fim; só 'a' sem fim", () => {
  assert.match(
    faixaHora("2026-08-17T13:00:00Z", "2026-08-17T14:30:00Z", "pt-BR"),
    /^\d{1,2}:\d{2} – \d{1,2}:\d{2}$/,
  );
  assert.match(faixaHora("2026-08-17T13:00:00Z", "", "pt-BR"), /^\d{1,2}:\d{2}$/);
});

test("quandoCurto: inválido → vazio; data antiga → 'data · hora'", () => {
  assert.equal(quandoCurto("lixo", "pt-BR"), "");
  const s = quandoCurto("2020-01-02T09:15:00Z", "pt-BR");
  assert.match(s, /·/); // não-hoje traz a data curta + separador
  assert.match(s, /\d{1,2}:\d{2}/); // e a hora
});
