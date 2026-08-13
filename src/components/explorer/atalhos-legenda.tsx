import { Keyboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIdioma } from "@/lib/idioma";

import {
  ORDEM_CATEGORIAS_ATALHO,
  atalhosDe,
  type CategoriaAtalho,
} from "./atalhos";

/**
 * #733: legenda/cheatsheet dos atalhos do Explorer — lê do catálogo central
 * (`atalhos.ts`, fonte única). Componente separado (raia Sirius), não toca o
 * content-pane. Abre num Dialog pelo botão de teclado na navbar.
 */

/** i18n key da categoria (em `t.atalhos`). */
const CHAVE_CAT: Record<CategoriaAtalho, "catNavegacao" | "catSelecao" | "catOperacoes" | "catVisualizacao"> = {
  navegacao: "catNavegacao",
  selecao: "catSelecao",
  operacoes: "catOperacoes",
  visualizacao: "catVisualizacao",
};

export function AtalhosLegenda() {
  const { t } = useIdioma();
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label={t.atalhos.titulo}
            >
              <Keyboard className="size-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t.atalhos.titulo}</TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.atalhos.titulo}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.atalhos.titulo}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          {ORDEM_CATEGORIAS_ATALHO.map((cat) => (
            <section key={cat} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t.atalhos[CHAVE_CAT[cat]]}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {atalhosDe(cat).map((atalho) => (
                  <li
                    key={atalho.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {t.atalhos[atalho.rotulo]}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {atalho.combos.map((combo, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-xs text-muted-foreground">
                              /
                            </span>
                          )}
                          <KbdGroup>
                            {combo.map((tecla) => (
                              <Kbd key={tecla}>{tecla}</Kbd>
                            ))}
                          </KbdGroup>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
