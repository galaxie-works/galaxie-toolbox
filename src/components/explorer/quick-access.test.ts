// #869 (Quick access pin/sort): testes headless dos helpers PUROS do Acesso
// rápido fixável (add/remove/dedup/merge/sort). Rode com:
//   node --test --experimental-strip-types src/components/explorer/quick-access.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adicionarPin,
  estaFixado,
  estaOculto,
  mesclarAcessoRapido,
  ocultar,
  removerPin,
  restaurar,
  type PinAcessoRapido,
} from "./quick-access.ts";
import type { FsEntry } from "../../lib/types.ts";

function entry(name: string, path: string): FsEntry {
  return {
    name,
    path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
  };
}

test("estaFixado compara sem barra final e case-insensitive (NTFS)", () => {
  const pins: PinAcessoRapido[] = [{ path: "C:\\Users\\W\\Projetos", name: "Projetos" }];
  assert.equal(estaFixado(pins, "C:\\Users\\W\\Projetos"), true);
  assert.equal(estaFixado(pins, "c:\\users\\w\\projetos\\"), true);
  assert.equal(estaFixado(pins, "C:\\Users\\W\\Outra"), false);
});

test("adicionarPin dedupe por caminho normalizado e não muta", () => {
  const pins: PinAcessoRapido[] = [{ path: "C:\\A", name: "A" }];
  const mais = adicionarPin(pins, { path: "C:\\B", name: "B" });
  assert.deepEqual(mais.map((p) => p.name), ["A", "B"]);
  // Duplicata (mesmo caminho, barra/case diferente) → array inalterado.
  const dup = adicionarPin(mais, { path: "c:\\a\\", name: "A2" });
  assert.equal(dup, mais);
  // Original intacto.
  assert.deepEqual(pins.map((p) => p.name), ["A"]);
});

test("removerPin tira por caminho normalizado; no-op se ausente", () => {
  const pins: PinAcessoRapido[] = [
    { path: "C:\\A", name: "A" },
    { path: "C:\\B", name: "B" },
  ];
  assert.deepEqual(removerPin(pins, "c:\\a\\").map((p) => p.name), ["B"]);
  assert.deepEqual(removerPin(pins, "C:\\Z").map((p) => p.name), ["A", "B"]);
});

test("mesclarAcessoRapido junta pins + sistema, dedupe e ordena por nome", () => {
  const pins: PinAcessoRapido[] = [
    { path: "C:\\Zulu", name: "Zulu" },
    { path: "C:\\Alpha", name: "Alpha" },
  ];
  const sistema: FsEntry[] = [
    entry("Downloads", "C:\\Users\\W\\Downloads"),
    entry("Documentos", "C:\\Users\\W\\Documentos"),
  ];
  const out = mesclarAcessoRapido(pins, sistema);
  // Ordenado alfabético por nome exibido, tudo unificado.
  assert.deepEqual(out.map((e) => e.name), ["Alpha", "Documentos", "Downloads", "Zulu"]);
  // Cada entrada vira FsEntry de pasta (expansível).
  assert.ok(out.every((e) => e.isDir));
});

test("mesclarAcessoRapido dedupe caminho fixado que já é dir do sistema", () => {
  const pins: PinAcessoRapido[] = [{ path: "c:\\users\\w\\downloads\\", name: "Baixados" }];
  const sistema: FsEntry[] = [entry("Downloads", "C:\\Users\\W\\Downloads")];
  const out = mesclarAcessoRapido(pins, sistema);
  assert.equal(out.length, 1);
  // O rótulo do usuário (pin) prevalece sobre o do sistema no mesmo caminho.
  assert.equal(out[0].name, "Baixados");
});

// --- #1285 (A): ocultar itens de SISTEMA do Acesso rapido -------------------
// Paths com forward-slash + `BS` (backslash construido) para o caso de barra
// final, evitando escape literal ruidoso no source.
const BS = String.fromCharCode(92);

test("estaOculto: case-insensitive e ignora barra final", () => {
  const ocultos = ["C:/Users/consa/Desktop"];
  assert.equal(estaOculto(ocultos, "c:/users/consa/desktop"), true); // caixa
  assert.equal(estaOculto(ocultos, "C:/Users/consa/Desktop" + BS), true); // barra final
  assert.equal(estaOculto(ocultos, "C:/Users/consa/Documents"), false);
});

test("ocultar dedupe e nao muta; restaurar tira por caminho normalizado", () => {
  const base: string[] = [];
  const um = ocultar(base, "C:/Users/consa/Desktop");
  assert.deepEqual(base, []);
  assert.equal(um.length, 1);
  const dup = ocultar(um, "C:/Users/consa/Desktop" + BS);
  assert.equal(dup.length, 1);
  const vazio = restaurar(dup, "C:/Users/consa/Desktop");
  assert.deepEqual(vazio, []);
});

test("mesclarAcessoRapido FILTRA item de sistema oculto", () => {
  const sistema = [
    entry("Desktop", "C:/Users/consa/Desktop"),
    entry("Documents", "C:/Users/consa/Documents"),
  ];
  const out = mesclarAcessoRapido([], sistema, ["C:/Users/consa/Desktop"]);
  assert.deepEqual(out.map((e) => e.name), ["Documents"]);
});

test("pin VENCE ocultar: caminho fixado aparece mesmo se estiver oculto", () => {
  const pins = [{ path: "C:/Users/consa/Desktop", name: "Desktop" }];
  const sistema = [entry("Desktop", "C:/Users/consa/Desktop")];
  const out = mesclarAcessoRapido(pins, sistema, ["C:/Users/consa/Desktop"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Desktop");
});

test("sem ocultos (arg omitido) = comportamento antigo (retrocompat)", () => {
  const sistema = [entry("Desktop", "C:/Users/consa/Desktop")];
  const out = mesclarAcessoRapido([], sistema);
  assert.equal(out.length, 1);
});
