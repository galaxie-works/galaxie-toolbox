// #1309 — o modal de update não pode depender só da EXISTÊNCIA do pacote.
//
// Filha do #1264. Aquele card fechou o compare de versão e a `iris` aprovou o
// funil — o defeito que sobrou não estava nele.
//
// O bug do `wagner` (modal oferecendo a versão JÁ INSTALADA a cada abertura)
// nascia na FIAÇÃO: o componente confiava no pacote devolvido por `check()`. O
// feed republicado com data nova devolve pacote mesmo quando não há versão nova,
// e aí o modal aparecia.
//
// `versao-update.test.ts` tem 11 testes e nenhum pegava isso: eles guardam a
// FUNÇÃO, não o USO dela. Medido no card: trocar `if (!novo || !oferecer)` por
// `if (!novo)` deixava a suíte 463/463 verde e o `tsc -b` limpo.
//
// É a mesma família dos outros dois que me morderam hoje: #1374 (guarda no canal
// que não barra) e #1392 (guarda pinando a trava em vez do efeito). Unidade
// testada, fiação nua — e o defeito volta com tudo verde.
//
// Canal `component`: é obrigatório no CI, e o card mediu que ele dá conta.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { IdiomaProvider } from "@/lib/idioma";

/** A versão que o app diz ter instalada. */
const INSTALADA = "0.52.0";

const checkMock = vi.fn();

// O plugin não existe fora do Tauri — o componente o carrega por `import()`
// dinâmico justamente por isso, então o mock precisa existir como módulo.
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => checkMock() }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve(INSTALADA),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => Promise.resolve() }));

import { Atualizacao } from "./atualizacao";

/**
 * O componente só age dentro do Tauri (`inTauri()` do #1033, que lê
 * `window.__TAURI_INTERNALS__`). Atravessar o MESMO gate do runtime — em vez de
 * mockar a função — é o que faz este teste exercitar o caminho de verdade.
 */
function ligarTauri() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
function desligarTauri() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

/** O que o `check()` devolve quando o feed foi republicado sem versão nova. */
const pacoteDaMesmaVersao = {
  version: INSTALADA,
  date: "2026-08-20T10:00:00Z",
  body: "republicado",
  downloadAndInstall: vi.fn(),
};

const pacoteNovo = {
  version: "0.53.0",
  date: "2026-08-20T11:00:00Z",
  body: "novidades",
  downloadAndInstall: vi.fn(),
};

function montar() {
  render(
    <IdiomaProvider>
      <Atualizacao />
    </IdiomaProvider>,
  );
}

/** O modal só existe quando o componente decide oferecer; senão devolve `null`. */
async function modalApareceu(ms = 600): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (screen.queryByRole("alertdialog")) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

describe("#1309 fiação do modal de update", () => {
  beforeEach(() => {
    cleanup();
    checkMock.mockReset();
    ligarTauri();
  });
  afterEach(desligarTauri);

  it("pacote da versão JÁ INSTALADA não abre o modal (o bug do PO)", async () => {
    // O feed republicado devolve pacote; a versão é a mesma que está rodando.
    // Quem decide é o compare, nunca a existência do pacote.
    checkMock.mockResolvedValue(pacoteDaMesmaVersao);
    montar();
    expect(
      await modalApareceu(),
      "o modal abriu para a versão já instalada — é o defeito do #1264 de volta",
    ).toBe(false);
  });

  it("pacote de versão NOVA abre o modal — sem falso positivo", async () => {
    // A outra metade: uma guarda que só provasse o "não abre" passaria com o
    // componente quebrado de outro jeito (nunca abrir nada).
    checkMock.mockResolvedValue(pacoteNovo);
    montar();
    expect(
      await modalApareceu(),
      "o modal NÃO abriu para uma versão realmente nova",
    ).toBe(true);
  });

  it("sem pacote nenhum, nada aparece", async () => {
    checkMock.mockResolvedValue(null);
    montar();
    expect(await modalApareceu(300)).toBe(false);
  });

  it("`check()` falhando não estoura nem mostra erro no rosto do usuário", async () => {
    // O componente promete isso em comentário desde o início ("atualização é
    // conveniência — não pode virar mensagem de erro"). Promessa sem guarda é
    // exatamente o que este card combate.
    checkMock.mockRejectedValue(new Error("sem rede"));
    montar();
    expect(await modalApareceu(300)).toBe(false);
  });
});
