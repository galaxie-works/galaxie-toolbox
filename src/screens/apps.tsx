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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  urlIconePorChave,
  type AppM365,
} from "@/lib/apps";
import { crTenantApps, type TenantApp, type TenantAppsResult } from "@/lib/api";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import {
  ExternalLink,
  Info,
  LayoutGrid,
  MoreHorizontal,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useEffect, useState } from "react";

/** #207: chave do ícone local por nome de app do catálogo — pra reaproveitar o
 *  ícone oficial nos apps do tenant que casam por nome; o resto usa genérico. */
const CHAVE_ICONE_POR_NOME = new Map(
  APPS.map((a) => [a.nome.trim().toLocaleLowerCase(), a.icone])
);

function chaveIconeTenant(nome: string): string | undefined {
  return CHAVE_ICONE_POR_NOME.get(nome.trim().toLocaleLowerCase());
}

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
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent>{t.apps.maisOpcoes}</TooltipContent>
        </Tooltip>
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

/**
 * #207: card de app REAL do tenant (service principal). Abre no navegador
 * interno pela URL do app; ícone reaproveita o oficial do catálogo quando o nome
 * casa, senão um genérico. Read-only, sem o menu de "abrir aqui/navegador" (a
 * embutição de app arbitrário do tenant não é garantida — vai direto pro browser).
 */
function TenantAppCard({
  app,
  onAbrir,
}: {
  app: TenantApp;
  onAbrir: (a: TenantApp) => void;
}) {
  const chave = chaveIconeTenant(app.displayName);
  const icone = chave ? urlIconePorChave(chave) : undefined;
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors",
        "hover:border-primary/40 hover:bg-accent/40"
      )}
    >
      <button
        type="button"
        onClick={() => onAbrir(app)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        {icone ? (
          <img src={icone} alt="" draggable={false} className="size-8 shrink-0" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <LayoutGrid className="size-4" />
          </span>
        )}
        <span className="block min-w-0 flex-1 truncate text-sm font-medium">
          {app.displayName}
        </span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
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
  // #207: apps reais do tenant (aditivo). Falha/sem-permissão/vazio → seção
  // some e a tela cai no catálogo estático (fallback gracioso).
  const [tenant, setTenant] = useState<TenantAppsResult | null>(null);
  useEffect(() => {
    let vivo = true;
    crTenantApps()
      .then((r) => {
        if (vivo) setTenant(r);
      })
      .catch(() => {
        if (vivo) setTenant(null);
      });
    return () => {
      vivo = false;
    };
  }, []);
  const tenantApps = tenant?.status === "ok" ? tenant.apps : [];

  const maisUsados = MAIS_USADOS.map((id) => APPS.find((a) => a.id === id)).filter(
    (a): a is AppM365 => a != null
  );
  const daCategoria = porCategoria(categoria as (typeof CATEGORIAS)[number]);

  // Abre um app do tenant no navegador interno, reusando o handler existente.
  const abrirTenant = (a: TenantApp) =>
    onAbrirNavegador({
      id: a.appId || a.displayName,
      nome: a.displayName,
      url: a.url,
      icone: chaveIconeTenant(a.displayName) ?? "",
      resumo: { "pt-BR": "", en: "" },
      categorias: [],
    });

  return (
    <div className="w-full space-y-6">
      {tenantApps.length > 0 && (
        <Frame className="w-full">
          <FrameHeader>
            <FrameTitle>{t.apps.doSeuTenant}</FrameTitle>
          </FrameHeader>
          <FramePanel>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tenantApps.map((a) => (
                <TenantAppCard
                  key={a.appId || a.displayName}
                  app={a}
                  onAbrir={abrirTenant}
                />
              ))}
            </div>
          </FramePanel>
        </Frame>
      )}

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
