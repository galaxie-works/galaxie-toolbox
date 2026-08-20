import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { toast } from "sonner";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma } from "@/lib/idioma";
import { usePersistedState } from "@/lib/persist";
import { cn } from "@/lib/utils";
import {
  abrirCaminhoFs,
  buscarArquivos,
  checarConflitos,
  copiarComProgresso,
  copiarVariasComProgresso,
  dirsConhecidos,
  listarCloudLocations,
  listarDir,
  listarDrives,
  moverComProgresso,
  moverVariasComProgresso,
  observarPasta,
  type BuscaHandle,
} from "@/lib/api";
import type {
  CloudLocation,
  DriveInfo,
  FsConflict,
  FsEntry,
} from "@/lib/types";
import { DrivesView } from "./drives-view";
import { ArvoreArquivos, RailArvore } from "./arvore";
import { NavBarArquivos } from "./navbar";
import { ContentPane } from "./content-pane";
import { ResultadosBusca } from "./resultados-busca";
import { InspectorPane } from "./inspector";
// #987: a máquina de `ops` (assinatura de progresso + handlers) subiu pro
// `useOpsAtivas`, montado no App (sino na title bar). Aqui só disparamos as
// transferências e registramos tipo/destino por opId ao iniciá-las.
import { registrarOp } from "./use-ops-ativas";
import { ConflitoDialog } from "./conflito-dialog";
import { TooltipAcao } from "./tooltip-acao";
import { planejarTransferencia, type ResolucaoConflito } from "./operacao";
import { CAMINHO_ESTE_PC, nomeBase, pathPai } from "./caminho";
import type { Clipboard, OperacaoClipboard } from "./menu-arquivo";
import {
  CHAVE_PINS_ACESSO_RAPIDO,
  adicionarPin,
  estaFixado,
  mesclarAcessoRapido,
  removerPin,
  type PinAcessoRapido,
} from "./quick-access";

// --- Estado de navegação (histórico back/forward + caminho atual) ----------
// Local ao shell (useReducer): é estado de UI efêmero, não tenant-scoped — não
// precisa entrar no store/reset de sessão.
interface NavState {
  currentPath: string;
  history: string[];
  historyIndex: number;
}

type NavAction =
  | { type: "navegar"; path: string }
  | { type: "voltar" }
  | { type: "avancar" }
  | { type: "acima" };

const NAV_INICIAL: NavState = { currentPath: "", history: [], historyIndex: -1 };

function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "navegar": {
      if (action.path === state.currentPath) return state;
      const history = state.history
        .slice(0, state.historyIndex + 1)
        .concat(action.path);
      return {
        currentPath: action.path,
        history,
        historyIndex: history.length - 1,
      };
    }
    case "voltar": {
      if (state.historyIndex <= 0) return state;
      const historyIndex = state.historyIndex - 1;
      return { ...state, historyIndex, currentPath: state.history[historyIndex] };
    }
    case "avancar": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const historyIndex = state.historyIndex + 1;
      return { ...state, historyIndex, currentPath: state.history[historyIndex] };
    }
    case "acima": {
      if (!state.currentPath) return state;
      const pai = pathPai(state.currentPath);
      if (pai === state.currentPath) return state;
      const history = state.history
        .slice(0, state.historyIndex + 1)
        .concat(pai);
      return { currentPath: pai, history, historyIndex: history.length - 1 };
    }
    default:
      return state;
  }
}

interface ConflitoPendente {
  sources: string[];
  destDir: string;
  op: OperacaoClipboard;
  conflitos: FsConflict[];
}

/**
 * #677: casca do Explorer — layout em grid redimensionável [árvore | conteúdo |
 * inspector]. #724 adiciona a orquestração de transferências com progresso
 * (copy/move via `*ComProgresso`, rastreadas por opId), o diálogo de conflito
 * (checado ANTES da op) e o watcher de disco (live refresh do conteúdo). O
 * painel da árvore = card no estilo do sidebar de Apps/Bridge; painel de
 * conteúdo = NavBar + ContentPane virtualizado.
 */
