import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
import {
  cancelarOp,
  checarConflitos,
  copiarComProgresso,
  copiarVariasComProgresso,
  dirsConhecidos,
  listarDir,
  listarDrives,
  moverComProgresso,
  moverVariasComProgresso,
  observarPasta,
  onProgressoOp,
} from "@/lib/api";
import type { DriveInfo, FsConflict, FsEntry } from "@/lib/types";
import { LocaisSidebar } from "./locais";
import { DrivesView } from "./drives-view";
import { ArvoreArquivos } from "./arvore";
import { NavBarArquivos } from "./navbar";
import { ContentPane } from "./content-pane";
import { InspectorPane } from "./inspector";
import { ProgressoPanel, type OpAtiva } from "./progresso-panel";
import { ConflitoDialog } from "./conflito-dialog";
import { calcVelocidade, planejarTransferencia, type ResolucaoConflito } from "./operacao";
import { pathPai } from "./caminho";
import type { Clipboard, OperacaoClipboard } from "./menu-arquivo";

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
export function ExplorerShell() {
  const { t } = useIdioma();
  const [nav, dispatch] = useReducer(navReducer, NAV_INICIAL);
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  const [acessoRapido, setAcessoRapido] = useState<FsEntry[] | null>(null);
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

  // #724: ops de copy/move ativas (rastreadas por opId) + diálogo de conflito +
  // nonce do watcher (bump → ContentPane recarrega a MESMA pasta).
  const [ops, setOps] = useState<OpAtiva[]>([]);
  const [conflito, setConflito] = useState<ConflitoPendente | null>(null);
  const [watcherNonce, setWatcherNonce] = useState(0);

  // Refs de bookkeeping das ops: último byte/tempo (velocidade), tipo por opId
  // (o payload de progresso não carrega copy/move), e dedupe do evento terminal.
  const ultimoRef = useRef<Map<number, { bytes: number; ms: number }>>(new Map());
  const tiposRef = useRef<Map<number, "copy" | "move">>(new Map());
  const terminadosRef = useRef<Set<number>>(new Set());
  // t via ref → a assinatura de progresso é registrada UMA vez (sem re-subscribe
  // a cada troca de idioma), mas os toasts saem no idioma atual.
  const tRef = useRef(t);
  tRef.current = t;

  // Carrega drives + acesso rápido uma vez; ao ter os drives, cai no 1º drive.
  useEffect(() => {
    let vivo = true;
    void listarDrives()
      .then((lista) => {
        if (!vivo) return;
        setDrives(lista);
        if (lista.length > 0) dispatch({ type: "navegar", path: lista[0].path });
      })
      .catch(() => vivo && setDrives([]));
    void dirsConhecidos()
      .then((q) => vivo && setAcessoRapido(q))
      .catch(() => {
        /* acesso rápido é opcional; degrada sem a seção */
      });
    return () => {
      vivo = false;
    };
  }, []);

  // #724: assina o progresso das ops UMA vez (no mount). Deriva a velocidade
  // entre eventos, remove a op no evento terminal (done/cancelado/erro) e mostra
  // um toast único por op. A unsub é SEMPRE chamada (inclui a corrida de resolver
  // depois do unmount: se `vivo` já é falso quando a promise resolve, desliga na
  // hora). No mock (fora do Tauri) o subscribe é no-op e nenhum evento dispara.
  useEffect(() => {
    let vivo = true;
    let unsub: () => void = () => {};
    void onProgressoOp((p) => {
      const arquivos = tRef.current.arquivos;
      const agora = Date.now();
      const ult = ultimoRef.current.get(p.opId);
      const velocidade = ult
        ? calcVelocidade(p.processedBytes, ult.bytes, agora - ult.ms)
        : 0;
      ultimoRef.current.set(p.opId, { bytes: p.processedBytes, ms: agora });

      const terminal = p.done || p.canceled || p.error != null;
      if (terminal) {
        if (!terminadosRef.current.has(p.opId)) {
          terminadosRef.current.add(p.opId);
          if (p.error) {
            toast.error(arquivos.opFalhou, { description: p.error.message });
          } else if (p.canceled) {
            toast.info(arquivos.opCancelada);
          } else {
            toast.success(arquivos.opConcluida);
          }
        }
        ultimoRef.current.delete(p.opId);
        tiposRef.current.delete(p.opId);
        setOps((prev) => prev.filter((o) => o.opId !== p.opId));
        return;
      }

      setOps((prev) => {
        const tipo = tiposRef.current.get(p.opId) ?? "copy";
        const novo: OpAtiva = { opId: p.opId, tipo, progresso: p, velocidade };
        return prev.some((o) => o.opId === p.opId)
          ? prev.map((o) => (o.opId === p.opId ? novo : o))
          : [...prev, novo];
      });
    })
      .then((fn) => {
        if (!vivo) {
          fn();
          return;
        }
        unsub = fn;
      })
      .catch(() => {});
    return () => {
      vivo = false;
      unsub();
    };
  }, []);

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
          tiposRef.current.set(opId, op === "copy" ? "copy" : "move");
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
        tiposRef.current.set(opId, op === "copy" ? "copy" : "move");
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

  const cancelarTransferencia = useCallback((opId: number) => {
    void cancelarOp(opId).catch(() => {});
  }, []);

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
        <ResizablePanel id="tree" order={1} defaultSize={22} minSize={16} maxSize={42}>
          <aside className="flex h-full flex-col rounded-xl border bg-card p-3">
            {drives === null ? (
              <div className="flex flex-1 items-center justify-center py-6">
                <Spinner className="size-4 text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="min-h-0 w-full flex-1">
                <div className="space-y-3 pr-2">
                  <LocaisSidebar
                    drives={drives}
                    acessoRapido={acessoRapido}
                    currentPath={nav.currentPath}
                    onNavegar={navegar}
                  />
                  <div>
                    <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                      {t.arquivos.pastas}
                    </p>
                    <ArvoreArquivos
                      drives={drives}
                      currentPath={nav.currentPath}
                      onNavegar={navegar}
                    />
                  </div>
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
              onNavegar={navegar}
            />
            {nav.currentPath ? (
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
              />
            ) : drives && drives.length > 0 ? (
              // #855: "Este computador" selecionado (sentinel de caminho vazio)
              // e drives carregados → grade de cards de drives no lugar da lista.
              <DrivesView drives={drives} onNavegar={navegar} />
            ) : (
              // Sem pasta selecionada ainda (antes de os drives caírem no 1º).
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

      {/* #724: painel flutuante de progresso (canto inferior direito) + diálogo
          de conflito controlado pelo shell. */}
      <ProgressoPanel ops={ops} onCancelar={cancelarTransferencia} />
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
