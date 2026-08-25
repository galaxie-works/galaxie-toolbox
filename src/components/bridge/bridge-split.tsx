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
// ── #1392, 2ª reprovação do PO: a UNIDADE estava errada ────────────────────
//
// O `wagner` reprovou duas vezes o mesmo sintoma — "o sidebar engorda quando a
// janela cresce" — e a minha 1ª correção não pegou. Ela tratava o sintoma
// (reajustar no resize) mantendo a PORCENTAGEM como fonte da verdade, via
// `autoSaveId` do `react-resizable-panels`.
//
// Duas coisas quebravam:
//
// 1. **A unidade.** 20% de 1280 são 256px; 20% de 3000 são 600px. Guardar % faz
//    a mesma escolha inchar sozinha. Nenhum reajuste conserta isso — o que está
//    guardado já é a coisa errada.
//
// 2. **A trava que eu mesmo pus.** Pra não desfazer a escolha de quem arrastou,
//    eu só reajustava quando NÃO havia layout salvo — mas o `autoSaveId` grava
//    no primeiro render. Na prática havia layout salvo quase sempre, e o
//    conserto ficava desligado pra quem já tinha aberto o Bridge uma vez. Foi
//    exatamente isso que sobrou pro PO ver.
//
// Agora a fonte é PX (`largura-sidebar-px.ts`), com chave própria. A % virou
// tradução, recalculada a cada mudança de largura do grupo. O `autoSaveId` saiu:
// dois donos da mesma decisão, em unidades diferentes, era o bug.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  gravarLarguraPx,
  larguraSidebarPx,
  lerLarguraPx,
  pctDoGrupo,
} from "@/lib/largura-sidebar-px";

/** `id` no DOM do grupo — é por ele que a medida acha a largura total. */
const ID_GRUPO = "bridge-split";

/**
 * Largura histórica do sidebar (`w-64` = 256px), escolhida a dedo no #466: é o
 * que cabe "Caixa de entrada" em pt sem truncar.
 */
export const LARGURA_SIDEBAR_PX = 256;
/** `w-16` = 64px: o mesmo rail que o sidebar já usava colapsado. */
export const LARGURA_RAIL_PX = 64;

/**
 * O MÍNIMO é em px e o MÁXIMO em %. Não é inconsistência — são regras
 * diferentes: legibilidade não escala com a janela (256px de texto continuam
 * 256px numa tela de 3000), mas "não comer o conteúdo" é proporcional.
 */
const MIN_SIDEBAR_PX = 200;
const MAX_PCT = 40;
/** Janela suposta enquanto ninguém mediu nada — só evita o painel nascer em 0. */
const GRUPO_SUPOSTO_PX = 1280;

const LIMITES = { minPx: MIN_SIDEBAR_PX, maxPct: MAX_PCT };

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
  const [grupoPx, setGrupoPx] = useState(GRUPO_SUPOSTO_PX);
  /**
   * A largura que o usuário quer, em PX. Lida uma vez no mount: nunca escolheu
   * → o default do #466. Esta é a fonte da verdade do componente inteiro.
   */
  const [desejadaPx, setDesejadaPx] = useState(
    () => lerLarguraPx(localStorage) ?? LARGURA_SIDEBAR_PX,
  );

  // OBSERVA o grupo, não mede uma vez só: medir no mount bastaria se a janela
  // nunca mudasse de tamanho, e ela muda.
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

  /**
   * Mantém a largura em PX a cada mudança do grupo.
   *
   * Não há mais trava de "só se o usuário nunca arrastou": o que ele escolheu já
   * está em `desejadaPx`, então reaplicar PRESERVA a escolha em vez de desfazê-la.
   * Era aquela trava que deixava o conserto anterior desligado na prática.
   */
  useEffect(() => {
    if (colapsada) return;
    const p = painel.current;
    if (!p || !(grupoPx > 0)) return;
    const alvoPct = pctDoGrupo(
      larguraSidebarPx(desejadaPx, grupoPx, LIMITES),
      grupoPx,
    );
    // Só mexe se divergir de verdade: `resize()` a cada render brigaria com o
    // arrasto em curso (o handle emite muitos eventos por segundo).
    if (Math.abs(p.getSize() - alvoPct) > 0.15) p.resize(alvoPct);
  }, [colapsada, grupoPx, desejadaPx]);

  // O chamador manda colapsar/expandir (botão do sidebar); o painel obedece.
  useEffect(() => {
    const p = painel.current;
    if (!p) return;
    if (colapsada && !p.isCollapsed()) p.collapse();
    else if (!colapsada && p.isCollapsed()) p.expand();
  }, [colapsada]);

  /**
   * Fim do arrasto: traduz a % que sobrou de volta pra px e guarda. É aqui que a
   * escolha do usuário entra na fonte da verdade — e é o que mantém o splitter
   * útil depois de a largura virar fixa, que é o que o PO pediu.
   */
  const aoTerminarArrasto = useCallback(() => {
    const p = painel.current;
    if (!p || p.isCollapsed() || !(grupoPx > 0)) return;
    const px = Math.round((p.getSize() / 100) * grupoPx);
    if (px <= 0) return;
    setDesejadaPx(px);
    gravarLarguraPx(localStorage, px);
  }, [grupoPx]);

  return (
    <ResizablePanelGroup
      id={ID_GRUPO}
      direction="horizontal"
      className="min-h-0 flex-1"
    >
      <ResizablePanel
        id="bridge-sidebar"
        order={1}
        ref={painel}
        collapsible
        collapsedSize={pctDoGrupo(LARGURA_RAIL_PX, grupoPx)}
        defaultSize={pctDoGrupo(
          larguraSidebarPx(desejadaPx, grupoPx, LIMITES),
          grupoPx,
        )}
        minSize={pctDoGrupo(MIN_SIDEBAR_PX, grupoPx)}
        maxSize={MAX_PCT}
        onCollapse={() => onColapsadaMudou(true)}
        onExpand={() => onColapsadaMudou(false)}
      >
        {sidebar}
      </ResizablePanel>
      {/* #1373: com o card arredondado de volta, o handle precisa de margem —
          encostado, ele cortaria o canto arredondado. Daí o `mx-1.5
          bg-transparent`, o mesmo que o Explorer usa entre os cards dele.
          #1453: mas o `withHandle` e o `hover:bg-border` voltaram, e a lição é
          o motivo de eu os ter tirado. No #1373 eu escrevi que "o punho no meio
          do vão entre dois cards seria enfeite" — uma decisão de gosto, tomada
          sem olhar os VIZINHOS. O Bridge tem outras duas divisórias, entre os
          mesmos cards arredondados (`control-room.tsx` lista⇄leitor e
          `message-detail.tsx` leitor⇄preview), e as duas têm punho e realce.
          O `wagner` viu a diferença de primeira no passe de runtime.
          Consistência entre irmãos ganha de preferência local: um handle que
          não dá sinal nenhum no hover não avisa que é arrastável. */}
      <ResizableHandle
        withHandle
        onDragging={(arrastando) => {
          if (!arrastando) aoTerminarArrasto();
        }}
      />
      <ResizablePanel id="bridge-content" order={2} className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
