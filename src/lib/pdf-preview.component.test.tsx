// #1053 (TST-07): guarda do parser de PDF. Arquivo inválido/corrompido não pode
// virar exception não-capturada — tem de rejeitar de forma catchável.
// Roda no `component` (vitest) porque `pdf-preview.ts` importa o worker via
// `?url` (asset do Vite), que o node --test não resolve.
import { describe, it, expect } from "vitest";
import { carregarPdf } from "./pdf-preview";

describe("#1053 carregarPdf — erro tratado em PDF inválido", () => {
  it("bytes que NÃO começam com %PDF → rejeita (erro catchável)", async () => {
    const lixo = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await expect(carregarPdf(lixo)).rejects.toBeDefined();
  });

  it("header %PDF mas corpo truncado/corrompido → rejeita, não trava", async () => {
    // "%PDF-1.4\n" seguido de lixo: passa o sniff de header, quebra no parse.
    const header = new TextEncoder().encode("%PDF-1.4\n%\xFF\xFF corrupto");
    await expect(carregarPdf(header)).rejects.toBeDefined();
  });

  it("vazio → rejeita", async () => {
    await expect(carregarPdf(new Uint8Array(0))).rejects.toBeDefined();
  });
});
