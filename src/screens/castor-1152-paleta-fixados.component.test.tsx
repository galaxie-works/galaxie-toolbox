// #1152 (rework) — guarda dos ACs do grupo `Pinned` no command, que a `lumen`
// reprovou por não terem nenhuma: ela apagou o bloco inteiro do grupo e as 80
// asserções do repo seguiram verdes.
//
// Monta a paleta DE VERDADE (por isso o `ConteudoPaleta` passou a ser
// exportado): o defeito que ela mediu — busca "excel" com Outlook fixado
// selecionando o Outlook — só existe na composição, nunca numa função pura.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IdiomaProvider } from "@/lib/idioma";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store";
// `lottie-react` puxa o `lottie-web`, que toca canvas na importacao e o happy-dom nao tem — sem isto o
// arquivo nem carrega. Aqui e happy-dom (projeto `component`), entao `vi.mock`
// com factory e seguro; o veto do #1267 e do browser-mode.
vi.mock("lottie-react", () => ({
  useLottie: () => ({ View: null }),
  default: () => null,
}));

import { ConteudoPaleta } from "@/screens/navegador";

const acoes = {
  abas: [],
  ativa: null,
  favoritos: [],
  historico: [],
  user: { provider: "microsoft" as const, accountKind: "work" as const },
  onAbrir: vi.fn(),
  onNavegar: vi.fn(),
  onTrocar: vi.fn(),
  onFechar: vi.fn(),
  onNovaAba: vi.fn(),
  onNovaAbaPrivada: vi.fn(),
  onAlternarFixada: vi.fn(),
  onDormir: vi.fn(),
  onNavegarTela: vi.fn(),
  onIrParaBridgeView: vi.fn(),
};

function montar() {
  return render(
    <IdiomaProvider>
      <TooltipProvider>
        <ConteudoPaleta {...acoes} />
      </TooltipProvider>
    </IdiomaProvider>,
  );
}

/** Rótulos dos cabeçalhos de grupo, na ordem em que aparecem no DOM. */
function cabecalhos(): string[] {
  return Array.from(document.querySelectorAll("[cmdk-group-heading]")).map(
    (e) => (e.textContent ?? "").trim(),
  );
}

/** Itens navegáveis, na ordem do DOM. */
function itens(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[cmdk-item]"));
}

beforeEach(() => {
  useAppStore.setState({ appsFixados: [] });
});

describe("#1152 grupo Pinned no command", () => {
  it("AC: com ≥1 fixado, o grupo existe e vem ANTES de From GALAXIE", () => {
    useAppStore.setState({ appsFixados: ["outlook"] });
    montar();
    const heads = cabecalhos();
    const iPin = heads.findIndex((h) => /pinned|fixad/i.test(h));
    const iGalaxie = heads.findIndex((h) => /galaxie/i.test(h));
    expect(iPin).toBeGreaterThanOrEqual(0);
    expect(iGalaxie).toBeGreaterThanOrEqual(0);
    expect(iPin).toBeLessThan(iGalaxie);
  });

  it("AC: com ZERO fixado, não existe cabeçalho órfão", () => {
    montar();
    expect(cabecalhos().some((h) => /pinned|fixad/i.test(h))).toBe(false);
  });

  it("AC: a ordem dentro do grupo é a ordem do pin", () => {
    useAppStore.setState({ appsFixados: ["excel", "outlook"] });
    montar();
    const grupo = Array.from(document.querySelectorAll("[cmdk-group]")).find(
      (g) => /pinned|fixad/i.test(g.querySelector("[cmdk-group-heading]")?.textContent ?? ""),
    );
    expect(grupo).toBeTruthy();
    const nomes = Array.from(grupo!.querySelectorAll("[cmdk-item]")).map((e) =>
      (e.textContent ?? "").toLowerCase(),
    );
    expect(nomes[0]).toContain("excel");
    expect(nomes[1]).toContain("outlook");
  });

  // O DEFEITO, medido na paleta REAL (a `lumen` achou a causa num palco
  // simulado e declarou o limite; aqui está a medição na composição).
  //
  // Ordem ANTES do fix, com Outlook fixado e busca "excel":
  //   0 (selecionado) Search the web for "excel"   ← omnibox
  //   1               Outlook   ← fixado NÃO filtrado, ACIMA do resultado
  //   2               Excel
  // Ou seja: o fixado polui a busca e fica na frente do que se procurou. Uma
  // seta pra baixo entrega o Outlook a quem digitou "excel".
  it("REPRO #1152: buscando 'excel', nenhum item de app é o Outlook fixado", async () => {
    useAppStore.setState({ appsFixados: ["outlook"] });
    montar();
    await userEvent.type(screen.getByRole("combobox"), "excel");

    const textos = itens().map((e) => (e.textContent ?? "").toLowerCase());
    expect(
      textos.some((t) => t.includes("outlook")),
      `busca "excel" trouxe o Outlook (fixado) na lista: ${JSON.stringify(textos)}`,
    ).toBe(false);
    expect(textos.some((t) => t.includes("excel"))).toBe(true);
  });

  it("REPRO #1152: o fixado não fica ACIMA do resultado da busca", async () => {
    useAppStore.setState({ appsFixados: ["outlook"] });
    montar();
    await userEvent.type(screen.getByRole("combobox"), "excel");
    const textos = itens().map((e) => (e.textContent ?? "").toLowerCase());
    const iOutlook = textos.findIndex((t) => t.includes("outlook"));
    const iExcel = textos.findIndex((t) => t.includes("excel") && !t.includes("search"));
    expect(iExcel).toBeGreaterThanOrEqual(0);
    // Sem o fix, iOutlook (1) < iExcel (2).
    expect(iOutlook === -1 || iOutlook > iExcel).toBe(true);
  });

  it("busca que não casa nenhum fixado: o grupo Pinned some", async () => {
    useAppStore.setState({ appsFixados: ["outlook"] });
    montar();
    await userEvent.type(screen.getByRole("combobox"), "excel");
    expect(cabecalhos().some((h) => /pinned|fixad/i.test(h))).toBe(false);
  });

  it("busca que CASA o fixado: ele continua no grupo Pinned", async () => {
    useAppStore.setState({ appsFixados: ["outlook"] });
    montar();
    await userEvent.type(screen.getByRole("combobox"), "outlook");
    expect(cabecalhos().some((h) => /pinned|fixad/i.test(h))).toBe(true);
  });
});
