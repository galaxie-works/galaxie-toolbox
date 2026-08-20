import assert from "node:assert/strict";
import test from "node:test";

import { caminhoDaHome } from "./explorer-home.ts";
import type { KnownDir } from "./types.ts";

// #1404 — o contrato do Explorer deixou de ser posicional.
//
// O defeito não era "contrato posicional sem teste": era contrato que **quebra
// sozinho**. O Rust descarta em silêncio o diretório que não resolve e o que não
// existe, então o índice 0 só era a home enquanto a home existisse. Sem ela, a
// Área de Trabalho virava "Home" na UI — sem erro e sem log.

function dir(kind: KnownDir["kind"], path: string): KnownDir {
  return {
    name: path.split("\\").pop() ?? path,
    path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
    kind,
  };
}

test("#1404: acha a home pelo kind, não pela posição", () => {
  const dirs = [
    dir("desktop", "C:\\Users\\w\\Desktop"),
    dir("home", "C:\\Users\\w"),
    dir("downloads", "C:\\Users\\w\\Downloads"),
  ];

  assert.equal(
    caminhoDaHome(dirs),
    "C:\\Users\\w",
    "com a home em 2º lugar, quem pergunta por kind ainda a encontra",
  );
});

test("#1404: sem home na lista, o resultado é null — nunca o primeiro item", () => {
  // Exatamente o cenário do card: a home não resolveu, o Rust a descartou, e a
  // Área de Trabalho ficou em primeiro.
  const semHome = [
    dir("desktop", "C:\\Users\\w\\Desktop"),
    dir("documents", "C:\\Users\\w\\Documents"),
  ];

  const achado = caminhoDaHome(semHome);
  assert.equal(
    achado,
    null,
    "sem home, degrada para null — devolver a Desktop aqui é a UI MENTIR " +
      "que a Área de Trabalho é a pasta do usuário",
  );
  assert.notEqual(
    achado,
    "C:\\Users\\w\\Desktop",
    "o 1º item NÃO pode ser promovido a home",
  );
});

test("#1404: lista ausente ou vazia não explode", () => {
  // `acessoRapido` é null enquanto carrega — caminho real do shell.
  assert.equal(caminhoDaHome(null), null);
  assert.equal(caminhoDaHome(undefined), null);
  assert.equal(caminhoDaHome([]), null);
});
