// #733/#862: helper de tooltip do Explorer — Tooltip do app (padrão-ouro) +
// `<kbd>` do atalho lido do catálogo central (`atalhos.ts`) pelo id da ação.
// Extraído do `navbar.tsx` (#733) pra ser reusado pelas outras superfícies do
// Explorer (toolbar do content-pane, painel de progresso) — #862. Sem `atalhoId`
// = tooltip só com o rótulo (ação sem atalho).
import type { ReactNode } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { atalhoPorId } from "./atalhos";

export function TooltipAcao({
  label,
  atalhoId,
  children,
}: {
  label: string;
  atalhoId?: string;
  children: ReactNode;
}) {
  const combo = atalhoId ? atalhoPorId(atalhoId)?.combos[0] : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          {label}
          {combo && (
            <KbdGroup>
              {combo.map((tecla) => (
                <Kbd key={tecla}>{tecla}</Kbd>
              ))}
            </KbdGroup>
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
