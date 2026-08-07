import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/animate-ui/components/radix/sidebar";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import {
  AppsIcon,
  RecommendedIcon,
  ProdutividadeIcon,
  UtilitariosIcon,
  EducacaoIcon,
  ComunicacaoIcon,
  ConteudoIcon,
  ProjetosIcon,
  ExperienciaIcon,
  DesenvolvimentoIcon,
} from "@/components/ui/icons/apps-anim";
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
  RECOMENDADOS,
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
import { useEffect, useState, type ComponentType } from "react";

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
  // #620: item selecionado no sidebar — "recomendados" (default) ou uma das 8
  // categorias. Substitui as abas horizontais do "Explorar".
  const [selecionado, setSelecionado] = useState<string>("recomendados");
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

  // #621: item Recommended = pacote Office + OneDrive (RECOMENDADOS, confirmado
  // pelo PO), puxado do catálogo APPS por id. Substitui o MAIS_USADOS do S1.
  const recomendados = RECOMENDADOS.map((id) =>
    APPS.find((a) => a.id === id)
  ).filter((a): a is AppM365 => a != null);

  // #620: os 9 itens do sidebar — Recommended + as 8 categorias (mapa do épico
  // #619), cada um com o seu ícone animado (anima no hover da linha).
  const itens: {
    id: string;
    label: string;
    Icon: ComponentType<{ className?: string }>;
  }[] = [
    { id: "recomendados", label: t.apps.recomendados, Icon: RecommendedIcon },
    { id: "produtividade", label: t.apps.produtividade, Icon: ProdutividadeIcon },
    { id: "utilitarios", label: t.apps.utilitarios, Icon: UtilitariosIcon },
    { id: "educacao", label: t.apps.educacao, Icon: EducacaoIcon },
    { id: "comunicacao", label: t.apps.comunicacao, Icon: ComunicacaoIcon },
    { id: "conteudo", label: t.apps.conteudo, Icon: ConteudoIcon },
    { id: "projetos", label: t.apps.projetos, Icon: ProjetosIcon },
    { id: "experiencia", label: t.apps.experiencia, Icon: ExperienciaIcon },
    {
      id: "desenvolvimento",
      label: t.apps.desenvolvimento,
      Icon: DesenvolvimentoIcon,
    },
  ];
  const tituloConteudo =
    itens.find((i) => i.id === selecionado)?.label ?? t.apps.recomendados;
  // Conteúdo do item: Recommended → pacote Office+OneDrive (#621); categoria →
  // porCategoria (#622 refina).
  const appsConteudo =
    selecionado === "recomendados"
      ? recomendados
      : porCategoria(selecionado as (typeof CATEGORIAS)[number]);

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
    <div className="flex h-full flex-col gap-4">
      {/* Hero — mesmo padrão do Bridge/Settings: ícone + título animado + descrição. */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <AppsIcon className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <SoftBlurIn delay={80} stagger={16}>
              {t.apps.heroTitulo}
            </SoftBlurIn>
          </h1>
          <p className="text-sm text-muted-foreground">{t.apps.heroSubtitulo}</p>
        </div>
      </div>

      {/* Layout sidebar-esquerda + conteúdo — reusa os primitivos reui do
          SettingsNavigation/app-sidebar (roda no SidebarProvider do App). */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <AppsNavigation
          recomendado={itens[0]}
          categorias={itens.slice(1)}
          labelCategorias={t.apps.explorar}
          selecionado={selecionado}
          onSelecionar={setSelecionado}
        />

        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
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
            <FrameHeader>
              <FrameTitle>{tituloConteudo}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {appsConteudo.map((a) => (
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
      </div>
    </div>
  );
}

/**
 * #620: sidebar da tela Apps — reusa os primitivos reui (`Sidebar
 * collapsible="none"` / `SidebarMenuButton` etc.) exatamente como o
 * `SettingsNavigation` (configuracoes.tsx) e o `app-sidebar.tsx`. Roda dentro do
 * `SidebarProvider` do App (o mesmo que serve o AppSidebar). Itens flat (sem
 * subitens) — cada um seleciona uma categoria/Recommended; ícone anima no hover.
 */
type ItemNav = {
  id: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
};

function ItemSidebar({
  it,
  selecionado,
  onSelecionar,
}: {
  it: ItemNav;
  selecionado: string;
  onSelecionar: (id: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={selecionado === it.id}
        onClick={() => onSelecionar(it.id)}
      >
        <it.Icon />
        <span>{it.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppsNavigation({
  recomendado,
  categorias,
  labelCategorias,
  selecionado,
  onSelecionar,
}: {
  recomendado: ItemNav;
  categorias: ItemNav[];
  labelCategorias: string;
  selecionado: string;
  onSelecionar: (id: string) => void;
}) {
  return (
    <aside className="w-full shrink-0 rounded-xl border bg-card md:h-full md:w-64">
      <Sidebar
        collapsible="none"
        className="h-full w-full bg-transparent text-foreground"
      >
        <SidebarContent>
          {/* Recommended sozinho no topo. */}
          <SidebarGroup>
            <SidebarMenu>
              <ItemSidebar
                it={recomendado}
                selecionado={selecionado}
                onSelecionar={onSelecionar}
              />
            </SidebarMenu>
          </SidebarGroup>

          {/* #622: grupo "Explore by category" com as 8 categorias. */}
          <SidebarGroup>
            <SidebarGroupLabel>{labelCategorias}</SidebarGroupLabel>
            <SidebarMenu>
              {categorias.map((it) => (
                <ItemSidebar
                  key={it.id}
                  it={it}
                  selecionado={selecionado}
                  onSelecionar={onSelecionar}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </aside>
  );
}
