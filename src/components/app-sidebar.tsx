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
} from "@/components/animate-ui/components/radix/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClienteMark } from "@/components/brand";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AppUser } from "@/lib/types";
import { NAV, type Tela } from "@/lib/navegacao";
import { useIdioma } from "@/lib/idioma";
import {
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  LogOut,
  Settings,
} from "lucide-react";

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

  return (
    <Sidebar collapsible="icon">
      {/* Organizacao do cliente */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ClienteMark className="size-4" />
              </div>
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
              {grupo.itens.map((item) => (
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
                                {filho.icone && <filho.icone className="size-5!" />}
                                <span>{t.nav[filho.titulo]}</span>
                              </a>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Usuario */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    {user.photo && (
                      <AvatarImage src={user.photo} alt={user.displayName} />
                    )}
                    <AvatarFallback className="rounded-lg">
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
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      {user.photo && (
                        <AvatarImage src={user.photo} alt={user.displayName} />
                      )}
                      <AvatarFallback className="rounded-lg">
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

      <SidebarRail />
    </Sidebar>
  );
}
