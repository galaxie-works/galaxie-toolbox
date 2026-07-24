import AnimatedTabs from "@/components/smoothui/animated-tabs";
import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import {
  APPS,
  CATEGORIAS,
  MAIS_USADOS,
  porCategoria,
  urlIcone,
  type AppM365,
} from "@/lib/apps";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import { ExternalLink, Info, MoreHorizontal, SquareArrowOutUpRight } from "lucide-react";
import { useState } from "react";

/**
 * Card de aplicativo. O corpo inteiro abre o app na janela interna; as
 * reticencias sao um botao separado, senao o menu abriria junto com o app.
 */
function AppCard({
  app,
  onAbrirAqui,
  onAbrirNavegador,
  compacto,
}: {
  app: AppM365;
  onAbrirAqui: (a: AppM365) => void;
  onAbrirNavegador: (a: AppM365) => void;
  compacto?: boolean;
}) {
  const { idioma, t } = useIdioma();

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors",
        "hover:border-primary/40 hover:bg-accent/40"
      )}
    >
      <button
        type="button"
        onClick={() => onAbrirAqui(app)}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left"
      >
        <img
          src={urlIcone(app)}
          alt=""
          draggable={false}
          className="size-8 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{app.nome}</span>
          {!compacto && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
              {app.resumo[idioma]}
            </span>
          )}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.apps.maisOpcoes}
            className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onAbrirAqui(app)}>
            <SquareArrowOutUpRight />
            {t.apps.abrirAqui}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAbrirNavegador(app)}>
            <ExternalLink />
            {t.apps.abrirNavegador}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AppsScreen({
  onAbrirAqui,
  onAbrirNavegador,
}: {
  onAbrirAqui: (a: AppM365) => void;
  onAbrirNavegador: (a: AppM365) => void;
}) {
  const { t } = useIdioma();
  const [categoria, setCategoria] = useState<string>(CATEGORIAS[0]);

  const maisUsados = MAIS_USADOS.map((id) => APPS.find((a) => a.id === id)).filter(
    (a): a is AppM365 => a != null
  );
  const daCategoria = porCategoria(categoria as (typeof CATEGORIAS)[number]);

  return (
    <div className="w-full space-y-6">
      <Frame className="w-full">
        {/* Sem descricao aqui: o aviso de sessao aparece uma vez so, no rodape
            do bloco de baixo. Repetido nos dois, vira ruido. */}
        <FrameHeader>
          <FrameTitle>{t.apps.maisUsados}</FrameTitle>
        </FrameHeader>
        <FramePanel>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {maisUsados.map((a) => (
              <AppCard
                key={a.id}
                app={a}
                compacto
                onAbrirAqui={onAbrirAqui}
                onAbrirNavegador={onAbrirNavegador}
              />
            ))}
          </div>
        </FramePanel>
      </Frame>

      <Frame className="w-full">
        <FrameHeader>
          <FrameTitle>{t.apps.explorar}</FrameTitle>
        </FrameHeader>

        <FramePanel>
          {/* Rolagem horizontal: sao oito categorias e em janela estreita elas
              nao cabem numa linha so. */}
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <AnimatedTabs
              activeTab={categoria}
              className="[&>button]:whitespace-nowrap"
              layoutId="apps-categorias"
              onChange={setCategoria}
              tabs={CATEGORIAS.map((c) => ({ id: c, label: t.apps[c] }))}
              variant="segment"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {daCategoria.map((a) => (
              <AppCard
                key={a.id}
                app={a}
                onAbrirAqui={onAbrirAqui}
                onAbrirNavegador={onAbrirNavegador}
              />
            ))}
          </div>
        </FramePanel>

        <FrameFooter className="flex-row items-center gap-2">
          <Info className="size-4 shrink-0 text-blue-500 dark:text-blue-400" />
          <p className="text-muted-foreground text-sm">{t.apps.avisoSessao}</p>
        </FrameFooter>
      </Frame>
    </div>
  );
}
