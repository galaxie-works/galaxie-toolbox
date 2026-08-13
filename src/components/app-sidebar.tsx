import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GalaxieLogo } from "@/components/ui/icons/marca/galaxie-logo";
import { IconeAnim, type AnimIcon } from "@/components/ui/icons/marca-anim";
import { ShipIcon } from "@/components/ui/ship";
import { ShipWheelIcon } from "@/components/ui/ship-wheel";
import { FoldersIcon } from "@/components/ui/folders";
import { AirplayIcon } from "@/components/ui/airplay";
import { AppIcon } from "@/components/app-icon";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AppUser } from "@/lib/types";
import { type Tela } from "@/lib/navegacao";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import { resolverPinados } from "@/lib/pinned-apps";
import { APPS_CATALOGO } from "@/lib/apps-catalog";
import { useMemo } from "react";
import { ChevronsUpDown, ExternalLink, LogOut, PinOff, Settings } from "lucide-react";

/**
 * #718 (SH0 · épico #717 GALAXIE Shell): o sidebar virou um RAIL fixo da marca
 * GALAXIE — logo no topo, itens fixos (Navigator · Bridge · Files · Remote),
 * slot de pinados (SH3) e o avatar no rodapé. Sem seções M365 e sem toggle de
 * abrir: o `SidebarProvider` fica controlado colapsado (`open={false}`) no App.
 *
 * ⚠️ P0 (webview): NÃO amarrar esconder a webview do Navigator ao estado
 * PERSISTENTE `collapsed` (ver #650). O esconder segue só TRANSIENTE (flyout/menu
 * → `galaxie:webview-ceder`); os itens do rail são navegação direta com tooltip
 * simples (mesmo padrão dos itens-folha atuais).
 */
/**
 * #721 (SH3): seção de apps FIXADOS do rail. Lê os ids do store, resolve contra
 * o catálogo (#720) — ids órfãos (app sumiu do catálogo) somem — e renderiza cada
 * um como um botão ícone-only que abre a aba no Navigator. Desafixar via menu de
 * contexto. Vazio = não renderiza (o rail fica só com fixos + avatar).
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
    <SidebarGroup className="mt-1 items-center gap-1 border-t border-sidebar-border/50 px-1.5 pt-2">
      {fixados.map((app) => (
        <ContextMenu
          key={app.id}
          // #358: o menu abre à direita, sobre a webview do Navigator — avisa pra
          // ela ceder enquanto aberto (TRANSIENTE; fora do Navigator é no-op).
          onOpenChange={(aberto) =>
            window.dispatchEvent(
              new CustomEvent("galaxie:webview-ceder", { detail: aberto }),
            )
          }
        >
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
  user,
  tela,
  onNavegar,
  onLogout,
  onAbrirUrl,
  onAbrirApp,
}: {
  user: AppUser;
  tela: Tela;
  onNavegar: (t: Tela) => void;
  onLogout: () => void;
  onAbrirUrl: (url: string) => void;
  /** #721: abre um app FIXADO como aba do Navigator (mesma ponte da omnibox). */
  onAbrirApp: (url: string, nome: string) => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useIdioma();

  // Itens fixos do rail. Ícones lucide-animated (24px), animam no hover da linha
  // (IconeAnim acha o <button> ancestral). O roteamento como aba do Navigator é
  // o SH1; aqui cada item dispara a navegação pra sua Tela.
  const itens: { id: Tela; label: string; Comp: AnimIcon }[] = [
    { id: "navegador", label: t.sidebar.navigator, Comp: ShipIcon as unknown as AnimIcon },
    { id: "control-room", label: t.sidebar.bridge, Comp: ShipWheelIcon as unknown as AnimIcon },
    { id: "arquivos", label: t.sidebar.files, Comp: FoldersIcon as unknown as AnimIcon },
    { id: "remote", label: t.sidebar.remote, Comp: AirplayIcon as unknown as AnimIcon },
  ];

  return (
    <Sidebar collapsible="icon">
      {/* #718 (fix visual): a marca GALAXIE OCUPA a largura do rail (só o padding
          do header a limita) — não mais um logo minúsculo. Clicar leva ao Navigator. */}
      <SidebarHeader className="items-center px-1 pt-1.5 pb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="GALAXIE"
              onClick={() => onNavegar("navegador")}
              className="grid w-full place-items-center rounded-xl transition-colors hover:bg-sidebar-accent"
            >
              <GalaxieLogo className="w-full" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            GALAXIE
          </TooltipContent>
        </Tooltip>
      </SidebarHeader>

      <SidebarContent>
        {/* #718 (fix visual): itens icon-only 24×24 CENTRALIZADOS (sem o texto que
            cortava). Botão quadrado que preenche a largura do rail; ícone animado. */}
        <SidebarGroup className="items-center gap-1 px-1.5 py-1">
          {itens.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={tela === item.id ? "page" : undefined}
                  onClick={() => onNavegar(item.id)}
                  className={cn(
                    "grid aspect-square w-full place-items-center rounded-xl transition-colors",
                    tela === item.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                  )}
                >
                  <IconeAnim Comp={item.Comp} size={24} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" align="center">
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </SidebarGroup>

        {/* #721 (SH3): apps FIXADOS pelo command — ícone-only, abrem como aba do
            Navigator; menu de contexto pra desafixar. Vazio → não renderiza nada. */}
        <PinnedApps onAbrirApp={onAbrirApp} />
      </SidebarContent>

      {/* Usuário */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu
              // #358: o menu abre à direita, SOBRE a área da webview do Navigator
              // (que pinta acima do DOM). Avisa o Navigator pra a webview ceder
              // (esconder+snapshot) enquanto o menu está aberto — TRANSIENTE. Fora
              // do Navigator não faz nada.
              onOpenChange={(aberto) =>
                window.dispatchEvent(
                  new CustomEvent("galaxie:webview-ceder", { detail: aberto }),
                )
              }
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    >
                      <Avatar className="h-8 w-8 rounded-full">
                        {user.photo && (
                          <AvatarImage src={user.photo} alt={user.displayName} />
                        )}
                        <AvatarFallback className="rounded-full">
                          {user.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-semibold">
                          {user.displayName}
                        </span>
                        <span className="truncate text-xs">{user.email}</span>
                      </div>
                      <ChevronsUpDown className="ml-auto size-4" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" align="center">
                  {user.displayName}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-full">
                      {user.photo && (
                        <AvatarImage src={user.photo} alt={user.displayName} />
                      )}
                      <AvatarFallback className="rounded-full">
                        {user.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {user.displayName}
                      </span>
                      <span className="truncate text-xs">{user.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => onAbrirUrl("https://www.microsoft365.com")}
                  >
                    <ExternalLink />
                    {t.nav.irPara365}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      onAbrirUrl("https://www.office.com/launch/sharepoint")
                    }
                  >
                    <ExternalLink />
                    {t.nav.sharepoint}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onNavegar("configuracoes")}>
                    <Settings />
                    {t.nav.configuracoes}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>
                  <LogOut />
                  {t.nav.sair}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
