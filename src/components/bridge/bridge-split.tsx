// #912: a divisão sidebar ⇄ conteúdo do Bridge, com splitter no padrão do app.
//
// Vive num arquivo próprio por dois motivos. O primeiro é que o comportamento
// (colapsar, arrastar, lembrar a largura) precisa de guarda em DOM real, e o
// `control-room.tsx` tem 6 mil linhas e pede store, sessão e Graph pra montar —
// testar lá seria testar tudo menos o splitter. O segundo é que o card #1019 já
// pede pra fatiar aquele arquivo por fronteira; esta é uma fronteira.
//
// O colapso é CONTROLADO pelo chamador (o botão do sidebar já existe e a store
// já guarda `sidebarAberta`), mas quem executa é o painel: arrastar o handle até
// o fim também colapsa, e nesse caso o painel avisa de volta. Uma fonte de
// verdade, dois caminhos até ela.
//
// As duas larguras que importam são em PIXELS, não em porcentagem — e o
// `react-resizable-panels` só fala porcentagem. Por isso o componente mede a
// largura do grupo e converte: uma janela maior não pode inchar o sidebar.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { larguraIdealPct, temLayoutSalvo } from "@/lib/largura-painel";

/** Layout salvo do splitter — chave própria, sem misturar com `bridge.layout`
 *  (lista ⇄ detalhe) nem com `bridge.preview`, que dividem outras coisas. */
export const BRIDGE_SIDEBAR_LAYOUT = "bridge.sidebar";

/** `id` no DOM do grupo — é por ele que a medida acha a largura total. */
const ID_GRUPO = "bridge-split";

/**
 * Largura histórica do sidebar (`w-64` = 256px), escolhida a dedo no #466: é o
 * que cabe "Caixa de entrada" em pt sem truncar. Virar painel percentual não
 * pode reintroduzir aquele corte.
 */
export const LARGURA_SIDEBAR_PX = 256;
/** `w-16` = 64px: o mesmo rail que o sidebar já usava colapsado. */
export const LARGURA_RAIL_PX = 64;

const MIN_PCT = 12;
const MAX_PCT = 40;
/** Janela suposta enquanto ninguém mediu nada — só evita o painel nascer em 0. */
const GRUPO_SUPOSTO_PX = 1280;

function pctDe(px: number, grupoPx: number): number {
  return Math.round((px / grupoPx) * 1000) / 10;
}

export function BridgeSplit({
  colapsada,
  onColapsadaMudou,
  sidebar,
  children,
}: {
  colapsada: boolean;
  /** O painel avisa quando ELE mudou (arrasto até o fim, por exemplo). */
  onColapsadaMudou: (colapsada: boolean) => void;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const painel = useRef<ImperativePanelHandle>(null);
  const larguraAjustada = useRef(false);
  const [grupoPx, setGrupoPx] = useState(GRUPO_SUPOSTO_PX);

  // Mede o grupo uma vez e converte as duas larguras-em-px na fatia dele. Sem
  // isso, `collapsedSize` e `defaultSize` seriam porcentagens fixas e o sidebar
  // engordaria junto com a janela — o oposto do que o #466 escolheu.
  useEffect(() => {
    const g = document.getElementById(ID_GRUPO);
    if (!g) return;
    const largura = g.getBoundingClientRect().width;
    if (largura > 0 && largura !== grupoPx) setGrupoPx(largura);
  }, [grupoPx]);

  // Aplica a largura default — uma vez, e só quando ninguém arrastou ainda:
  // quem já escolheu a largura dele manda.
  useEffect(() => {
    if (larguraAjustada.current || colapsada) return;
    const p = painel.current;
    const g = document.getElementById(ID_GRUPO);
    if (!p || !g) return;
    if (temLayoutSalvo(BRIDGE_SIDEBAR_LAYOUT, localStorage)) {
      larguraAjustada.current = true;
      return;
    }
    const pct = larguraIdealPct({
      conteudoPx: LARGURA_SIDEBAR_PX,
      folgaPx: 0,
      grupoPx: g.getBoundingClientRect().width,
      minPct: MIN_PCT,
      maxPct: MAX_PCT,
    });
    if (pct === null) return; // cedo demais: tenta no próximo render
    larguraAjustada.current = true;
    p.resize(pct);
  }, [colapsada, grupoPx]);

  // O chamador manda colapsar/expandir (botão do sidebar); o painel obedece.
  useEffect(() => {
    const p = painel.current;
    if (!p) return;
    if (colapsada && !p.isCollapsed()) p.collapse();
    else if (!colapsada && p.isCollapsed()) p.expand();
  }, [colapsada]);

  return (
    <ResizablePanelGroup
      id={ID_GRUPO}
      direction="horizontal"
      autoSaveId={BRIDGE_SIDEBAR_LAYOUT}
      className="min-h-0 flex-1"
    >
      <ResizablePanel
        id="bridge-sidebar"
        order={1}
        ref={painel}
        collapsible
        collapsedSize={pctDe(LARGURA_RAIL_PX, grupoPx)}
        defaultSize={pctDe(LARGURA_SIDEBAR_PX, grupoPx)}
        minSize={MIN_PCT}
        maxSize={MAX_PCT}
        onCollapse={() => onColapsadaMudou(true)}
        onExpand={() => onColapsadaMudou(false)}
      >
        {sidebar}
      </ResizablePanel>
      {/* #1373: com o card arredondado de volta, o handle precisa de margem —
          encostado, ele cortaria o canto arredondado. Uso o mesmo `mx-1.5
          bg-transparent` que o Explorer já usa entre os cards dele
          (`explorer-shell.tsx`), em vez de inventar espaçamento novo. Segue sem
          `withHandle`: o punho no meio do vão entre dois cards seria enfeite, e
          a área de arrasto continua lá — o handle é fino, não invisível. */}
      <ResizableHandle className="mx-1.5 bg-transparent" />
      <ResizablePanel id="bridge-content" order={2} className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
