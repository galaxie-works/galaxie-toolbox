import { type ReactNode } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GalaxieLogo } from "@/components/ui/icons/marca/galaxie-logo";
import { NavigatorIcon, BridgeIcon } from "@/components/ui/icons/marca-anim";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AppUser } from "@/lib/types";
import { type Tela } from "@/lib/navegacao";
import { useIdioma } from "@/lib/idioma";
import {
  ChevronsUpDown,
  ExternalLink,
  FolderTree,
  LogOut,
  MonitorSmartphone,
  Settings,
} from "lucide-react";

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
export function AppSidebar({
  user,
  tela,
  onNavegar,
  onLogout,
  onAbrirUrl,
}: {
  user: AppUser;
  tela: Tela;
  onNavegar: (t: Tela) => void;
  onLogout: () => void;
  onAbrirUrl: (url: string) => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useIdioma();

  // Itens fixos do rail. O roteamento como aba do Navigator é o SH1; aqui cada
  // item existe e dispara a navegação pra sua Tela.
  const itens: { id: Tela; label: string; icone: ReactNode }[] = [
    { id: "navegador", label: t.sidebar.navigator, icone: <NavigatorIcon className="size-5!" /> },
    { id: "control-room", label: t.sidebar.bridge, icone: <BridgeIcon className="size-5!" /> },
    { id: "arquivos", label: t.sidebar.files, icone: <FolderTree className="size-5!" /> },
    { id: "remote", label: t.sidebar.remote, icone: <MonitorSmartphone className="size-5!" /> },
  ];

  return (
    <Sidebar collapsible="icon">
      {/* Marca GALAXIE — substitui o logo/nome do tenant + "Microsoft 365". Clicar
          leva ao Navigator (home). */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  onClick={() => onNavegar("navegador")}
                  className="group-data-[collapsible=icon]:overflow-visible!"
                >
                  <GalaxieLogo className="size-8 shrink-0" />
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent side="right" align="center">
                GALAXIE
              </TooltipContent>
            </Tooltip>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {itens.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  tooltip={item.label}
                  isActive={tela === item.id}
                  onClick={() => onNavegar(item.id)}
                >
                  {item.icone}
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* #718: slot de apps PINADOS — populado no SH3. Reservado aqui pra o
            layout já contemplar (fixos em cima, pinados no meio, avatar embaixo). */}
        <SidebarGroup data-slot="pinned-apps" />
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
