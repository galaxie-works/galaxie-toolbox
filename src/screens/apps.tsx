import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { SidebarNavItem } from "@/components/sidebar-nav-item";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  type AppM365,
} from "@/lib/apps";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import {
  ExternalLink,
  MoreHorizontal,
  SquareArrowOutUpRight,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";

/**
 * Descrição do app em NO MÁXIMO 1 linha (#620 polish): trunca com reticências e,
 * só quando o texto não cabe, mostra o resumo completo num tooltip no hover. O
 * `ResizeObserver` re-mede quando o card muda de largura (grid responsivo). O
 * span fica SEMPRE dentro do `TooltipTrigger` (não remonta ao alternar), então o
 * observer permanece ligado ao nó atual.
 */
function DescricaoApp({ texto }: { texto: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncado, setTruncado] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setTruncado(el.scrollWidth > el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [texto]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          className="mt-0.5 block truncate text-xs text-muted-foreground"
        >
          {texto}
        </span>
      </TooltipTrigger>
      {truncado && <TooltipContent>{texto}</TooltipContent>}
    </Tooltip>
  );
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
          {!compacto && <DescricaoApp texto={app.resumo[idioma]} />}
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
          itens={itens}
          labelExplorar={t.apps.explorar}
          selecionado={selecionado}
          onSelecionar={setSelecionado}
        />

        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
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
          </Frame>
        </div>
      </div>
    </div>
  );
}

/**
 * #620 (rework): sidebar da tela Apps — COPIA o sidebar de pastas do Bridge
 * (padrão-ouro do PO), trocando só os itens. Container = as MESMAS classes do
 * `<aside>` do control-room (card `rounded-xl border bg-card p-3`, `gap-3`,
 * `w-64`, altura toda no desktop) com a lista num `ScrollArea flex-1` e o rótulo
 * de seção no mesmo tratamento do "Mail"/"Folders". Itens = `SidebarNavItem`
 * (markup verbatim do `Linha` do Bridge). Ícones renderizados como no Bridge
 * (`IconeItemAnim`: lucide-animated 16px, muted, currentColor). Grupo único
 * "Explore by category" com o Recommended como primeiro item (pedido do PO).
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
    <SidebarNavItem
      // O próprio `it.Icon` (IconeItemAnim) já sai 16px/muted como o do Bridge —
      // sem className de tamanho aqui, senão fugiria do padrão-ouro.
      icone={<it.Icon />}
      label={it.label}
      ativo={selecionado === it.id}
      onClick={() => onSelecionar(it.id)}
    />
  );
}

function AppsNavigation({
  itens,
  labelExplorar,
  selecionado,
  onSelecionar,
}: {
  itens: ItemNav[];
  labelExplorar: string;
  selecionado: string;
  onSelecionar: (id: string) => void;
}) {
  return (
    // Container idêntico ao `<aside>` do sidebar do Bridge (control-room.tsx):
    // card, `gap-3`, `w-64` no desktop (`md:h-full` ocupa a altura toda) e
    // `w-full` empilhado no mobile. A lista vive num `ScrollArea flex-1` com o
    // wrapper `pr-2` — mesma estrutura do container de pastas.
    <aside className="flex w-full shrink-0 flex-col gap-3 rounded-xl border bg-card p-3 md:h-full md:w-64">
      <ScrollArea className="min-h-0 w-full flex-1">
        <div className="pr-2">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
            {labelExplorar}
          </p>
          <div className="flex flex-col gap-0.5">
            {itens.map((it) => (
              <ItemSidebar
                key={it.id}
                it={it}
                selecionado={selecionado}
                onSelecionar={onSelecionar}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
