import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/animate-ui/primitives/radix/collapsible";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/animate-ui/components/radix/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClienteMark, TenantLogo } from "@/components/brand";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AppUser } from "@/lib/types";
import { crOrgBranding } from "@/lib/api";
import { NAV, type Tela } from "@/lib/navegacao";
import { useIdioma } from "@/lib/idioma";
import {
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  LogOut,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";

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
  const { state } = useSidebar();
  // Tooltip só faz sentido na sidebar colapsada (icon-only) e fora do mobile —
  // mesma regra do SidebarMenuButton dos itens de navegação (#98).
  const colapsada = state === "collapsed" && !isMobile;

  // #541: logo do tenant (Entra branding), theme-aware. Busca uma vez (memoizado
  // no api.ts); sem branding/sem permissão → null → cai no ClienteMark estático.
  const [branding, setBranding] = useState<{
    claro: string;
    escuro: string;
  } | null>(null);
  useEffect(() => {
    let vivo = true;
    crOrgBranding()
      .then((b) => {
        const claro = b.squareLogo ?? b.squareLogoDark;
        const escuro = b.squareLogoDark ?? b.squareLogo;
        if (vivo && claro && escuro) setBranding({ claro, escuro });
      })
      .catch(() => {
        /* degrada pro fallback */
      });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <Sidebar collapsible="icon">
      {/* Organizacao do cliente */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={user.organizacao ?? t.nav.organizacao}
            >
              {/* #541: com branding do tenant, o logo aparece LIMPO — sem box,
                  sem contorno, sem círculo (requisito do PO). Sem branding, cai
                  no ClienteMark estático dentro do box de sempre. */}
              {branding ? (
                <TenantLogo
                  claro={branding.claro}
                  escuro={branding.escuro}
                  className="size-8 shrink-0"
                />
              ) : (
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <ClienteMark className="size-4" />
                </div>
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {user.organizacao ?? t.nav.organizacao}
                </span>
                <span className="truncate text-xs">{t.nav.microsoft365}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((grupo) => (
          <SidebarGroup key={grupo.titulo}>
            <SidebarGroupLabel>{t.nav[grupo.titulo]}</SidebarGroupLabel>
            <SidebarMenu>
              {grupo.itens.map((item) =>
                colapsada ? (
                  // #359: em icon-mode o submenu inline (`SidebarMenuSub`) é
                  // escondido por CSS (`group-data-[collapsible=icon]:hidden`),
                  // então clicar o ícone-pai não mostrava nada. Abrimos as opções
                  // num flyout à direita (DropdownMenu, como o menu do usuário).
                  <SidebarMenuItem key={item.titulo}>
                    <DropdownMenu
                      // Sobre a webview do Navigator (que pinta acima do DOM), a
                      // webview cede (esconder+snapshot) enquanto o flyout está
                      // aberto — gatilho TRANSIENTE, reusa o do #358. Fora do
                      // Navigator não faz nada.
                      onOpenChange={(aberto) =>
                        window.dispatchEvent(
                          new CustomEvent("galaxie:webview-ceder", {
                            detail: aberto,
                          }),
                        )
                      }
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuButton
                              isActive={item.filhos.some((f) => f.id === tela)}
                              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                            >
                              <item.icone className="size-5!" />
                              <span>{t.nav[item.titulo]}</span>
                            </SidebarMenuButton>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right" align="center">
                          {t.nav[item.titulo]}
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        sideOffset={4}
                        className="min-w-48"
                      >
                        <DropdownMenuLabel>
                          {t.nav[item.titulo]}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {item.filhos.map((filho) => (
                          <DropdownMenuItem
                            key={filho.id}
                            onClick={() => onNavegar(filho.id)}
                            className={
                              tela === filho.id
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : undefined
                            }
                          >
                            {filho.icone && (
                              <filho.icone className="size-5!" />
                            )}
                            <span>{t.nav[filho.titulo]}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ) : (
                  <Collapsible
                    key={item.titulo}
                    asChild
                    defaultOpen={item.filhos.some((f) => f.id === tela)}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={t.nav[item.titulo]}>
                          <item.icone className="size-5!" />
                          <span>{t.nav[item.titulo]}</span>
                          <ChevronRight className="ml-auto transition-transform duration-300 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.filhos.map((filho) => (
                            <SidebarMenuSubItem key={filho.id}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={tela === filho.id}
                              >
                                <a
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    onNavegar(filho.id);
                                  }}
                                >
                                  {filho.icone && (
                                    <filho.icone className="size-5!" />
                                  )}
                                  <span>{t.nav[filho.titulo]}</span>
                                </a>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ),
              )}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Usuario */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu
              // #358: este menu abre à direita, SOBRE a área da webview do
              // Navigator (que pinta acima do DOM). Avisa o Navigator pra a
              // webview ceder (esconder+snapshot) enquanto o menu está aberto —
              // fora do Navigator não faz nada.
              onOpenChange={(aberto) =>
                window.dispatchEvent(
                  new CustomEvent("galaxie:webview-ceder", { detail: aberto }),
                )
              }
            >
              {/* Tooltip > DropdownMenu: os dois gatilhos com asChild no mesmo
                  botão. Só aparece na sidebar colapsada, onde sobra só o avatar. */}
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
                {colapsada && (
                  <TooltipContent side="right" align="center">
                    {user.displayName}
                  </TooltipContent>
                )}
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

      {/* Rail é a faixa de redimensionar (tabIndex=-1, não focável): seu
          "tooltip" é o title nativo. Localizamos aqui — aria-label + title
          sobrepõem o "Toggle Sidebar" fixo em inglês do primitivo (#160). */}
      <SidebarRail
        aria-label={t.nav.alternarMenu}
        title={t.nav.alternarMenu}
      />
    </Sidebar>
  );
}
