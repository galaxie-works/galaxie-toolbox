// #1287: clicar o cabeçalho de uma raiz semântica (Cloud drives / Locais de rede
// / Acesso rápido) navega pra sua sentinela de caminho — que o shell roteia pra
// view de tiles. Antes só o This PC navegava; as outras eram "só rótulo".
//
// Navegador real porque a árvore é um accordion do animate-ui: em happy-dom os
// nós não têm layout (mesmo motivo do #1288).
import "@/index.css";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { IdiomaProvider } from "@/lib/idioma";
import { DICIONARIOS } from "@/lib/strings";
import { useAppStore } from "@/store";
import type { CloudLocation, DriveInfo, FsEntry, NetworkLocation } from "@/lib/types";
import {
  CAMINHO_ACESSO_RAPIDO,
  CAMINHO_CLOUD,
  CAMINHO_REDE,
} from "./caminho";
import { ArvoreArquivos } from "./arvore";

// O `idioma` sai do store, que detecta pelo locale (`idiomaAtual()`). Em CI
// (locale en) os rótulos saem em inglês — então fixo o idioma e leio os rótulos
// do MESMO dicionário, em vez de cravar strings pt (o que quebrava só no CI).
const IDIOMA = "pt-BR" as const;
const t = DICIONARIOS[IDIOMA];

const CLOUD: CloudLocation[] = [
  { path: "C:\\Users\\consa\\OneDrive", name: "OneDrive", provider: "onedrive", kind: "folder" },
];
const REDE: NetworkLocation[] = [
  { name: "Galaxie Network", path: "\\\\192.168.1.34\\Galaxie Network", kind: "networkLocation", available: true },
];
const HOME: FsEntry = {
  name: "consa",
  path: "C:\\Users\\consa",
  isDir: true,
  isSymlink: false,
  size: 0,
  modifiedMs: null,
  createdMs: null,
  extension: null,
  isHidden: false,
  isReadonly: false,
};

async function ate<T>(busca: () => T | null, ms = 6000): Promise<T | null> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

function montar(onNavegar: (p: string) => void, drives: DriveInfo[] = []) {
  render(
    <IdiomaProvider>
      <div style={{ width: 320, height: 600 }}>
        <ArvoreArquivos
          drives={drives}
          cloudLocations={CLOUD}
          networkLocations={REDE}
          acessoRapido={[HOME]}
          pins={[]}
          onAlternarFixar={() => {}}
          onRemoverAcessoRapido={() => {}}
          homePath={HOME.path}
          currentPath=""
          onNavegar={onNavegar}
        />
      </div>
    </IdiomaProvider>,
  );
}

/** Acha o cabeçalho da seção pelo texto (pt) e clica nele. */
async function clicarCabecalho(texto: string) {
  const alvo = await ate(() => {
    const els = Array.from(document.querySelectorAll("button, [role='button'], div"));
    return els.find((e) => e.textContent?.trim() === texto) ?? null;
  });
  expect(alvo, `cabeçalho "${texto}" não apareceu`).toBeTruthy();
  (alvo as HTMLElement).click();
}

describe("#1287 raízes semânticas navegam", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ idioma: IDIOMA }); // determinístico em qualquer locale
  });

  it("Drives na nuvem → sentinela Cloud", async () => {
    const onNavegar = vi.fn();
    montar(onNavegar);
    await clicarCabecalho(t.arquivos.driveSecaoCloud);
    expect(onNavegar).toHaveBeenCalledWith(CAMINHO_CLOUD);
  });

  it("Locais de rede → sentinela Rede", async () => {
    const onNavegar = vi.fn();
    montar(onNavegar);
    await clicarCabecalho(t.arquivos.driveSecaoRede);
    expect(onNavegar).toHaveBeenCalledWith(CAMINHO_REDE);
  });

  it("Acesso rápido → sentinela Acesso rápido", async () => {
    const onNavegar = vi.fn();
    montar(onNavegar);
    await clicarCabecalho(t.arquivos.acessoRapido);
    expect(onNavegar).toHaveBeenCalledWith(CAMINHO_ACESSO_RAPIDO);
  });
});
