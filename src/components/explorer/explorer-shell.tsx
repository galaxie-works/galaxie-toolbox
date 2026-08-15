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
  abrirCaminhoFs,
  buscarArquivos,
  cancelarOp,
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
  onProgressoOp,
  pausarOp,
  resumirOp,
  type BuscaHandle,
} from "@/lib/api";
import type { CloudLocation, DriveInfo, FsConflict, FsEntry } from "@/lib/types";
import { DrivesView } from "./drives-view";
import { ArvoreArquivos } from "./arvore";
import { NavBarArquivos } from "./navbar";
import { ContentPane } from "./content-pane";
import { ResultadosBusca } from "./resultados-busca";
import { InspectorPane } from "./inspector";
import { type OpAtiva } from "./progresso-panel";
// #898 (fatia 1): o Status Center É a activity-dropdown — substitui o
// `ProgressoPanel`, alimentada pelo MESMO modelo `ops`.
import { ActivityDropdown } from "./activity-dropdown";
import { ConflitoDialog } from "./conflito-dialog";
import { calcVelocidade, planejarTransferencia, type ResolucaoConflito } from "./operacao";
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

  // #724: ops de copy/move ativas (rastreadas por opId) + diálogo de conflito +
  // nonce do watcher (bump → ContentPane recarrega a MESMA pasta).
  const [ops, setOps] = useState<OpAtiva[]>([]);
  const [conflito, setConflito] = useState<ConflitoPendente | null>(null);
  const [watcherNonce, setWatcherNonce] = useState(0);

  // Refs de bookkeeping das ops: último byte/tempo (velocidade), tipo por opId
  // (o payload de progresso não carrega copy/move), e dedupe do evento terminal.
  const ultimoRef = useRef<Map<number, { bytes: number; ms: number }>>(new Map());
  const tiposRef = useRef<Map<number, "copy" | "move">>(new Map());
  // #898 fatia 2: basename do destino por opId (o payload de progresso não o
  // carrega) → alimenta o resumo terminal ("→ Downloads") na activity-dropdown.
  const destinosRef = useRef<Map<number, string>>(new Map());
  const terminadosRef = useRef<Set<number>>(new Set());
  // t via ref → a assinatura de progresso é registrada UMA vez (sem re-subscribe
  // a cada troca de idioma), mas os toasts saem no idioma atual.
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
        // #875: RETÉM a op na fila marcada como terminal (não remove mais) — vira
        // card revisável no Status Center. Erro fica vermelho até dispensar; a
        // limpeza dos refs (tiposRef/terminadosRef) mora em dismissOp/clearCompleted.
        // Sem mais progresso → velocidade 0; só o ultimoRef (delta de bytes) sai.
        ultimoRef.current.delete(p.opId);
        setOps((prev) => {
          const tipo =
            tiposRef.current.get(p.opId) ??
            prev.find((o) => o.opId === p.opId)?.tipo ??
            "copy";
          const novo: OpAtiva = {
            opId: p.opId,
            tipo,
            progresso: p,
            velocidade: 0,
            destino: destinosRef.current.get(p.opId),
          };
          return prev.some((o) => o.opId === p.opId)
            ? prev.map((o) => (o.opId === p.opId ? novo : o))
            : [...prev, novo];
        });
        return;
      }

      setOps((prev) => {
        const tipo = tiposRef.current.get(p.opId) ?? "copy";
        const novo: OpAtiva = {
          opId: p.opId,
          tipo,
          progresso: p,
          velocidade,
          destino: destinosRef.current.get(p.opId),
        };
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
          tiposRef.current.set(opId, op === "copy" ? "copy" : "move");
          destinosRef.current.set(opId, nomeBase(destDir));
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
        destinosRef.current.set(opId, nomeBase(destDir));
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

  // #898 (fatia 1): pausa/retoma uma op de copy/move em curso. O backend trava/
  // continua os workers e o stream de progresso passa a reportar `status: "paused"`
  // (op fica ATIVA, progresso congelado — não é terminal, ver `onProgressoOp`).
  const pausarTransferencia = useCallback((opId: number) => {
    void pausarOp(opId).catch(() => {});
  }, []);
  const resumirTransferencia = useCallback((opId: number) => {
    void resumirOp(opId).catch(() => {});
  }, []);

  // #875/#898: dispensa UMA op terminal do Status Center (guard: nunca uma op
  // ATIVA — "inProgress" OU "paused" — essa é cancelável/retomável, não
  // dispensável). Limpa os refs de bookkeeping pra não vazar entre ops futuras.
  const dispensarOp = useCallback((opId: number) => {
    setOps((prev) => {
      const alvo = prev.find((o) => o.opId === opId);
      if (
        !alvo ||
        alvo.progresso.status === "inProgress" ||
        alvo.progresso.status === "paused"
      )
        return prev;
      return prev.filter((o) => o.opId !== opId);
    });
    ultimoRef.current.delete(opId);
    tiposRef.current.delete(opId);
    destinosRef.current.delete(opId);
    terminadosRef.current.delete(opId);
  }, []);

  // #875/#898: limpa TODAS as ops terminais (concluídas/erro/canceladas/parciais),
  // mantendo as ATIVAS (em curso OU pausadas). Limpa os refs das removidas.
  const ehAtiva = (status: string) =>
    status === "inProgress" || status === "paused";
  const limparConcluidas = useCallback(() => {
    setOps((prev) => {
      for (const o of prev) {
        if (!ehAtiva(o.progresso.status)) {
          ultimoRef.current.delete(o.opId);
          tiposRef.current.delete(o.opId);
          destinosRef.current.delete(o.opId);
          terminadosRef.current.delete(o.opId);
        }
      }
      return prev.filter((o) => ehAtiva(o.progresso.status));
    });
  }, []);

  // #898 (fatia 1): relógio (Date.now, tick de 30s) pros timestamps relativos da
  // activity-dropdown re-renderizarem.
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), 30_000);
    return () => clearInterval(id);
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
                {/* #869: árvore ÚNICA — Este computador → drives → pastas (lazy) e
                    Acesso rápido como raiz-irmã. Substitui o `LocaisSidebar` flat
                    + a seção "Pastas" separada. */}
                <div className="pr-2">
                  <ArvoreArquivos
                    drives={drives}
                    cloudLocations={cloudLocations}
                    acessoRapido={acessoRapidoMesclado}
                    pins={pins}
                    onAlternarFixar={alternarFixar}
                    currentPath={nav.currentPath}
                    onNavegar={navegar}
                  />
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

      {/* #898 (fatia 1): Status Center = activity-dropdown flutuante (canto inferior
          direito), alimentada pelo `ops`. Substitui o `ProgressoPanel`. Linhas
          ativas trazem Pausar/Retomar + Cancelar; terminais, Dispensar. */}
      <ActivityDropdown
        ops={ops}
        agoraMs={agoraMs}
        onCancelar={cancelarTransferencia}
        onPausar={pausarTransferencia}
        onResumir={resumirTransferencia}
        onDispensar={dispensarOp}
        onLimparConcluidas={limparConcluidas}
      />
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
