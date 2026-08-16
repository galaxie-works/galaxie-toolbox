// #1017 — contrato do "VERDE ≠ PRONTO". Fora do Tauri (happy-dom, sem
// `window.__TAURI_INTERNALS__`) `inTauri()` é false. Antes deste fix os comandos
// de ESCRITA do Bridge (mail/calendar/people/org/share) resolviam com sucesso
// FABRICADO sem falar com backend nenhum — este teste FALHARIA antes (resolviam
// em silêncio) e passa agora (rejeitam explicitamente). As LEITURAS seguem
// mockadas de propósito (valor real do dev sem Tauri) e continuam resolvendo.
import { describe, it, expect } from "vitest";

import {
  inTauri,
  crEmail,
  crEnviarNovo,
  crResponder,
  crEncaminhar,
  crExcluirEmail,
  crExcluirEmails,
  crSalvarContatos,
  crCriarEvento,
  crPeopleContactDelete,
  crOrgTodoSet,
} from "./api.ts";
import type { EventoInput } from "./types.ts";

const REJEITA = /mock: escrita não suportada fora do Tauri/;

const eventoDummy: EventoInput = {
  assunto: "x",
  inicio: "2026-01-01T00:00:00",
  fim: "2026-01-01T01:00:00",
  diaInteiro: false,
  local: "",
  corpo: "",
  categorias: [],
  timeZone: "UTC",
  convidados: [],
  reuniaoTeams: false,
};

describe("#1017 mock não finge sucesso de escrita fora do Tauri", () => {
  it("está fora do Tauri no happy-dom (inTauri === false)", () => {
    expect(inTauri()).toBe(false);
  });

  it("escritas de mail REJEITAM em vez de mentir sucesso", async () => {
    await expect(
      crEnviarNovo(["a@b.com"], [], [], "assunto", "corpo"),
    ).rejects.toThrow(REJEITA);
    await expect(crResponder("id", "corpo", false)).rejects.toThrow(REJEITA);
    await expect(crEncaminhar("id", "corpo", ["a@b.com"])).rejects.toThrow(
      REJEITA,
    );
    await expect(crExcluirEmail("id")).rejects.toThrow(REJEITA);
    await expect(crExcluirEmails(["id"])).rejects.toThrow(REJEITA);
  });

  it("escritas de people/calendar/org REJEITAM em vez de mentir sucesso", async () => {
    await expect(crSalvarContatos([])).rejects.toThrow(REJEITA);
    await expect(crCriarEvento(eventoDummy)).rejects.toThrow(REJEITA);
    await expect(crPeopleContactDelete("id")).rejects.toThrow(REJEITA);
    await expect(crOrgTodoSet("campo", true)).rejects.toThrow(REJEITA);
  });

  it("LEITURA segue mockada e resolve sem lançar", async () => {
    const caixa = await crEmail();
    expect(caixa).toBeTruthy();
  });
});
