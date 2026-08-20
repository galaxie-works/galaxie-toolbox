// #1290: os três ícones de chrome do Navigator (favoritos · histórico · paleta)
// que moram na TITLE BAR.
//
// Eles nasceram dentro do `navegador.tsx`, no mesmo portal da barra de abas — o
// que os punha à ESQUERDA das abas e, no DOM, ANTES do cluster do `App.tsx`.
// Resultado: o sino (que é global e vive no `App.tsx`) caía depois deles. O PO
// pediu a ordem `sino · favoritos · histórico · paleta · tema · avatar`, então
// quem manda na ordem passou a ser o `App.tsx`, e estes três viajam pra um slot
// que ele oferece. Extraídos daqui pra que a ordem entre eles seja testável sem
// montar o Navigator inteiro (30 props e webviews nativas).
import { Bookmark, Command as CommandIcon, History } from "lucide-react";

import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";

const BOTAO =
  "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";

export function ChromeNavegador({
  mostrarBarraFav,
  onAlternarBarraFav,
  historicoAberto,
  onAlternarHistorico,
  onAbrirPaleta,
}: {
  mostrarBarraFav: boolean;
  onAlternarBarraFav: () => void;
  historicoAberto: boolean;
  onAlternarHistorico: () => void;
  onAbrirPaleta: () => void;
}) {
  const { t } = useIdioma();
  return (
    <>
      {/* #856: ícone dedicado que liga/desliga a barra de favoritos (padrão de
          browser · Ctrl/Cmd+Shift+B). Ativo = barra visível (bg-accent). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t.navegador.barraFavoritosToggle}
            aria-pressed={mostrarBarraFav}
            onClick={onAlternarBarraFav}
            className={cn(BOTAO, mostrarBarraFav && "bg-accent text-foreground")}
          >
            <Bookmark className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <ShortcutTooltip
            label={t.navegador.barraFavoritosToggle}
            shortcut={{ key: "B", primary: true, shift: true }}
          />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t.navegador.historicoTitulo}
            aria-pressed={historicoAberto}
            onClick={onAlternarHistorico}
            className={cn(BOTAO, historicoAberto && "bg-accent text-foreground")}
          >
            <History className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t.navegador.historicoTitulo}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t.navegador.paleta}
            onClick={onAbrirPaleta}
            className={BOTAO}
          >
            <CommandIcon className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <ShortcutTooltip
            label={t.navegador.paleta}
            shortcut={{ key: "K", primary: true }}
          />
        </TooltipContent>
      </Tooltip>
    </>
  );
}