// #869 (adendo do Wagner): largura do rail em % do grupo. O `collapsedSize`
// do react-resizable-panels e percentual, entao esta e a fatia do painel que
// sobra colapsada — o suficiente pra um icone de 32px com respiro.
const TAMANHO_RAIL = 4;

export function ExplorerShell({
  onLocalChange,
}: {
  /** #872: reporta o local atual pra o host da aba (Navigator) mostrar
   *  "Files - <local>" + tooltip do caminho completo. `rotulo` = pasta atual (ou
   *  "Este computador" no This PC); `caminho` = caminho completo (ou o mesmo
   *  rótulo no This PC, que não tem caminho real). */
  onLocalChange?: (info: { rotulo: string; caminho: string }) => void;
} = {}) {
  const { t } = useIdioma();
  // #869: colapso do painel da arvore. O estado VIVE no proprio painel
  // (`collapsible` do react-resizable-panels, persistido pelo `autoSaveId`
  // do #819); este booleano so espelha o que o painel avisa por
  // `onCollapse`/`onExpand`, pra escolher entre arvore e rail na renderizacao.
  const painelArvore = useRef<ImperativePanelHandle>(null);
  const [arvoreColapsada, setArvoreColapsada] = useState(false);
  const [nav, dispatch] = useReducer(navReducer, NAV_INICIAL);
  // #872: via ref pra o efeito de report depender SÓ do caminho (o callback do
  // App é recriado a cada render; sem a ref, o efeito dispararia todo render).
  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  // #869: mounts de nuvem locais (seção "Cloud drives" do sidebar). Carregados uma
  // vez no mount, como drives/acesso rápido. `null` = ainda carregando/degradou.
  const [cloudLocations, setCloudLocations] = useState<CloudLocation[] | null>(
    null,
  );
  const [acessoRapido, setAcessoRapido] = useState<FsEntry[] | null>(null);
  // #869 (Quick access pin/sort): pins do usuário PERSISTIDOS (localStorage puro
  // via usePersistedState — conveniência de UI local, não tenant-scoped). A seção
  // "Acesso rápido" da árvore = pins + dirs conhecidos do sistema, dedupados e
  // ordenados por nome (mesclarAcessoRapido).
  const [pins, setPins] = usePersistedState<PinAcessoRapido[]>(
    CHAVE_PINS_ACESSO_RAPIDO,
    [],
  );
  // #681: seleção liftada do ContentPane → alimenta o InspectorPane.
  const [selecionados, setSelecionados] = useState<FsEntry[]>([]);
  // #819/#854: visibilidade do painel de detalhes PERSISTE entre sessões (local).
  // #854: default = FECHADO (Wagner) — só abre se o usuário ligar. O
  // `usePersistedState` lê o localStorage no mount (init lazy) e grava a cada
  // troca, então o "fechado" que o usuário deixou sobrevive ao restart. As
  // larguras dos painéis persistem pelo `autoSaveId` do ResizablePanelGroup.
  const [mostrarInspector, setMostrarInspector] = usePersistedState(
    "explorer.inspector.v1",
    false,
  );
  // #714: área de transferência interna (recortar/copiar/colar). Vive no shell
  // pra sobreviver à navegação entre pastas.
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);

  // #871 (fatia 2b/2c): busca recursiva. `null` = sem busca (mostra a
  // lista/DrivesView normal). Na PASTA (fatia 2b) = uma raiz; no This PC (fatia 2c)
  // = fan-out sobre TODOS os drives. Os handles vivos ficam na ref (LISTA — um por
  // raiz) pra cancelar TODOS ao re-buscar, limpar ou navegar. A busca é por-local:
  // trocar de caminho a zera (efeito abaixo).
  const [busca, setBusca] = useState<{
    query: string;
    resultados: FsEntry[];
    buscando: boolean;
    truncado: boolean;
  } | null>(null);
  const buscaHandlesRef = useRef<BuscaHandle[]>([]);
  // #968: ref do input de busca da navbar — Ctrl+E (aoTeclar do ContentPane) foca.
  const buscaInputRef = useRef<HTMLInputElement>(null);
  // #968: ref do container da lista — a navbar foca-o ao SAIR da busca (ESC).
  const listaRef = useRef<HTMLDivElement>(null);
  // #1060 (UX21): modo "editar caminho" do breadcrumb — CONTROLADO aqui pra que
  // o Ctrl+L (no aoTeclar do ContentPane) e o clique/teclado no breadcrumb
  // compartilhem o MESMO estado.
  const [editandoCaminho, setEditandoCaminho] = useState(false);

  // #724: diálogo de conflito + nonce do watcher (bump → ContentPane recarrega a
  // MESMA pasta). #987: a fila de `ops` + a assinatura de progresso mudaram-se
  // pro `useOpsAtivas` (montado no App); aqui só disparamos as transferências.
  const [conflito, setConflito] = useState<ConflitoPendente | null>(null);
  const [watcherNonce, setWatcherNonce] = useState(0);
  // t via ref → os toasts dos produtores saem no idioma atual sem re-render.
  const tRef = useRef(t);
  tRef.current = t;

  // Carrega drives + acesso rápido uma vez. #870: NÃO auto-navega pro 1º drive —
  // a aba nasce no This PC (sentinel `currentPath: ""` → DrivesView com os cards
  // do #855). Como cada aba de Files é uma instância própria do shell (key por
  // aba no Navigator), toda aba nova começa no This PC, sem herdar caminho de
  // outra nem cair em C:.
  useEffect(() => {
    let vivo = true;
    void listarDrives()
      .then((lista) => {
        if (!vivo) return;
        setDrives(lista);
      })
      .catch(() => vivo && setDrives([]));
    void dirsConhecidos()
      .then((q) => vivo && setAcessoRapido(q))
      .catch(() => {
        /* acesso rápido é opcional; degrada sem a seção */
      });
    // #869: mounts de nuvem (opcional — só aparece se houver cliente instalado).
    void listarCloudLocations()
      .then((c) => vivo && setCloudLocations(c))
      .catch(() => {
        /* nuvem é opcional; degrada sem a seção */
      });
    return () => {
      vivo = false;
    };
  }, []);

  // #872: reporta o local atual pro host da aba (label "Files - <local>" +
  // tooltip do caminho). Dispara no mount (This PC) e a cada navegação. Deps só
  // no caminho + no rótulo do This PC (i18n) — o callback vai por ref.
  useEffect(() => {
    const p = nav.currentPath;
    const rotulo = p === CAMINHO_ESTE_PC ? t.arquivos.drives : nomeBase(p);
    const caminho = p === CAMINHO_ESTE_PC ? t.arquivos.drives : p;
    onLocalChangeRef.current?.({ rotulo, caminho });
  }, [nav.currentPath, t.arquivos.drives]);

  // #724: watcher de disco na pasta atual (live refresh). CRÍTICO — a `parar` que
  // a promise resolve DEVE ser chamada ao trocar de pasta / desmontar, e a
  // corrida de resolver-depois-do-cleanup é tratada: se `cancelado` já é true
  // quando resolve, para o watcher recém-criado na hora (sem vazar). Os bursts de
  // `fs-change` são coalescidos num timer de 250ms → um único bump de nonce.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const path = nav.currentPath;
    if (!path) return;
    let cancelado = false;
    let parar: (() => Promise<void>) | null = null;
    void observarPasta(path, false, () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (!cancelado) setWatcherNonce((n) => n + 1);
      }, 250);
    })
      .then((h) => {
        if (cancelado) {
          // Resolveu depois do cleanup: desliga o watcher recém-criado.
          void h.parar();
          return;
        }
        parar = h.parar;
      })
      .catch(() => {});
    return () => {
      cancelado = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (parar) void parar();
    };
  }, [nav.currentPath]);

  const navegar = (path: string) => dispatch({ type: "navegar", path });

  // #869: fixa/desafixa a pasta no Acesso rápido (toggle pelo estado atual do
  // pin). Guardamos o `name` junto pra rotular o nó sem reler o disco.
  const alternarFixar = useCallback(
    (entry: FsEntry) => {
      setPins((prev) =>
        estaFixado(prev, entry.path)
          ? removerPin(prev, entry.path)
          : adicionarPin(prev, { path: entry.path, name: entry.name }),
      );
    },
    [setPins],
  );

  // #869: lista final do Acesso rápido (pins + sistema, dedupada e ordenada por
  // nome). `acessoRapido` pode ser null enquanto carrega — os pins ainda
  // aparecem. Array vazio → a árvore omite a seção (como hoje).
  const acessoRapidoMesclado = mesclarAcessoRapido(pins, acessoRapido ?? []);

  // #871 (fatia 2b/2c): dispara a busca recursiva. Numa PASTA (2b) = uma raiz; no
  // This PC (2c) = fan-out sobre TODOS os drives. Cancela os handles anteriores,
  // zera os resultados e consome os streams (`buscarArquivos`), MESCLANDO os lotes
  // de todas as raízes (ordem de chegada — sem sort no v1). Cada lote pode marcar
  // `truncated` ao bater o teto (`maxResults` é POR drive). Um contador `pendentes`
  // (closure compartilhado entre os N streams) mantém o spinner vivo até TODAS as
  // raízes terminarem: decrementa no lote `done` de cada raiz E no `.catch` de
  // início; só ao zerar vira `buscando:false`. Uma raiz que falha ao iniciar só
  // decrementa — não derruba a busca das outras.
  const onBuscar = useCallback(
    (query: string) => {
      const roots = nav.currentPath
        ? [nav.currentPath]
        : (drives ?? []).map((d) => d.path); // This PC: raiz de cada drive
      if (roots.length === 0) return;
      buscaHandlesRef.current.forEach((h) => void h.cancelar());
      buscaHandlesRef.current = [];
      setBusca({ query, resultados: [], buscando: true, truncado: false });
      let pendentes = roots.length;
      for (const root of roots) {
        void buscarArquivos(
          root,
          query,
          (lote) => {
            setBusca((b) =>
              b
                ? {
                    ...b,
                    resultados: [...b.resultados, ...lote.entries],
                    truncado: b.truncado || lote.truncated,
                  }
                : b,
            );
            if (lote.done) {
              pendentes -= 1;
              if (pendentes <= 0)
                setBusca((b) => (b ? { ...b, buscando: false } : b));
            }
          },
          { maxResults: 1000 },
        )
          .then((h) => {
            buscaHandlesRef.current.push(h);
          })
          .catch(() => {
            // Falha ao iniciar UMA raiz → só decrementa (não derruba as outras).
            pendentes -= 1;
            if (pendentes <= 0)
              setBusca((b) => (b ? { ...b, buscando: false } : b));
          });
      }
    },
    [nav.currentPath, drives],
  );

  // #871 (fatia 2b/2c): sai da busca — cancela TODOS os streams vivos e volta pra
  // lista/DrivesView normal.
  const onLimparBusca = useCallback(() => {
    buscaHandlesRef.current.forEach((h) => void h.cancelar());
    buscaHandlesRef.current = [];
    setBusca(null);
  }, []);

  // #871 (fatia 2b/2c): busca é POR-LOCAL — navegar limpa a busca (e cancela os
  // streams de todas as raízes).
  useEffect(() => {
    buscaHandlesRef.current.forEach((h) => void h.cancelar());
    buscaHandlesRef.current = [];
    setBusca(null);
  }, [nav.currentPath]);

  // #724: executa o plano de destinos (após resolver conflitos, se houver). Cada
  // op devolve um opId — o tipo é registrado pro painel; os eventos de progresso
  // chegam pela assinatura única. `cut` limpa o clipboard após disparar.
  const executarPlano = useCallback(
    async (
      sources: string[],
      destDir: string,
      op: OperacaoClipboard,
      conflitos: FsConflict[],
      resolucao: ResolucaoConflito,
    ) => {
      // #680: "manter ambos" precisa da listagem REAL do destino pra não
      // reescolher um sufixo já ocupado (o helper é puro, não lê disco). Só
      // listamos quando é manterAmbos — as outras resoluções não precisam.
      let ocupadosDestino: string[] = [];
      if (resolucao === "manterAmbos") {
        try {
          ocupadosDestino = (await listarDir(destDir)).map((e) => e.name);
        } catch {
          // Sem listagem → degrada pro comportamento antigo (evita só os
          // conflitos conhecidos); o backend ainda barra sobrescrita acidental.
        }
      }
      const plano = planejarTransferencia(
        sources,
        destDir,
        conflitos,
        resolucao,
        ocupadosDestino,
      );
      for (const item of plano) {
        try {
          const opId =
            op === "copy"
              ? await copiarComProgresso(item.from, item.to)
              : await moverComProgresso(item.from, item.to);
          registrarOp(opId, op === "copy" ? "copy" : "move", nomeBase(destDir));
        } catch (e) {
          toast.error(tRef.current.arquivos.erroOperacao, {
            description: String(e),
          });
        }
      }
      if (op === "cut") setClipboard(null);
    },
    [],
  );

  // #850 (fatia B): transferência MULTI-ORIGEM numa op só (um opId, uma fase,
  // progresso global) — mata o "2 pastas sequenciais". As origens vão pro destino
  // com o nome ORIGINAL, então serve o caminho SEM rename por-origem (sem
  // conflito). O caso "manter ambos" (rename por-origem) continua no
  // `executarPlano` por-item, que a op multi não expressa.
  const executarMulti = useCallback(
    async (sources: string[], destDir: string, op: OperacaoClipboard) => {
      try {
        const opId =
          op === "copy"
            ? await copiarVariasComProgresso(sources, destDir)
            : await moverVariasComProgresso(sources, destDir);
        registrarOp(opId, op === "copy" ? "copy" : "move", nomeBase(destDir));
      } catch (e) {
        toast.error(tRef.current.arquivos.erroOperacao, {
          description: String(e),
        });
      }
      if (op === "cut") setClipboard(null);
    },
    [],
  );

  // #724: ponto de entrada do colar/copiar/mover — checa conflitos ANTES; abre o
  // diálogo se houver, senão executa direto.
  const iniciarTransferencia = useCallback(
    (sources: string[], destDir: string, op: OperacaoClipboard) => {
      if (sources.length === 0) return;
      void (async () => {
        let conflitos: FsConflict[] = [];
        try {
          conflitos = await checarConflitos(sources, destDir);
        } catch {
          // Falha ao checar → segue sem diálogo (o backend ainda barra/decide).
        }
        if (conflitos.length === 0) {
          // #850: sem conflito → UMA op multi-origem (progresso global), não N
          // ops sequenciais.
          await executarMulti(sources, destDir, op);
          return;
        }
        setConflito({ sources, destDir, op, conflitos });
      })();
    },
    [executarMulti],
  );

  // #1290 me ensinou: tooltip e `aria-label` saem do MESMO rotulo, senao um
  // muda e o outro fica pra tras.
  const rotuloColapso = arvoreColapsada
    ? t.arquivos.sidebarExpandir
    : t.arquivos.sidebarColapsar;

  return (
    <div className="relative h-full">
      {/* #819: `autoSaveId` persiste as larguras dos painéis (árvore/conteúdo/
          inspector) em localStorage entre sessões. O react-resizable-panels
          guarda um layout por configuração de painéis (com/sem inspector, via
          os `id`+`order` estáveis), então casa com o toggle persistido acima. */}
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="explorer.layout.v1"
        className="h-full"
      >
        {/* #869 (adendo do Wagner): o painel da árvore COLAPSA pra um rail de
            ícones. `collapsible` + `collapsedSize` são do próprio
            react-resizable-panels, então o estado colapsado entra no MESMO
            layout que o `autoSaveId` do #819 já persiste — não inventei uma
            segunda memória que pudesse divergir daquela. O handle manual
            continua valendo: colapsar é atalho, não substituto do arrasto. */}
        <ResizablePanel
          id="tree"
          order={1}
          ref={painelArvore}
          collapsible
          collapsedSize={TAMANHO_RAIL}
          defaultSize={22}
          minSize={16}
          maxSize={42}
          onCollapse={() => setArvoreColapsada(true)}
          onExpand={() => setArvoreColapsada(false)}
        >
          <aside
            className={cn(
              "flex h-full flex-col rounded-xl border bg-card",
              arvoreColapsada ? "items-center p-1.5" : "p-3",
            )}
          >
            <div
              className={cn(
                "flex shrink-0",
                arvoreColapsada ? "justify-center" : "justify-end",
              )}
            >
              <TooltipAcao label={rotuloColapso}>
                <button
                  type="button"
                  aria-label={rotuloColapso}
                  aria-expanded={!arvoreColapsada}
                  onClick={() => {
                    const painel = painelArvore.current;
                    if (!painel) return;
                    if (painel.isCollapsed()) painel.expand();
                    else painel.collapse();
                  }}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {arvoreColapsada ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </button>
              </TooltipAcao>
            </div>
            {drives === null ? (
              <div className="flex flex-1 items-center justify-center py-6">
                <Spinner className="size-4 text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="min-h-0 w-full flex-1">
                {/* #869: árvore ÚNICA — Este computador → drives → pastas (lazy) e
                    Acesso rápido como raiz-irmã. Substitui o `LocaisSidebar` flat
                    + a seção "Pastas" separada. Colapsada, vira o rail: os mesmos
                    destinos de 1º nível, só ícone + tooltip com o nome. */}
                <div className={arvoreColapsada ? undefined : "pr-2"}>
                  {arvoreColapsada ? (
                    <RailArvore
                      drives={drives}
                      cloudLocations={cloudLocations}
                      acessoRapido={acessoRapidoMesclado}
                      currentPath={nav.currentPath}
                      onNavegar={navegar}
                    />
                  ) : (
                    <ArvoreArquivos
                      drives={drives}
                      cloudLocations={cloudLocations}
                      acessoRapido={acessoRapidoMesclado}
                      pins={pins}
                      onAlternarFixar={alternarFixar}
                      currentPath={nav.currentPath}
                      onNavegar={navegar}
                    />
                  )}
                </div>
              </ScrollArea>
            )}
          </aside>
        </ResizablePanel>

        <ResizableHandle withHandle className="mx-1.5 bg-transparent" />

        <ResizablePanel id="content" order={2} defaultSize={53} minSize={30}>
          {/* #854: a toolbar (navbar + views/filtro) fica no TOPO da content-area,
              largura cheia e FORA do card da lista; a lista mora no seu próprio
              card (dentro do ContentPane). Sem o card externo que boxeava os dois
              juntos. */}
          <div className="flex h-full min-h-0 flex-col gap-2">
            <NavBarArquivos
              currentPath={nav.currentPath}
              canBack={nav.historyIndex > 0}
              canForward={nav.historyIndex < nav.history.length - 1}
              onBack={() => dispatch({ type: "voltar" })}
              onForward={() => dispatch({ type: "avancar" })}
              onUp={() => dispatch({ type: "acima" })}
              // #871: refresh da linha 1 — bumpa o nonce do watcher, que o
              // ContentPane recebe como `refreshSignal` e re-lê a MESMA pasta.
              onRefresh={() => setWatcherNonce((n) => n + 1)}
              onNavegar={navegar}
              // #871 (fatia 2b): busca recursiva na pasta atual.
              buscaAtiva={busca !== null}
              onBuscar={onBuscar}
              onLimparBusca={onLimparBusca}
              // #871 (fatia 2c): busca habilitada numa pasta OU no This PC assim
              // que houver ao menos um drive carregado (fan-out multi-drive).
              podeBuscar={nav.currentPath !== "" || (drives?.length ?? 0) > 0}
              // #968: Ctrl+E (no aoTeclar do ContentPane) foca este input.
              buscaRef={buscaInputRef}
              onSairBusca={() =>
                listaRef.current?.focus({ preventScroll: true })
              }
              // #1060 (UX21): edição do caminho controlada pelo shell (Ctrl+L +
              // clique/teclado no breadcrumb compartilham o estado).
              editando={editandoCaminho}
              onEditandoChange={setEditandoCaminho}
            />
            {busca !== null ? (
              // #871 (fatia 2b): busca ativa → resultados no lugar da lista/DrivesView.
              <ResultadosBusca
                query={busca.query}
                resultados={busca.resultados}
                buscando={busca.buscando}
                truncado={busca.truncado}
                onAbrir={(entry) => {
                  if (entry.isDir) navegar(entry.path);
                  else
                    void abrirCaminhoFs(entry.path).catch(() => {
                      toast.error(t.arquivos.erroOperacao);
                    });
                  onLimparBusca();
                }}
                onFechar={onLimparBusca}
              />
            ) : nav.currentPath ? (
              <ContentPane
                currentPath={nav.currentPath}
                onNavegar={navegar}
                onVoltar={() => dispatch({ type: "voltar" })}
                onAvancar={() => dispatch({ type: "avancar" })}
                onAcima={() => dispatch({ type: "acima" })}
                onSelecaoChange={setSelecionados}
                clipboard={clipboard}
                onClipboardChange={setClipboard}
                onTransferir={iniciarTransferencia}
                refreshSignal={watcherNonce}
                mostrarInspector={mostrarInspector}
                onToggleInspector={() => setMostrarInspector((v) => !v)}
                // #968: Ctrl+E foca a busca da navbar (ref compartilhada).
                buscaRef={buscaInputRef}
                listaRef={listaRef}
                // #1060 (UX21): Ctrl+L abre o modo "editar caminho" do breadcrumb.
                onEditarCaminho={() => setEditandoCaminho(true)}
              />
            ) : drives && drives.length > 0 ? (
              // #855: "Este computador" selecionado (sentinel de caminho vazio)
              // e drives carregados → grade de cards de drives no lugar da lista.
              <DrivesView drives={drives} onNavegar={navegar} />
            ) : (
              // No This PC (#870) enquanto os drives ainda não caíram (loading) ou
              // se não houver nenhum — some assim que o DrivesView pode aparecer.
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card text-center">
                <div>
                  <p className="text-sm font-medium">
                    {t.arquivos.conteudoTitulo}
                  </p>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>

        {mostrarInspector && (
          <>
            <ResizableHandle withHandle className="mx-1.5 bg-transparent" />
            <ResizablePanel
              id="inspector"
              order={3}
              defaultSize={25}
              minSize={16}
              maxSize={40}
            >
              <InspectorPane itens={selecionados} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* #987: o Status Center (activity-dropdown) + o preview de undo agora vivem
          no App (sino na title bar, sempre visível) — ver `useOpsAtivas`. O shell
          só dispara as transferências e resolve conflitos. */}
      <ConflitoDialog
        aberto={conflito !== null}
        conflitos={conflito?.conflitos ?? []}
        destDir={conflito?.destDir ?? ""}
        onResolver={(resolucao) => {
          const c = conflito;
          setConflito(null);
          if (c) void executarPlano(c.sources, c.destDir, c.op, c.conflitos, resolucao);
        }}
        onCancelar={() => setConflito(null)}
      />
    </div>
  );
}
