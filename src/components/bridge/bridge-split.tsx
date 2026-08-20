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

/**
 * #1392: o MÍNIMO é em px, o MÁXIMO em %. Não é inconsistência — são regras
 * diferentes.
 *
 * O mínimo existe pra o sidebar continuar LEGÍVEL (o #466 escolheu 256px porque
 * é o que cabe "Caixa de entrada" em pt). Legibilidade não escala com a janela:
 * numa tela de 3000px, 12% seriam 360px e o texto não fica mais legível por
 * isso — só rouba espaço do conteúdo.
 *
 * O máximo existe pra o sidebar não COMER a área de conteúdo, e isso é
 * proporcional por natureza: 40% de qualquer tela é "quase metade".
 *
 * Era misturar as duas coisas que quebrava: `defaultSize` vinha de px e
 * `minSize` era 12% fixo, então em tela larga o mínimo percentual (360px)
 * ganhava dos 256px pretendidos — e o console avisava "default size should not
 * be less than min size", que era o sintoma dizendo o nome do erro.
 */
const MIN_SIDEBAR_PX = 200;
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
  /** #1392: o usuário arrastou NESTA sessão? Se sim, a largura é dele. */
  const usuarioArrastou = useRef(false);
  /**
   * #1392: havia layout salvo QUANDO CHEGAMOS?
   *
   * Tem de ser lido uma vez, no mount, e guardado. Ler o `localStorage` a cada
   * passada nao funciona: o meu proprio `resize()` faz a biblioteca gravar o
   * layout, e a partir dai a pergunta "o usuario ja escolheu?" passa a responder
   * SIM pra uma escolha que fui eu quem fez. Foi assim que a primeira versao
   * deste conserto continuou engordando ao maximizar — a guarda pegou.
   */
  const havialayoutSalvo = useRef<boolean | null>(null);
  if (havialayoutSalvo.current === null) {
    havialayoutSalvo.current = temLayoutSalvo(BRIDGE_SIDEBAR_LAYOUT, localStorage);
  }
  const [grupoPx, setGrupoPx] = useState(GRUPO_SUPOSTO_PX);

  // #1392: OBSERVA o grupo, não mede uma vez só. Medir no mount bastaria se a
  // janela nunca mudasse de tamanho — e ela muda. Sem observar, a fatia
  // calculada pra 1280px continuava valendo depois de maximizar, e o sidebar
  // engordava proporcionalmente (591px numa tela de 3000, contra os 256 do
  // #466). Foi assim que a `iris` achou.
  useEffect(() => {
    const g = document.getElementById(ID_GRUPO);
    if (!g) return;
    const medir = () => {
      const largura = g.getBoundingClientRect().width;
      if (largura > 0) setGrupoPx((atual) => (largura === atual ? atual : largura));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(g);
    return () => observador.disconnect();
  }, []);

  // Mantém os 256px do #466 a cada mudança de largura do grupo — até o usuário
  // arrastar. Antes isto rodava UMA vez (`larguraAjustada`), o que bastava pro
  // mount e falhava em toda mudança de janela depois dele.
  //
  // Quem manda continua sendo quem arrasta: `temLayoutSalvo` cobre o arrasto de
  // sessões passadas e `usuarioArrastou` cobre o desta. Sem essas duas travas,
  // eu estaria desfazendo a escolha do usuário a cada resize da janela — que é
  // pior que o bug original.
  useEffect(() => {
    if (colapsada || usuarioArrastou.current) return;
    const p = painel.current;
    if (!p) return;
    if (havialayoutSalvo.current) return;
    const pct = larguraIdealPct({
      conteudoPx: LARGURA_SIDEBAR_PX,
      folgaPx: 0,
      grupoPx,
      minPct: pctDe(MIN_SIDEBAR_PX, grupoPx),
      maxPct: MAX_PCT,
    });
    if (pct === null) return; // cedo demais: tenta no próximo render
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
        minSize={pctDe(MIN_SIDEBAR_PX, grupoPx)}
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
      <ResizableHandle
        className="mx-1.5 bg-transparent"
        onDragging={(arrastando) => {
          if (arrastando) usuarioArrastou.current = true;
        }}
      />
      <ResizablePanel id="bridge-content" order={2} className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
