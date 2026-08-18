// #1154 (BUG/UX do Wagner) — trava o LAYOUT do `ItemUnificado` do command:
//   • o NOME é protegido (flex-1, basis-0 → peso de shrink 0): nunca é o elemento
//     que cede/corta — o AC "não corta o nome do app" em janela estreita;
//   • o RESUMO é quem trunca primeiro (min-w-0 + shrink + max-w-[45%] + truncate),
//     right-aligned → posição previsível, não dependente do comprimento do nome;
//   • sem resumo o item não "pula": o nome segue lá, sem span de resumo.
// happy-dom não calcula overflow real (pixel), então gateamos o CONTRATO de classes
// que GARANTE a regra — é o que impede a regressão de re-introduzir `shrink-0` no
// resumo (o bug original). O ajuste fino de pixel é o passe visual/desktop.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// `lottie-react` toca canvas real no import (happy-dom não implementa) e o
// `navegador.tsx` o arrasta via ícones de marca. Stub: este teste é de LAYOUT.
vi.mock("lottie-react", () => ({
  useLottie: () => ({ View: null }),
  default: () => null,
}));

import { ItemUnificado } from "./navegador";
import { IdiomaProvider } from "@/lib/idioma";
import { useAppStore } from "@/store";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Command, CommandList } from "@/components/ui/command";
import type { AppUnificado } from "@/lib/apps-unificado-core";

const COM_RESUMO: AppUnificado = {
  id: "outlook",
  name: "Outlook",
  category: "Productivity",
  url: "https://outlook.office.com",
  fluentIcon: null,
  resumo: { "pt-BR": "E-mail e calendário", en: "Mail and calendar" },
  nativo: null,
  m365: true,
};

const SEM_RESUMO: AppUnificado = {
  id: "algum-app",
  name: "Algum App",
  category: "Productivity",
  url: "https://exemplo.com",
  fluentIcon: null,
  resumo: null,
  nativo: null,
  m365: false,
};

function montar(app: AppUnificado) {
  return render(
    <IdiomaProvider>
      <TooltipProvider>
        <Command>
          <CommandList>
            <ItemUnificado
              app={app}
              termo=""
              fixado={false}
              onSelecionar={vi.fn()}
              onAlternarPin={vi.fn()}
            />
          </CommandList>
        </Command>
      </TooltipProvider>
    </IdiomaProvider>,
  );
}

// O idioma vem do store — fixa pt-BR pra o texto do resumo ser determinístico.
beforeEach(() => {
  useAppStore.setState({ idioma: "pt-BR" });
});

describe("#1154 layout do ItemUnificado: nome protegido, resumo trunca primeiro", () => {
  it("o NOME é flex-1 + truncate e NÃO shrink-0 (nunca é cortado)", () => {
    montar(COM_RESUMO);
    const nome = screen.getByText("Outlook");
    expect(nome.className).toContain("flex-1");
    expect(nome.className).toContain("truncate");
    expect(nome.className).not.toContain("shrink-0");
  });

  it("o RESUMO é quem cede: shrink + max-w-[45%] + truncate, right-aligned, sem shrink-0", () => {
    montar(COM_RESUMO);
    const resumo = screen.getByText("E-mail e calendário");
    expect(resumo.className).toContain("truncate");
    expect(resumo.className).toContain("max-w-[45%]");
    expect(resumo.className).toContain("text-right");
    // A regressão que causou o #1154: resumo com shrink-0 fazia o NOME truncar antes.
    expect(resumo.className).not.toContain("shrink-0");
  });

  it("sem resumo o item não pula: nome presente, nenhum span de resumo", () => {
    montar(SEM_RESUMO);
    expect(screen.getByText("Algum App")).toBeTruthy();
    expect(screen.queryByText(/E-mail e calendário/)).toBeNull();
  });
});
