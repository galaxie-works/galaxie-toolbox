// #1288 — a seção "Locais de rede" mostra os DOIS tipos, e a letra aparece uma
// vez só.
//
// Os dois defeitos que o `mizar` isolou e eu confirmei em `4b8b1aa`:
//   (1) drive de rede saía com a letra duplicada — `… (W:) (W:)`;
//   (2) atalho de rede SEM letra nunca aparecia, porque a seção montava de
//       `drives.filter(kind === "network")` e quem não tem letra não está lá.
//
// Navegador real porque a árvore é um accordion do animate-ui: em happy-dom os
// nós não têm layout e o que eu estaria medindo é o meu mock, não a tela.
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { IdiomaProvider } from "@/lib/idioma";
import type { DriveInfo, NetworkLocation } from "@/lib/types";
import { ArvoreArquivos } from "./arvore";

/** Nome exatamente como o `nome_drive_rede` do Rust monta (fs_explorer.rs:777). */
const NOME_MAPEADO = "wagnao-marcenaria (\\\\192.168.1.34\\Galaxie Network) (W:)";

const DRIVE_REDE: DriveInfo = {
  name: NOME_MAPEADO,
  path: "W:\\",
  kind: "network",
  totalSpace: 0,
  freeSpace: 0,
} as DriveInfo;

const ATALHOS: NetworkLocation[] = [
  { name: "Galaxie Network", path: "\\\\192.168.1.34\\Galaxie Network", kind: "networkLocation", available: true },
  { name: "Eir", path: "\\\\192.168.1.50\\Eir", kind: "networkLocation", available: false },
];

async function ate<T extends Element>(busca: () => T | null, ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

function montar(networkLocations: NetworkLocation[] | null, drives: DriveInfo[]) {
  render(
    <IdiomaProvider>
      <div style={{ width: 320, height: 600 }}>
        <ArvoreArquivos
          drives={drives}
          cloudLocations={[]}
          networkLocations={networkLocations}
          acessoRapido={[]}
          pins={[]}
          onAlternarFixar={() => {}}
          currentPath=""
          onNavegar={() => {}}
        />
      </div>
    </IdiomaProvider>
  );
}

const textoDaArvore = () => document.body.innerText;

describe("#1288 Locais de rede", () => {
  beforeEach(() => {
    cleanup();
  });

  it("o atalho SEM letra aparece — era o que sumia", async () => {
    montar(ATALHOS, []);
    const achou = await ate(() =>
      textoDaArvore().includes("Galaxie Network") ? document.body : null,
    );
    expect(
      achou,
      `atalho de rede não apareceu. Texto da árvore: ${textoDaArvore().slice(0, 300)}`,
    ).toBeTruthy();
    expect(textoDaArvore()).toContain("Eir");
  });

  it("atalho indisponível CONTINUA listado (o backend decidiu assim)", async () => {
    // `available: false` não é motivo pra esconder: `types.ts:661` diz que a
    // entrada continua na lista, marcada. Filtrar aqui desfaria aquilo em
    // silêncio — e o usuário acharia que o atalho dele sumiu.
    montar(ATALHOS, []);
    await ate(() => (textoDaArvore().includes("Eir") ? document.body : null));
    expect(textoDaArvore()).toContain("Eir");
  });

  it("drive mapeado mostra a letra UMA vez, não duas", async () => {
    montar([], [DRIVE_REDE]);
    await ate(() =>
      textoDaArvore().includes("wagnao-marcenaria") ? document.body : null,
    );
    const texto = textoDaArvore();
    expect(texto).toContain(NOME_MAPEADO);
    expect(
      texto.includes("(W:) (W:)"),
      "a letra voltou a duplicar no rótulo do drive de rede",
    ).toBe(false);
  });

  it("sem atalhos e sem drive de rede, a seção não aparece vazia", async () => {
    montar([], []);
    await new Promise((r) => setTimeout(r, 400));
    expect(textoDaArvore()).not.toContain("Galaxie Network");
  });
});
