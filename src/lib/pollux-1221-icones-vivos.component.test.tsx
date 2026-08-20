// #1221 — quem PODE pedir um arquivo de `public/app-icons`, e a guarda disso.
//
// O card avisa: apagar o que "não está no catálogo" apaga ícone vivo, porque o
// diretório serve mais de uma fonte. Medi, e a armadilha tem nome — `clipchamp`,
// um app **M365** com arquivo lá.
//
// As fontes são derivadas do MESMO grafo que o app usa (`APPS_CATALOGO`,
// `APPS_GALAXIE`, `APPS`), nunca de uma cópia da regra: se alguém acrescentar
// app ou trocar um `icon`, a guarda acompanha sozinha.
//
// São DUAS regras, e conflacionar as duas foi o meu primeiro erro aqui:
//
//  • **TEM DE EXISTIR** — quem renderiza a partir deste diretório hoje. Se
//    faltar arquivo, o app mostra buraco.
//  • **NÃO PODE SER APAGADO** — o conjunto acima MAIS todo id M365. Os ícones
//    Fluent vêm de `src/assets/apps/`, e os 28 M365 resolvem por lá, então o
//    fallback público está LATENTE. Latente não é seguro: no dia em que um
//    asset Fluent sair, o app cai em `public/app-icons/<id>`. Exigir que os 28
//    EXISTAM seria errado (26 não existem, e não precisam); protegê-los se
//    existirem é barato e fecha o caminho.
import { readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { APPS } from "@/lib/apps";
import { APPS_CATALOGO } from "@/lib/apps-catalog";
import { APPS_GALAXIE } from "@/lib/apps-unificado-core";

/** O `AppIcon` tenta estas extensões, nesta ordem (#1153). */
const EXTENSOES = /\.(svg|png|jpe?g|webp)$/i;

function idsEmDisco(): Set<string> {
  return new Set(
    readdirSync("public/app-icons")
      .filter((f) => EXTENSOES.test(f))
      .map((f) => f.replace(EXTENSOES, "")),
  );
}

/**
 * #869 (item 3): a árvore do Files passou a mostrar o logo do serviço em cada
 * mount de nuvem, lendo daqui por id. São dois arquivos que o SIDEBAR precisa —
 * não só o catálogo de apps.
 *
 * Sem esta linha, uma limpeza futura guiada pelo catálogo poderia levar o
 * `google-drive.svg` embora e o sidebar ficaria com buraco, sem nada acusando.
 */
const LOGOS_NUVEM_DO_SIDEBAR = ["onedrive", "google-drive"];

/** Quem renderiza a partir deste diretório: falta de arquivo = buraco na tela. */
function idsQuePrecisamExistir(): Set<string> {
  return new Set<string>([
    ...APPS_CATALOGO.filter((a) => a.icon).map((a) => a.id),
    ...APPS_GALAXIE.map((a) => a.id),
    ...LOGOS_NUVEM_DO_SIDEBAR,
  ]);
}

/** O que a limpeza não pode remover — inclui o fallback latente do M365. */
function idsProtegidos(): Set<string> {
  return new Set<string>([
    ...idsQuePrecisamExistir(),
    ...APPS.map((a) => a.id),
  ]);
}

describe("#1221 ícones de public/app-icons", () => {
  it("todo id que renderiza daqui TEM arquivo em disco", () => {
    const disco = idsEmDisco();
    const faltando = [...idsQuePrecisamExistir()].filter((id) => !disco.has(id));
    expect(
      faltando,
      `ids que renderizam de public/app-icons e não têm arquivo: ${faltando.join(", ")}`,
    ).toEqual([]);
  });

  it("o fallback do M365 está protegido — `clipchamp` é o caso real", () => {
    // Regressão nomeada: uma limpeza guiada só pelo catálogo apagaria este
    // arquivo, porque `clipchamp` é M365 e NÃO está no catálogo.
    const disco = idsEmDisco();
    expect(
      APPS.some((a) => a.id === "clipchamp"),
      "clipchamp deixou de ser M365 — a armadilha mudou de forma, remeça",
    ).toBe(true);
    expect(
      APPS_CATALOGO.some((a) => a.id === "clipchamp"),
      "clipchamp entrou no catálogo — a armadilha mudou de forma, remeça",
    ).toBe(false);
    expect(disco.has("clipchamp"), "clipchamp perdeu o ícone de fallback").toBe(
      true,
    );
  });

  it("não sobra ícone sem app — e não volta a sobrar sem alguém ver", () => {
    // Catraca: depois da limpeza o diretório tem os protegidos e mais nada. Se
    // voltar a inchar, a conta aparece aqui — em vez de reaparecer como 15 MB
    // no bundle daqui a um ano, que foi como este card nasceu.
    const disco = idsEmDisco();
    const protegidos = idsProtegidos();
    const orfaos = [...disco].filter((id) => !protegidos.has(id));
    expect(
      orfaos.length,
      `${orfaos.length} ícones sem app. Amostra: ${orfaos.slice(0, 8).join(", ")}`,
    ).toBe(0);
  });
});
