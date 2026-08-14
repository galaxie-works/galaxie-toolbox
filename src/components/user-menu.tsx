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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AppUser } from "@/lib/types";
import { type Tela } from "@/lib/navegacao";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import { ChevronDown, ExternalLink, LogOut, Settings } from "lucide-react";

/**
 * #876 (title bar): menu do usuário extraído do rail (`app-sidebar.tsx`) pra um
 * componente único, agora ancorado no **avatar à direita da title bar**. O menu
 * é POPOVER (Radix, não sheet — padrão #874); abre pra baixo (a title bar está no
 * topo). Enquanto aberto, avisa a webview do Navigator pra ceder (`galaxie:
 * webview-ceder`, TRANSIENTE) — mesmo cuidado de z-order do rail (#358). O
 * conteúdo do menu (365/SharePoint/Settings/Sair) é o mesmo de antes.
 */
export function MenuUsuario({
  user,
  onNavegar,
  onLogout,
  onAbrirUrl,
}: {
  user: AppUser;
  onNavegar: (t: Tela) => void;
  onLogout: () => void;
  onAbrirUrl: (url: string) => void;
}) {
  const { t } = useIdioma();

  return (
    <DropdownMenu
      onOpenChange={(aberto) =>
        window.dispatchEvent(
          new CustomEvent("galaxie:webview-ceder", { detail: aberto }),
        )
      }
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={user.displayName}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1 rounded-md pr-1 pl-0.5 text-muted-foreground outline-none",
                "transition-colors hover:bg-accent hover:text-foreground",
                "focus-visible:ring-2 focus-visible:ring-ring",
                "data-[state=open]:bg-accent data-[state=open]:text-foreground",
              )}
            >
              <Avatar className="size-7 rounded-full">
                {user.photo && (
                  <AvatarImage src={user.photo} alt={user.displayName} />
                )}
                <AvatarFallback className="rounded-full text-xs">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{user.displayName}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="min-w-56 rounded-lg" align="end" sideOffset={6}>
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
              <span className="truncate font-semibold">{user.displayName}</span>
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
  );
}
