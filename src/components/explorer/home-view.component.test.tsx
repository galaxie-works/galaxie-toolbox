// #1285 (B2): teste de montagem da Home view. Fixture com subpastas conhecidas
// + uma custom; afirma que os tiles aparecem e que o mapa de icone semantico
// casa as conhecidas (e cai no Folder pras demais).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Download, Folder, Monitor, Music } from "lucide-react";

import { IdiomaProvider } from "@/lib/idioma";

// happy-dom (projeto component): mock parcial do api com spy — so `listarDir`
// e sobrescrito (o grafo do modulo carrega o resto real).
vi.mock("@/lib/api", { spy: true });
import * as api from "@/lib/api";

import { HomeView } from "./home-view";
import { iconeDaPasta } from "./home-view-icones";
import type { FsEntry } from "@/lib/types";

function pasta(name: string): FsEntry {
  return {
    name,
    path: "C:/Users/consa/" + name,
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

beforeEach(() => {
  vi.mocked(api.listarDir).mockReset();
});

describe("#1285 iconeDaPasta — mapa semantico", () => {
  it("casa pastas conhecidas (case-insensitive) e cai no Folder pras demais", () => {
    expect(iconeDaPasta("Desktop")).toBe(Monitor);
    expect(iconeDaPasta("downloads")).toBe(Download);
    expect(iconeDaPasta("MUSIC")).toBe(Music);
    expect(iconeDaPasta("Projetos")).toBe(Folder); // custom → generico
    expect(iconeDaPasta("Documentos")).toBe(Folder); // nome localizado → generico
  });
});

describe("#1285 HomeView — montagem", () => {
  it("lista as subpastas da home como tiles (conhecidas + custom)", async () => {
    vi.mocked(api.listarDir).mockResolvedValue([
      pasta("Desktop"),
      pasta("Downloads"),
      pasta("Projetos"),
    ]);
    render(
      <IdiomaProvider>
        <HomeView homePath="C:/Users/consa" onNavegar={() => {}} />
      </IdiomaProvider>,
    );
    expect(await screen.findByText("Desktop")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("Projetos")).toBeTruthy();
  });

  it("filtra arquivos e pastas ocultas — so subpastas visiveis viram tile", async () => {
    const arquivo: FsEntry = { ...pasta("nota.txt"), isDir: false, extension: "txt" };
    const oculta: FsEntry = { ...pasta(".config"), isHidden: true };
    vi.mocked(api.listarDir).mockResolvedValue([pasta("Desktop"), arquivo, oculta]);
    render(
      <IdiomaProvider>
        <HomeView homePath="C:/Users/consa" onNavegar={() => {}} />
      </IdiomaProvider>,
    );
    expect(await screen.findByText("Desktop")).toBeTruthy();
    expect(screen.queryByText("nota.txt")).toBeNull();
    expect(screen.queryByText(".config")).toBeNull();
  });

  it("re-lista quando o homePath muda", async () => {
    vi.mocked(api.listarDir).mockResolvedValue([pasta("Desktop")]);
    const { rerender } = render(
      <IdiomaProvider>
        <HomeView homePath="C:/Users/a" onNavegar={() => {}} />
      </IdiomaProvider>,
    );
    await screen.findByText("Desktop");
    rerender(
      <IdiomaProvider>
        <HomeView homePath="C:/Users/b" onNavegar={() => {}} />
      </IdiomaProvider>,
    );
    // 2 caminhos distintos → 2 chamadas de listagem.
    expect(vi.mocked(api.listarDir).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
