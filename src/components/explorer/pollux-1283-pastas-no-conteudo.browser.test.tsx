// #1283 parte A — teste-que-reproduz do DoD, em NAVEGADOR REAL.
//
// Por que não happy-dom (onde eu tentei primeiro): o content-pane é lista
// VIRTUALIZADA (`useVirtualizer`, `getScrollElement: () => scrollRef.current`).
// Sem layout, o container tem altura 0 ⇒ zero itens virtuais ⇒ **nada** renderiza,
// nem arquivo nem pasta. Ali este teste daria falso-vermelho hoje e falso-verde
// amanhã. Em chromium há altura de verdade, então a pergunta do card — *"as
// subpastas aparecem junto dos arquivos?"* — passa a ter resposta honesta.
//
// `{ spy: true }` no mock de `@/lib/api` é obrigatório em browser-mode: factory
// total ou `importOriginal` PENDURA o arquivo (deadlock de carregamento do #1267).
import "@/index.css";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "vitest-browser-react";

import type { FsEntry } from "@/lib/types";

vi.mock("@/lib/api", { spy: true });
import * as api from "@/lib/api";

import { ContentPane } from "./content-pane";
import { IdiomaProvider } from "@/lib/idioma";
import { TooltipProvider } from "@/components/ui/tooltip";

function entrada(nome: string, isDir: boolean): FsEntry {
  return {
    name: nome,
    path: `C:\raiz\${nome}`,
    isDir,
    isSymlink: false,
    size: isDir ? 0 : 1024,
    modifiedMs: 1_722_000_000_000,
    createdMs: 1_700_000_000_000,
    extension: isDir ? null : "txt",
    isHidden: false,
    isReadonly: false,
  };
}

const FIXTURE: FsEntry[] = [
  entrada("SubpastaUm", true),
  entrada("SubpastaDois", true),
  entrada("arquivo.txt", false),
];

afterEach(() => vi.restoreAllMocks());

/** Monta o painel numa caixa com ALTURA — sem ela o virtualizador não rende nada. */
async function montar(lista: FsEntry[]) {
  vi.spyOn(api, "listarDir").mockResolvedValue(lista);
  render(
    <IdiomaProvider>
      <TooltipProvider>
        <div data-caixa="1" style={{ height: "600px", width: "900px", display: "flex" }}>
          <ContentPane currentPath="C:\raiz" onNavegar={() => {}} />
        </div>
      </TooltipProvider>
    </IdiomaProvider>
  );
  const fim = Date.now() + 6000;
  while (Date.now() < fim) {
    const caixa = [...document.querySelectorAll<HTMLElement>('[data-caixa="1"]')].pop();
    if (caixa && /arquivo\.txt|Subpasta|SoPastaAqui/.test(caixa.textContent ?? "")) return caixa;
    await new Promise((r) => setTimeout(r, 60));
  }
  const ultima = [...document.querySelectorAll<HTMLElement>('[data-caixa="1"]')].pop();
  throw new Error(
    `nada renderizou em 6s; texto da caixa: ${(ultima?.textContent ?? "(sem caixa)").slice(0, 200)}`
  );
}

describe("#1283 A — pastas aparecem no conteúdo, junto dos arquivos", () => {
  it("as duas subpastas da fixture montam na lista", async () => {
    const caixa = await montar(FIXTURE);
    const texto = caixa.textContent ?? "";
    // o arquivo é o CONTROLE: se ele aparece e as pastas não, o filtro é por `isDir`
    expect(texto).toContain("arquivo.txt");
    expect(texto).toContain("SubpastaUm");
    expect(texto).toContain("SubpastaDois");
  });

  it("pasta só com subpastas não cai no estado 'vazio'", async () => {
    const caixa = await montar([entrada("SoPastaAqui", true)]);
    expect(caixa.textContent ?? "").toContain("SoPastaAqui");
  });
});
