// #1407 — o dev tem de servir as views de raiz, senão a QA-V não gateia.
//
// Achado recorrente da `iris`: `listarCloudLocations()` devolvia `[]` no mock e
// `MOCK_DRIVES` não tinha nenhum `network`, então as seções Cloud drives e
// Locais de rede simplesmente não existiam fora do Tauri. Toda view de raiz
// (#1287, #1286, #1288, #1404) só podia ser validada pelo olho do PO.
//
// A guarda NÃO chama `listarCloudLocations()` e conta itens: isso provaria a
// função, e o AC fala da VIEW ("abro Cloud drives, então a view renderiza ≥2
// mounts, com logo por provider — a `iris` vê a view"). Aqui monta-se o
// `ExplorerShell` inteiro, que chama a api de verdade pelo caminho não-Tauri,
// e afirma-se o que ela veria na tela.
//
// (Lição do #1287: montar a peça que EU fiei prova a minha fiação, não a que o
// usuário — ou a QA — atravessa.)
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { DICIONARIOS } from "@/lib/strings";
import { useAppStore } from "@/store";
import {
  listarCloudLocations,
  listarDrives,
  listarNetworkLocations,
} from "@/lib/api";
import { ExplorerShell } from "./explorer-shell";

const IDIOMA = "pt-BR" as const;
const t = DICIONARIOS[IDIOMA];

function montar() {
  render(
    <IdiomaProvider>
      <TooltipProvider>
        <ExplorerShell />
      </TooltipProvider>
    </IdiomaProvider>,
  );
}

describe("#1407 o dev serve as views de raiz", () => {
  beforeEach(() => {
    useAppStore.setState({ idioma: IDIOMA });
  });

  it("a seção Cloud drives aparece no sidebar, com os mounts", async () => {
    montar();
    // A seção só renderiza com >=1 mount — era exatamente por isso que ela não
    // existia no dev antes desta fatia.
    const secao = await screen.findAllByText(t.arquivos.driveSecaoCloud);
    expect(secao.some((e) => e.closest("aside")), "seção ausente do sidebar").toBe(true);
    for (const nome of [
      "OneDrive - Pessoal (mock)",
      "OneDrive - Contoso (mock)",
      "Google Drive (mock)",
    ]) {
      const achados = await screen.findAllByText(nome);
      expect(
        achados.some((e) => e.closest("aside")),
        `mount "${nome}" não apareceu no sidebar`,
      ).toBe(true);
    }
  });

  it("cada mount mostra o LOGO do provider, não o Cloud genérico", async () => {
    montar();
    await screen.findAllByText("Google Drive (mock)");
    // #869 item 3: o logo vem de `public/app-icons/<id>.svg` via <img>. Se o
    // mock tivesse um provider só, o `Cloud` genérico passaria batido — é
    // justamente isto que a `iris` não conseguia ver no dev.
    await waitFor(() => {
      const srcs = [...document.querySelectorAll("img")]
        .map((i) => i.getAttribute("src") ?? "")
        .filter((s) => s.includes("/app-icons/"));
      expect(
        srcs.some((s) => s.includes("onedrive")),
        `nenhum logo de OneDrive no sidebar; vi: ${srcs.join(", ")}`,
      ).toBe(true);
      expect(
        srcs.some((s) => s.includes("google-drive")),
        `nenhum logo de Google Drive no sidebar; vi: ${srcs.join(", ")}`,
      ).toBe(true);
    });
  });

  it("Locais de rede traz o drive MAPEADO e o atalho sem letra", async () => {
    montar();
    // O rótulo aparece mais de uma vez (sidebar e rail); o que importa aqui é
    // o SIDEBAR, que é onde a QA-V olha.
    const naSecao = await screen.findAllByText(t.arquivos.driveSecaoRede);
    expect(naSecao.some((e) => e.closest("aside")), "seção ausente do sidebar").toBe(true);
    // #1288: os dois tipos na MESMA seção. O mapeado usa o rótulo derivado do
    // nome que o Rust monta; o atalho não tem letra.
    for (const alvo of [/acervo-mock/, "Acervo (mock)", "Backup antigo (mock)"]) {
      const achados = await screen.findAllByText(alvo);
      expect(
        achados.some((e) => e.closest("aside")),
        `"${alvo}" não apareceu na árvore do sidebar`,
      ).toBe(true);
    }
  });

  it("o mock se anuncia como mock — não se confunde com dado real", async () => {
    // AC do card. Um print do dev não pode passar por máquina de verdade.
    const clouds = await listarCloudLocations();
    const redes = await listarNetworkLocations();
    const drives = await listarDrives();
    for (const nome of [
      ...clouds.map((c) => c.name),
      ...redes.map((n) => n.name),
      ...drives.filter((d) => d.kind === "network").map((d) => d.name),
    ]) {
      expect(nome.toLowerCase(), `"${nome}" não se anuncia`).toContain("mock");
    }
  });

  it("AC3: DENTRO do Tauri o mock não vaza — vai pro invoke", async () => {
    // O risco real desta fatia não é faltar dado no dev; é o dado fictício
    // aparecer na máquina do usuário. `inTauri()` é `"__TAURI_INTERNALS__" in
    // window`, então dá pra atravessar o gate de verdade em vez de confiar na
    // leitura do `if`.
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_INTERNALS__ = {};
    try {
      const resultados = await Promise.allSettled([
        listarCloudLocations(),
        listarNetworkLocations(),
        listarDrives(),
      ]);
      for (const r of resultados) {
        if (r.status === "rejected") continue; // caiu no invoke: é o que se quer
        const nomes = (r.value as { name: string }[]).map((x) => x.name);
        expect(
          nomes.join("|").toLowerCase(),
          `mock vazou pro caminho do Tauri: ${nomes.join(", ")}`,
        ).not.toContain("mock");
      }
    } finally {
      delete w.__TAURI_INTERNALS__;
    }
  });

  it("cobre os TRÊS providers — um só deixaria o genérico passar batido", async () => {
    const providers = (await listarCloudLocations()).map((c) => c.provider);
    for (const p of ["onedrive", "onedriveCommercial", "googledrive"]) {
      expect(providers, `falta provider ${p} no mock`).toContain(p);
    }
    // E >=1 mapeado de rede, senão a seção Locais de rede volta a sumir.
    expect(
      (await listarDrives()).some((d) => d.kind === "network"),
      "MOCK_DRIVES sem nenhum kind network",
    ).toBe(true);
  });
});
