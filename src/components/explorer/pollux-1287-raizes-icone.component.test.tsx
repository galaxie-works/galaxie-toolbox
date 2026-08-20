// #1287 (reprovação da Lúmen) — os CONSUMIDORES não podem divergir do mapa.
//
// A Lúmen mediu o furo: trocar o ícone da raiz Cloud em `arvore.tsx` passava em
// node, component E browser; e trocar só na view deixava sidebar e página
// discordando, com 532/532 + 108/108 verdes. Cada AC nomeia um ícone e nenhum
// tinha guarda.
//
// A guarda não é "um teste de ícone" (pinaria uma das quatro cópias e deixaria
// três soltas). É: **a UI tem de renderizar o ícone que o mapa manda**. O lado
// esquerdo da comparação vem do DOM; o direito, de `ICONE_DA_RAIZ`. Se um
// consumidor parar de ler o mapa, os lados divergem. O VALOR do mapa está pinado
// contra os ACs no `pollux-1287-raizes.test.ts` — os dois juntos fecham o cerco.
//
// Canal `component` de propósito: é obrigatório no CI, e é onde o
// `root-view.component.test.tsx` já monta esta família.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { IdiomaProvider } from "@/lib/idioma";
import { DICIONARIOS } from "@/lib/strings";
import { useAppStore } from "@/store";
import type { CloudLocation, DriveInfo, FsEntry } from "@/lib/types";
import { ArvoreArquivos } from "./arvore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExplorerShell } from "./explorer-shell";
import { RAIZES_VIRTUAIS, raizVirtual, type RaizVirtual } from "./caminho";
import { ICONE_DA_RAIZ } from "./icone-raiz";

// Fora do Tauri o `api.ts` já degrada pra listas vazias — e raiz sem itens não
// renderiza seção. Aqui eu só injeto DADOS; nada de UI é dublado.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  listarDrives: () => Promise.resolve([DRIVE, REDE]),
  listarCloudLocations: () => Promise.resolve([NUVEM]),
  listarNetworkLocations: () => Promise.resolve([]),
  dirsConhecidos: () => Promise.resolve([RAPIDO]),
  listarDir: () => Promise.resolve([]),
  observarPasta: () => Promise.resolve(() => {}),
}));

// Idioma fixo no store + rótulos lidos do MESMO dicionário: o alvo do teste é o
// ÍCONE, não a copy, então ler o rótulo daqui é o que torna a busca no DOM
// determinística em qualquer locale de CI (o conserto que a Lúmen validou).
const IDIOMA = "pt-BR" as const;
const t = DICIONARIOS[IDIOMA];

const DRIVE: DriveInfo = {
  name: "Disco local (C:)",
  path: "C:\\",
  kind: "fixed",
  totalSpace: 0,
  freeSpace: 0,
} as DriveInfo;

const REDE: DriveInfo = {
  name: "compartilhado (W:)",
  path: "W:\\",
  kind: "network",
  totalSpace: 0,
  freeSpace: 0,
} as DriveInfo;

const NUVEM: CloudLocation = {
  name: "OneDrive",
  path: "C:\\Users\\w\\OneDrive",
  provider: "onedrive",
} as CloudLocation;

const RAPIDO: FsEntry = {
  name: "Documentos",
  path: "C:\\Users\\w\\Documentos",
  isDir: true,
} as FsEntry;

/**
 * A "assinatura" do ícone renderizado. O lucide marca cada ícone com uma classe
 * própria (`lucide-cloud`), então a classe do `<svg>` identifica QUAL ícone é —
 * sem depender do path do desenho, que muda quando a lib atualiza.
 */
function assinaturaDoSvg(dentro: HTMLElement): string {
  const svg = dentro.querySelector("svg");
  expect(svg, "nenhum ícone renderizado aqui").not.toBeNull();
  return (
    [...svg!.classList].find((c) => c.startsWith("lucide-")) ??
    `sem-classe-lucide:${svg!.getAttribute("class")}`
  );
}

/** A assinatura que o MAPA manda pra esta raiz. */
function assinaturaDoMapa(raiz: RaizVirtual): string {
  const Icone = ICONE_DA_RAIZ[raiz.icone];
  const { container, unmount } = render(<Icone />);
  const assinatura = assinaturaDoSvg(container);
  unmount();
  return assinatura;
}

