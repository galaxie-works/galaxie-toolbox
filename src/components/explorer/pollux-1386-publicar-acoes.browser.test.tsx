// #1386 — publicar as ações do painel NÃO pode virar laço de render.
//
// Medi o painel antes de escolher onde guardar: o `acoesMenu` do `ContentPane`
// troca de IDENTIDADE a cada render (5 renders do pai → 5 objetos novos). Com
// isso, guardar a publicação em `useState` fecha um ciclo — publicar →
// `setState` → render → objeto novo → publicar. Foi o que a primeira versão
// desta fatia fez: a página travou e o chromium morreu depois de 7 minutos.
//
// Por isso o `useAcoesPublicadas` guarda em REF. Este teste monta o
// `ContentPane` DE VERDADE (não um dublê) e prova as duas metades: as ações
// CHEGAM, e o pai NÃO re-renderiza por causa delas.
//
// Mutante que reprova: trocar o `useRef` do hook por `useState` — a página para
// de responder e o teste estoura o teto de renders (quando não derruba o
// navegador antes).
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { ContentPane } from "./content-pane";
import { useAcoesPublicadas, type AcoesPublicadas } from "./acoes-publicadas";

let renders = 0;
let ler: () => AcoesPublicadas | null = () => null;

function Ouvinte() {
  const { obter, publicar } = useAcoesPublicadas();
  renders += 1;
  ler = obter;
  return (
    <div style={{ width: 900, height: 600 }}>
      <ContentPane
        currentPath="C:\\naoexiste-1386"
        onNavegar={() => {}}
        onAcoesProntas={publicar}
      />
    </div>
  );
}

describe("#1386 publicação das ações do painel", () => {
  beforeEach(() => {
    cleanup();
    renders = 0;
    ler = () => null;
  });

  it("as ações chegam sem custar um render sequer ao ouvinte", async () => {
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <Ouvinte />
        </TooltipProvider>
      </IdiomaProvider>,
    );

    // O painel desiste da leitura (sem Tauri o `listarDir` rejeita) e publica.
    const fim = Date.now() + 5000;
    while (Date.now() < fim && ler() === null) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const publicado = ler();
    expect(publicado, "o painel nunca publicou as ações").not.toBeNull();
    expect(typeof publicado!.acoes.copiar).toBe("function");

    // E o ouvinte não repintou por causa disso: o teto é baixo de propósito —
    // um laço passa de centenas antes do primeiro segundo.
    await new Promise((r) => setTimeout(r, 800));
    expect(renders, `renders do ouvinte: ${renders}`).toBeLessThan(3);
  });
});
