import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Item de navegação de sidebar — o MESMO visual do sidebar de pastas do Bridge
 * (padrão-ouro do PO, #620). Markup extraído VERBATIM do `Linha` de
 * `control-room.tsx` (o botão expandido): tipografia `text-sm`, item ativo em
 * pílula `bg-secondary`, espaçamento `gap-2.5 px-2.5 py-2 rounded-md`. O ícone é
 * responsabilidade do chamador (renderiza o node já dimensionado/colorido —
 * `size-4 shrink-0 text-muted-foreground` pra casar com o Bridge), pra este
 * componente servir tanto os ícones lucide crus (Bridge, prop `size`) quanto os
 * animados por className (Apps). Nada de card em volta — o Bridge é flat.
 */
export function SidebarNavItem({
  icone,
  label,
  ativo,
  onClick,
  contagem,
  className,
}: {
  /** Ícone já renderizado (ex.: `<Icon className="size-4 shrink-0 text-muted-foreground" />`). */
  icone: ReactNode;
  label: string;
  ativo: boolean;
  onClick: () => void;
  /** Contador à direita (não-lidos/total), como as pastas do Bridge. Omitido = sem badge. */
  contagem?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        ativo
          ? "bg-secondary font-medium text-secondary-foreground"
          : "hover:bg-accent/50",
        className,
      )}
    >
      {icone}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {contagem !== undefined && contagem > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">{contagem}</span>
      )}
    </button>
  );
}
