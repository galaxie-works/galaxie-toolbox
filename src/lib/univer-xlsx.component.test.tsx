// #1053 (TST-07): guarda do parser de XLSX. Arquivo inválido/corrompido não
// pode virar exception não-capturada — tem de rejeitar de forma catchável, pra
// o viewer tratar. Roda no projeto `component` (vitest) porque o ExcelJS resolve
// melhor pelo resolver do Vite que pelo strip-types do node.
import { describe, it, expect } from "vitest";
import { xlsxParaWorkbookData } from "./univer-xlsx";

describe("#1053 xlsxParaWorkbookData — erro tratado em arquivo inválido", () => {
  it("bytes que NÃO são um zip/xlsx → rejeita (erro catchável, não throw solto)", async () => {
    // Um .xlsx é um zip; estes bytes não têm nem a assinatura PK do zip.
    const lixo = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await expect(xlsxParaWorkbookData(lixo)).rejects.toBeDefined();
  });

  it("zip válido mas SEM as partes do xlsx → também rejeita, não devolve lixo", async () => {
    // Assinatura PK (zip) seguida de lixo: engana o 1º byte-check, quebra ao ler
    // as partes do OOXML. Prova que a rejeição não depende só da assinatura.
    const pk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]);
    await expect(xlsxParaWorkbookData(pk)).rejects.toBeDefined();
  });

  it("vazio → rejeita", async () => {
    await expect(xlsxParaWorkbookData(new Uint8Array(0))).rejects.toBeDefined();
  });
});