describe("#1287 ícone por raiz: a UI lê o mapa", () => {
  beforeEach(() => {
    useAppStore.setState({ idioma: IDIOMA });
  });

  it("SIDEBAR: cada cabeçalho de raiz na árvore usa o ícone do mapa", () => {
    render(
      <IdiomaProvider>
        <ArvoreArquivos
          drives={[DRIVE, REDE]}
          cloudLocations={[NUVEM]}
          networkLocations={[]}
          acessoRapido={[RAPIDO]}
          pins={[]}
          onAlternarFixar={() => {}}
          onRemoverAcessoRapido={() => {}}
          homePath={null}
          currentPath=""
          onNavegar={() => {}}
        />
      </IdiomaProvider>,
    );

    // As quatro raízes do mapa, sem lista escrita à mão: se alguém acrescentar
    // uma quinta raiz e esquecer o ícone, este teste cobre sozinho.
    for (const raiz of RAIZES_VIRTUAIS) {
      const rotulo = t.arquivos[raiz.titulo];
      const cabecalho = screen.getByText(rotulo).closest("div");
      expect(cabecalho, `raiz "${rotulo}" não apareceu na árvore`).not.toBeNull();
      expect(
        assinaturaDoSvg(cabecalho as HTMLElement),
        `ícone errado na raiz "${rotulo}" do SIDEBAR`,
      ).toBe(assinaturaDoMapa(raiz));
    }
  });

  it("VIEW: navegar pra uma raiz mostra o ícone do mapa no cabeçalho", async () => {
    // O `ExplorerShell` INTEIRO — não o `RootView` com props que eu mesma passo.
    // Foi essa a lição da reprovação: montar a peça que eu fiei prova a minha
    // fiação, não a do shell. Aqui o caminho é o do usuário: clicar na raiz na
    // árvore e olhar o cabeçalho da página.
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <ExplorerShell />
        </TooltipProvider>
      </IdiomaProvider>,
    );
    const comView = RAIZES_VIRTUAIS.filter((r) => r.sentinela !== "");
    for (const raiz of comView) {
      const rotulo = t.arquivos[raiz.titulo];
      const naArvore = await screen.findByText(rotulo);
      fireEvent.click(naArvore.closest("div") as HTMLElement);
      // O rótulo aparece 2× depois de navegar (árvore + cabeçalho da view); o
      // último em ordem de documento é o da PÁGINA.
      const todos = await screen.findAllByText(rotulo);
      const naPagina = todos[todos.length - 1].closest("div");
      expect(naPagina, `cabeçalho da view não apareceu: ${rotulo}`).not.toBeNull();
      expect(
        assinaturaDoSvg(naPagina as HTMLElement),
        `ícone errado na VIEW da raiz "${rotulo}"`,
      ).toBe(assinaturaDoMapa(raiz));
      // BREADCRUMB: o 3º consumidor. Na raiz ele mostra o RÓTULO, nunca o
      // sentinel cru ("::cloud::"). Dois botões com este nome = árvore + trilha;
      // se a trilha voltar a mostrar o sentinel, cai pra um e reprova.
      // BREADCRUMB: o 3º consumidor. Na raiz ele mostra o RÓTULO, nunca o
      // sentinel cru ("::cloud::"). O botão da trilha é o único com este nome
      // FORA do <aside> do sidebar — se a trilha voltar a mostrar o sentinel,
      // some e reprova.
      const naTrilha = screen
        .getAllByRole("button", { name: rotulo })
        .filter((b) => !b.closest("aside"));
      expect(
        naTrilha.length,
        `breadcrumb não mostra "${rotulo}"`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("o mapa cobre toda raiz virtual — nenhuma sem ícone/título", () => {
    for (const raiz of RAIZES_VIRTUAIS) {
      expect(ICONE_DA_RAIZ[raiz.icone], `sem ícone: ${raiz.titulo}`).toBeTruthy();
      expect(t.arquivos[raiz.titulo], `sem título: ${raiz.titulo}`).toBeTruthy();
      expect(raizVirtual(raiz.sentinela)).toEqual(raiz);
    }
  });
});
