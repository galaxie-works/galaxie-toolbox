import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
} from "@/components/animate-ui/components/radix/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AppIcon } from "@/components/app-icon";
import { useIdioma } from "@/lib/idioma";
import { useAppStore } from "@/store";
import { resolverPinados } from "@/lib/pinned-apps";
import { APPS_CATALOGO } from "@/lib/apps-catalog";
import { useMemo } from "react";
import { PinOff } from "lucide-react";

/**
 * #718 (SH0 · épico #717 GALAXIE Shell) + #1109: o sidebar é um RAIL só de apps
 * FIXADOS. Os itens fixos (Navigator · Bridge · Files · Remote) SAÍRAM do rail —
 * já vivem no command em "From GALAXIE" (#877) e como abas — e a marca GALAXIE
 * migrou pra title bar (#1109, canto esquerdo, clique = nova aba do Navigator).
 * O `SidebarProvider` fica controlado colapsado (`open={false}`) no App.
 *
 * ⚠️ P0 (webview #650/#358): NÃO amarrar esconder a webview do Navigator ao
 * estado PERSISTENTE do rail. Montar/desmontar o rail por PIN (abaixo) é gate de
 * pin, não de webview — o esconder da webview segue só TRANSIENTE (menu de
 * contexto de app fixado). Esse esconder-transiente é do #1163 D2: o próprio
 * `ContextMenu` se registra na conta de overlays do store.
 */
/**
 * #721 (SH3): seção de apps FIXADOS do rail. Lê os ids do store, resolve contra
 * o catálogo (#720) — ids órfãos (app sumiu do catálogo) somem — e renderiza cada
 * um como um botão ícone-only que abre a aba no Navigator. Desafixar via menu de
 * contexto.
 */
function PinnedApps({
  onAbrirApp,
}: {
  onAbrirApp: (url: string, nome: string) => void;
}) {
  const { t } = useIdioma();
  const appsFixados = useAppStore((s) => s.appsFixados);
  const desafixarApp = useAppStore((s) => s.desafixarApp);
  const fixados = useMemo(
    () => resolverPinados(appsFixados, APPS_CATALOGO),
    [appsFixados],
  );
  if (fixados.length === 0) return null;
  return (
    <SidebarGroup className="items-center gap-1 px-1.5 py-1">
      {/* #358 → #1163 D2: o menu abre à direita, sobre a webview do Navigator. O
          ContextMenu (primitivo de `@/components/ui`) já cede a webview sozinho
          (se registra no store) — o window-event manual virou redundante. */}
      {fixados.map((app) => (
        <ContextMenu key={app.id}>
          <Tooltip>
            <ContextMenuTrigger asChild>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={app.name}
                  onClick={() => onAbrirApp(app.url, app.name)}
                  className="grid aspect-square w-full place-items-center rounded-xl text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
                >
                  <AppIcon id={app.id} name={app.name} className="size-6" />
                </button>
              </TooltipTrigger>
            </ContextMenuTrigger>
            <TooltipContent side="right" align="center">
              {app.name}
            </TooltipContent>
          </Tooltip>
          <ContextMenuContent>
            <ContextMenuItem
              className="gap-2"
              onClick={() => desafixarApp(app.id)}
            >
              <PinOff className="size-4" />
              {t.command.desafixar}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </SidebarGroup>
  );
}

export function AppSidebar({
  onAbrirApp,
}: {
  /** #721: abre um app FIXADO como aba do Navigator (mesma ponte da omnibox). */
  onAbrirApp: (url: string, nome: string) => void;
}) {
  const appsFixados = useAppStore((s) => s.appsFixados);
  const fixados = useMemo(
    () => resolverPinados(appsFixados, APPS_CATALOGO),
    [appsFixados],
  );

  // #1109 (AC do Wagner na #876): visibilidade do rail dirigida por PIN. Sem app
  // fixado o rail NÃO renderiza — o conteúdo (SidebarInset, `w-full flex-1`)
  // ocupa a largura cheia, sem faixa vazia nem gutter. O componente "some mas não
  // morre": AppSidebar segue montado e reativo ao store, então fixar um app pelo
  // command re-monta o rail na hora (sem recarregar) e desafixar o último some com
  // ele. O estado (`appsFixados`) persiste no store, não no DOM do rail.
  if (fixados.length === 0) return null;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {/* #721 (SH3): apps FIXADOS pelo command — ícone-only, abrem como aba do
            Navigator; menu de contexto pra desafixar. */}
        <PinnedApps onAbrirApp={onAbrirApp} />
      </SidebarContent>
      {/* #876: o avatar/menu do usuário vive na title bar (ver `MenuUsuario`).
          #1109: a marca GALAXIE também migrou pra title bar (ver `App.tsx`). */}
    </Sidebar>
  );
}
