import { useEffect, useReducer, useState } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma } from "@/lib/idioma";
import { dirsConhecidos, listarDrives } from "@/lib/api";
import type { DriveInfo, FsEntry } from "@/lib/types";
import { LocaisSidebar } from "./locais";
import { ArvoreArquivos } from "./arvore";
import { NavBarArquivos } from "./navbar";
import { ContentPane } from "./content-pane";
import { InspectorPane } from "./inspector";
import { pathPai } from "./caminho";

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

/**
 * #677: casca do Explorer — layout em grid redimensionável [árvore | conteúdo]
 * (o inspector chega numa story posterior). Painel da árvore = card no estilo do
 * sidebar de Apps/Bridge (`rounded-xl border bg-card`), com os LOCAIS (drives +
 * acesso rápido) no topo e a árvore de pastas lazy abaixo. Painel de conteúdo =
 * NavBar (breadcrumb + endereço + back/forward/up) + um placeholder (a listagem
 * de arquivos é de outra story).
 */
export function ExplorerShell() {
  const { t } = useIdioma();
  const [nav, dispatch] = useReducer(navReducer, NAV_INICIAL);
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  const [acessoRapido, setAcessoRapido] = useState<FsEntry[] | null>(null);
  // #681: seleção liftada do ContentPane → alimenta o InspectorPane. Painel de
  // detalhes começa VISÍVEL (o usuário esconde pelo toggle da toolbar).
  const [selecionados, setSelecionados] = useState<FsEntry[]>([]);
  const [mostrarInspector, setMostrarInspector] = useState(true);

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

  const navegar = (path: string) => dispatch({ type: "navegar", path });

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
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
        <div className="flex h-full flex-col gap-3 rounded-xl border bg-card p-3">
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
              onSelecaoChange={setSelecionados}
              mostrarInspector={mostrarInspector}
              onToggleInspector={() => setMostrarInspector((v) => !v)}
            />
          ) : (
            // Sem pasta selecionada ainda (antes de os drives caírem no 1º).
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
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
  );
}
