// #1287 (reprovação da Lúmen) — o mapa das raízes semânticas é a FONTE.
//
// Este arquivo pina o MAPA contra os ACs em letra. O companheiro
// `pollux-1287-raizes-icone.component.test.tsx` pina os CONSUMIDORES contra o
// mapa. Só os dois juntos fazem o que a QA pediu: trocar o ícone de uma raiz
// reprova, esteja a troca no mapa, na árvore, na view ou no breadcrumb.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CAMINHO_ACESSO_RAPIDO,
  CAMINHO_CLOUD,
  CAMINHO_ESTE_PC,
  CAMINHO_REDE,
  RAIZES_VIRTUAIS,
  ehRaizVirtual,
  raizVirtual,
} from "./caminho.ts";

describe("#1287 raízes semânticas: o mapa", () => {
  it("cada AC nomeia um ícone, e é este", () => {
    // AC1 "Então ícone Cloud na raiz", AC2 Network, AC3 Pin — em letra.
    const porTitulo = Object.fromEntries(
      RAIZES_VIRTUAIS.map((r) => [r.titulo, r.icone]),
    );
    assert.equal(porTitulo.driveSecaoCloud, "cloud");
    assert.equal(porTitulo.driveSecaoRede, "network");
    assert.equal(porTitulo.acessoRapido, "pin");
    assert.equal(porTitulo.drives, "monitor");
  });

  it("cada raiz aponta pra sua sentinela de caminho", () => {
    assert.equal(raizVirtual(CAMINHO_CLOUD)?.titulo, "driveSecaoCloud");
    assert.equal(raizVirtual(CAMINHO_REDE)?.titulo, "driveSecaoRede");
    assert.equal(raizVirtual(CAMINHO_ACESSO_RAPIDO)?.titulo, "acessoRapido");
    assert.equal(raizVirtual(CAMINHO_ESTE_PC)?.titulo, "drives");
  });

  it("pasta de verdade não é raiz", () => {
    assert.equal(raizVirtual("C:\\Users\\w"), null);
    assert.equal(ehRaizVirtual("C:\\Users\\w"), false);
    // `ehRaizVirtual` passou a derivar do mapa — se alguém tirar uma raiz de lá,
    // o shell pararia de tratá-la como virtual (watcher batendo em caminho que
    // não existe). Amarrado aqui de propósito.
    for (const r of RAIZES_VIRTUAIS) {
      assert.equal(ehRaizVirtual(r.sentinela), true, r.titulo);
    }
  });

  it("as sentinelas não colidem com caminho Windows, e são únicas", () => {
    const sentinelas = RAIZES_VIRTUAIS.map((r) => r.sentinela);
    assert.equal(new Set(sentinelas).size, sentinelas.length);
    for (const s of sentinelas) {
      // This PC é o "" histórico; as demais usam o prefixo `::`.
      if (s === CAMINHO_ESTE_PC) continue;
      assert.match(s, /^::/, `sentinela sem prefixo :: — ${s}`);
    }
    // O `value` do accordion não pode ser vazio (o Radix ignoraria o nó), então
    // o This PC tem um valor de árvore DIFERENTE da sentinela de caminho.
    for (const r of RAIZES_VIRTUAIS) {
      assert.notEqual(r.valorArvore, "", r.titulo);
      assert.match(r.valorArvore, /^::/, r.titulo);
    }
  });
});
