// #1152 — o pin do command não aparecia no rail. Guarda no CALL SITE.
//
// Por que aqui e não só no `pinned-apps.test.ts`: a função pura sempre esteve
// certa. O defeito era o ARGUMENTO — o rail resolvia os pinados contra
// `APPS_CATALOGO`, e o command grava o id da lista UNIFICADA. Um teste de
// unidade da função passaria verde com o bug em pé (foi o que aconteceu: os
// testes do #721 só exercitavam ids do catálogo). Esta guarda monta o rail de
// verdade e afirma o que o usuário vê.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AppSidebar } from "@/components/app-sidebar";
import { IdiomaProvider } from "@/lib/idioma";
import { SidebarProvider } from "@/components/animate-ui/components/radix/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store";

function montar() {
  return render(
    <IdiomaProvider>
      <TooltipProvider>
        <SidebarProvider open={false} onOpenChange={() => {}}>
          <AppSidebar onAbrirApp={() => {}} onAbrirNativo={() => {}} />
        </SidebarProvider>
      </TooltipProvider>
    </IdiomaProvider>
  );
}

beforeEach(() => {
  useAppStore.setState({ appsFixados: [] });
});

describe("#1152 rail resolve o pin contra a lista unificada", () => {
  it("app M365 curado (Outlook) fixado APARECE no rail — era descartado", () => {
    useAppStore.setState({ appsFixados: ["outlook"] });
    montar();
    expect(screen.getByRole("button", { name: /outlook/i })).toBeTruthy();
  });

  it("tela GALAXIE (Bridge) fixada APARECE no rail — era descartada", () => {
    useAppStore.setState({ appsFixados: ["galaxie-bridge"] });
    montar();
    expect(screen.getByRole("button", { name: /bridge/i })).toBeTruthy();
  });

  it("sem nenhum fixado o rail NÃO renderiza (comportamento do #1109)", () => {
    const { container } = montar();
    // O wrapper do SidebarProvider sempre existe; quem não pode existir é o
    // rail — `AppSidebar` devolve null e nenhum `data-slot=sidebar` aparece.
    expect(container.querySelector('[data-slot="sidebar"]')).toBeNull();
  });

  it("id órfão de verdade segue descartado — e AVISA no console", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    useAppStore.setState({ appsFixados: ["nao-existe-em-lugar-nenhum"] });
    const { container } = montar();
    // proteção original intacta: pin quebrado não vira botão nem rail
    expect(container.querySelector('[data-slot="sidebar"]')).toBeNull();
    // mas o descarte deixou de ser mudo — foi o silêncio que escondeu este bug
    expect(aviso).toHaveBeenCalled();
    expect(String(aviso.mock.calls[0]?.[0])).toContain(
      "nao-existe-em-lugar-nenhum"
    );
    aviso.mockRestore();
  });

  it("item nativo NÃO abre aba web (a url dele é vazia)", async () => {
    const abrirWeb = vi.fn();
    const abrirNativo = vi.fn();
    useAppStore.setState({ appsFixados: ["galaxie-bridge"] });
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <SidebarProvider open={false} onOpenChange={() => {}}>
            <AppSidebar onAbrirApp={abrirWeb} onAbrirNativo={abrirNativo} />
          </SidebarProvider>
        </TooltipProvider>
      </IdiomaProvider>
    );
    screen.getByRole("button", { name: /bridge/i }).click();
    // Abrir por `url` mandaria o usuário pra uma aba EM BRANCO: o Bridge tem
    // `url: ""` e `nativo: "control-room"`.
    expect(abrirWeb).not.toHaveBeenCalled();
    expect(abrirNativo).toHaveBeenCalledTimes(1);
  });
});
