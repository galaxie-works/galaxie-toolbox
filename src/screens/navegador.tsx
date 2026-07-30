import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  APPS,
  CATEGORIAS,
  MAIS_USADOS,
  porCategoria,
  porId,
  urlIcone,
  type AppM365,
} from "@/lib/apps";
import * as browser from "@/lib/browser";
import {
  montarLanes,
  reordenarLane,
  loadNavigatorGroups,
  persistNavigatorGroups,
  loadNavigatorMembership,
  persistNavigatorMembership,
  podarMembership,
  NAVIGATOR_GROUP_COLORS,
  NAVIGATOR_GROUP_COLOR_ORDER,
  type AbaBrowser,
  type NavigatorGroup,
  type NavigatorGroupColor,
  type NavigatorMembership,
} from "@/lib/navigator-tabs";
import {
  BarraFavoritos,
  favoritosParaPalette,
} from "@/screens/navegador-favoritos";
import {
  loadFavoritos,
  persistFavoritos,
  type Favorito,
} from "@/lib/navigator-bookmarks";
import {
  buscarHistorico,
  maisAcessados,
  type HistoryEntry,
  type MaisAcessado,
  type PeriodoLimpeza,
} from "@/lib/navigator-history";
import { Badge } from "@/components/reui/badge";
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from "@/components/reui/sortable";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { preencher, useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import {
  BedDouble,
  ChevronDown,
  ChevronRight,
  Coffee,
  Command as CommandIcon,
  Compass,
  EyeOff,
  FolderMinus,
  FolderPlus,
  Globe,
  GripHorizontal,
  GripVertical,
  History,
  Loader2,
  Moon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OcultarWebviewContext,
  useOcultarWebviewEnquantoAberto,
} from "@/lib/navigator-overlay";
import { ShipIcon, type ShipIconHandle } from "@/components/ui/ship";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";

/**
 * Hero da aba vazia do Navigator (#74): a nave (lucide-animated) balançando em
 * loop infinito + título "Navigator" + subtítulo "Time to set sail", todos com
 * animação de entrada (ícone: fade/scale via `logo-in`; textos: SoftBlurIn — o
 * mesmo reveal da tela de login/reconexão). Fica acima da omnibox.
 */
function NavigatorHero({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  const nave = useRef<ShipIconHandle>(null);
  // Anima no mount e mantém o balanço infinito (o <g> do barco tem repeat:Infinity).
  useEffect(() => {
    nave.current?.startAnimation();
  }, []);
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <ShipIcon
        ref={nave}
        size={40}
        className="logo-in text-primary [&_svg]:size-10"
      />
      <SoftBlurIn className="text-2xl font-semibold tracking-tight" delay={120} stagger={16}>
        {titulo}
      </SoftBlurIn>
      <SoftBlurIn className="text-[15px] text-muted-foreground" delay={300} stagger={14}>
        {subtitulo}
      </SoftBlurIn>
    </div>
  );
}

/**
 * Ações e dados que a paleta de comandos dispara. Tudo já vive no `App.tsx`
 * (fonte da verdade das abas) e chega aqui pelas props do `NavegadorScreen` —
 * a paleta não guarda estado de abas, só a query efêmera do input.
 */
type AcoesPaleta = {
  abas: AbaBrowser[];
  ativa: string | null;
  favoritos: Favorito[];
  historico: HistoryEntry[];
  onAbrir: (app: AppM365) => void;
  onNavegar: (url: string, nome: string) => void;
  onTrocar: (id: string) => void;
  onFechar: (id: string) => void;
  onNovaAba: () => void;
  onAlternarFixada: (id: string) => void;
  onDormir: (id: string) => void;
};

/** Mapeia uma url visitada de volta ao app M365 do catalogo (a url gravada pode
 *  carregar `?login_hint=…` colado no fim da url canonica do app). */
function appPorUrl(url: string): AppM365 | undefined {
  return APPS.find((a) => url.startsWith(a.url));
}

type ModoPaleta = "omni" | "acoes" | "abas" | "historico";

/**
 * Prefixos estilo Raycast/Arc: `>` ações, `@` abas abertas, `#` histórico
 * (grupo já desenhado; conteúdo chega na Story 5). Sem prefixo = mistura
 * ranqueada. Devolve o modo e o termo já sem o prefixo, para o filtro do cmdk.
 */
function lerPrefixo(q: string): { modo: ModoPaleta; termo: string } {
  if (q.startsWith(">")) return { modo: "acoes", termo: q.slice(1).trim() };
  if (q.startsWith("@")) return { modo: "abas", termo: q.slice(1).trim() };
  if (q.startsWith("#")) return { modo: "historico", termo: q.slice(1).trim() };
  return { modo: "omni", termo: q.trim() };
}

/**
 * O miolo da paleta: um único `Command` (cmdk) com omnibox + grupos. É o mesmo
 * corpo usado no Launcher (aba vazia) e no overlay global (Ctrl/Cmd+K) — sem
 * fork, conforme a spec §4.3. A query é local (estado efêmero do input); as
 * abas e ações vêm por props. `onExecutou` fecha o overlay após uma seleção.
 */
function ConteudoPaleta({
  abas,
  ativa,
  favoritos,
  historico,
  className,
  autoFocus,
  onExecutou,
  onAbrir,
  onNavegar,
  onTrocar,
  onFechar,
  onNovaAba,
  onAlternarFixada,
  onDormir,
}: AcoesPaleta & {
  className?: string;
  autoFocus?: boolean;
  onExecutou?: () => void;
}) {
  const { idioma, t } = useIdioma();
  const [q, setQ] = useState("");
  const { modo, termo } = lerPrefixo(q);

  // "Mais acessados" REAL: contagem derivada do historico (spec §8.3). Sem
  // historico ainda (instalacao nova), cai na lista M365 curada — sem regressao.
  const topAcessados = maisAcessados(historico, 9);
  const maisUsadosFallback = MAIS_USADOS.map((id) =>
    APPS.find((a) => a.id === id),
  ).filter((a): a is AppM365 => a != null);
  // Grupo `#`: historico filtrado pelo termo, ja ordenado por recencia. Fatiado
  // para nao renderizar milhares de itens no cmdk.
  const historicoLista =
    modo === "historico" ? buscarHistorico(historico, termo).slice(0, 50) : [];
  const alfabetica = (a: AppM365, b: AppM365) => a.nome.localeCompare(b.nome);

  // Roda a ação e, no overlay, fecha a paleta em seguida.
  const executar = (fn: () => void) => {
    fn();
    onExecutou?.();
  };

  // Omnibox: só sem prefixo e com texto. O que a barra faria no Enter agora.
  const rota = modo === "omni" && termo ? browser.interpretar(termo) : null;
  const rotuloRota = rota
    ? rota.tipo === "url"
      ? preencher(t.navegador.irPara, { nome: rota.nome })
      : preencher(t.navegador.pesquisar, { q: termo })
    : "";

  const abaAtivaObj = abas.find((a) => a.id === ativa);
  const favoritosLinks = favoritosParaPalette(favoritos);
  const mostrarAcoes = modo === "omni" || modo === "acoes";
  const mostrarAbas = (modo === "omni" || modo === "abas") && abas.length > 0;
  const mostrarFavoritos = modo === "omni" && favoritosLinks.length > 0;
  const mostrarApps = modo === "omni";

  return (
    <Command
      // h-auto anula o h-full padrao do Command (senao estica). O filtro casa
      // pelo termo (sem o prefixo), nao pela query crua do input.
      className={cn("h-auto **:data-[selected=true]:bg-muted", className)}
      filter={(value) =>
        value.toLowerCase().includes(termo.toLowerCase()) ? 1 : 0
      }
    >
      <CommandInput
        value={q}
        onValueChange={setQ}
        autoFocus={autoFocus}
        placeholder={t.navegador.paletaBuscar}
      />
      <CommandList className="scrollbar-fina max-h-[380px]">
        {modo !== "historico" && <CommandEmpty>{t.navegador.vazio}</CommandEmpty>}

        {rota && (
          <>
            <CommandGroup heading={t.navegador.navegar}>
              <CommandItem
                value={`__rota__ ${q}`}
                onSelect={() => executar(() => onNavegar(rota.url, rota.nome))}
                className="gap-2.5"
              >
                {rota.tipo === "url" ? (
                  <Compass className="size-4 shrink-0 text-primary" />
                ) : (
                  <Search className="size-4 shrink-0 text-primary" />
                )}
                <span className="truncate">{rotuloRota}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {mostrarAcoes && (
          <>
            <CommandGroup heading={t.navegador.grupoAcoes}>
              <CommandItem
                value={t.navegador.novaAba}
                onSelect={() => executar(onNovaAba)}
                className="gap-2.5"
              >
                <Plus className="size-4 shrink-0" />
                <span>{t.navegador.novaAba}</span>
              </CommandItem>
              {abaAtivaObj && (
                <>
                  <CommandItem
                    value={`${t.navegador.fecharAba} ${abaAtivaObj.nome}`}
                    onSelect={() => executar(() => onFechar(abaAtivaObj.id))}
                    className="gap-2.5"
                  >
                    <X className="size-4 shrink-0" />
                    <span>{t.navegador.fecharAba}</span>
                  </CommandItem>
                  <CommandItem
                    value={`${
                      abaAtivaObj.fixada
                        ? t.navegador.desafixarAba
                        : t.navegador.fixarAba
                    } ${abaAtivaObj.nome}`}
                    onSelect={() =>
                      executar(() => onAlternarFixada(abaAtivaObj.id))
                    }
                    className="gap-2.5"
                  >
                    {abaAtivaObj.fixada ? (
                      <PinOff className="size-4 shrink-0" />
                    ) : (
                      <Pin className="size-4 shrink-0" />
                    )}
                    <span>
                      {abaAtivaObj.fixada
                        ? t.navegador.desafixarAba
                        : t.navegador.fixarAba}
                    </span>
                  </CommandItem>
                  {!abaAtivaObj.fixada && !abaAtivaObj.manterAcordada && (
                    <CommandItem
                      value={`${t.navegador.colocarDormir} ${abaAtivaObj.nome}`}
                      onSelect={() => executar(() => onDormir(abaAtivaObj.id))}
                      className="gap-2.5"
                    >
                      <Moon className="size-4 shrink-0" />
                      <span>{t.navegador.colocarDormir}</span>
                    </CommandItem>
                  )}
                </>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {mostrarAbas && (
          <>
            <CommandGroup heading={t.navegador.grupoAbas}>
              {abas.map((aba) => (
                <ItemAba
                  key={aba.id}
                  aba={aba}
                  ehAtiva={aba.id === ativa}
                  onSelecionar={() => executar(() => onTrocar(aba.id))}
                />
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {mostrarFavoritos && (
          <>
            <CommandGroup heading={t.navegador.grupoFavoritos}>
              {favoritosLinks.map((fav) => (
                <CommandItem
                  key={fav.id}
                  value={`${fav.nome} ${fav.url} ${fav.caminho}`}
                  onSelect={() => executar(() => onNavegar(fav.url, fav.nome))}
                  className="gap-2.5"
                >
                  <Star className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {fav.nome}
                  </span>
                  {fav.caminho && (
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                      {fav.caminho}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {mostrarApps && (
          <>
            <CommandGroup
              heading={
                topAcessados.length > 0
                  ? t.navegador.grupoMaisAcessados
                  : t.apps.maisUsados
              }
            >
              {topAcessados.length > 0
                ? topAcessados.map((item) => (
                    <ItemMaisAcessado
                      key={item.url}
                      item={item}
                      idioma={idioma}
                      onSelecionar={() => {
                        const app = appPorUrl(item.url);
                        executar(() =>
                          app ? onAbrir(app) : onNavegar(item.url, item.nome),
                        );
                      }}
                    />
                  ))
                : maisUsadosFallback.map((app) => (
                    <ItemApp
                      key={app.id}
                      app={app}
                      idioma={idioma}
                      onAbrir={(a) => executar(() => onAbrir(a))}
                    />
                  ))}
            </CommandGroup>
            <CommandSeparator />

            {CATEGORIAS.map((cat) => (
              <CommandGroup key={cat} heading={t.apps[cat]}>
                {porCategoria(cat)
                  .slice()
                  .sort(alfabetica)
                  .map((app) => (
                    <ItemApp
                      key={`${cat}-${app.id}`}
                      app={app}
                      idioma={idioma}
                      onAbrir={(a) => executar(() => onAbrir(a))}
                    />
                  ))}
              </CommandGroup>
            ))}
          </>
        )}

        {/* Histórico (`#`): visitas reais, ordenadas por recência (Story 5). */}
        {modo === "historico" &&
          (historicoLista.length > 0 ? (
            <CommandGroup heading={t.navegador.grupoHistorico}>
              {historicoLista.map((entrada) => (
                <ItemHistorico
                  key={entrada.id}
                  entrada={entrada}
                  onSelecionar={() =>
                    executar(() => onNavegar(entrada.url, entrada.nome))
                  }
                />
              ))}
            </CommandGroup>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t.navegador.historicoVazio}
            </div>
          ))}
      </CommandList>
    </Command>
  );
}

/**
 * Launcher do Cruiser — a paleta em repouso, na aba vazia. Reusa
 * `ConteudoPaleta` como card flutuante sobre o fundo estrelado.
 */
function Launcher(props: AcoesPaleta) {
  const { t } = useIdioma();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 p-6">
      <NavigatorHero titulo={t.navegador.titulo} subtitulo={t.navegador.subtitulo} />
      <ConteudoPaleta
        {...props}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      />
    </div>
  );
}

/**
 * A paleta como overlay global (Ctrl/Cmd+K), por cima da aba viva. O `Dialog`
 * (portal do Radix) monta o conteúdo só quando aberto — então a query zera a
 * cada abertura. O truque de z-order (esconder a webview) fica no
 * `NavegadorScreen`, que tem o retângulo e sabe qual aba restaurar.
 */
function PaletaOverlay({
  aberta,
  onAberturaMudou,
  ...acoes
}: AcoesPaleta & {
  aberta: boolean;
  onAberturaMudou: (aberta: boolean) => void;
}) {
  const { t } = useIdioma();
  return (
    <Dialog open={aberta} onOpenChange={onAberturaMudou}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t.navegador.paletaTitulo}</DialogTitle>
          <DialogDescription>{t.navegador.paletaDescricao}</DialogDescription>
        </DialogHeader>
        <ConteudoPaleta
          {...acoes}
          autoFocus
          onExecutou={() => onAberturaMudou(false)}
          className="border-0 bg-transparent shadow-none"
        />
      </DialogContent>
    </Dialog>
  );
}

function ItemApp({
  app,
  idioma,
  onAbrir,
}: {
  app: AppM365;
  idioma: "pt-BR" | "en";
  onAbrir: (app: AppM365) => void;
}) {
  return (
    <CommandItem
      value={`${app.nome} ${app.resumo[idioma]}`}
      onSelect={() => onAbrir(app)}
      className="gap-2.5"
    >
      <img src={urlIcone(app)} alt="" className="size-5 shrink-0" draggable={false} />
      <span className="font-medium">{app.nome}</span>
      <span className="text-muted-foreground truncate text-xs">
        {app.resumo[idioma]}
      </span>
    </CommandItem>
  );
}

/** Um "mais acessado" (contagem real): ícone do app quando a url casa com o
 *  catálogo, senão um globo; mostra a contagem de acessos à direita. */
function ItemMaisAcessado({
  item,
  idioma,
  onSelecionar,
}: {
  item: MaisAcessado;
  idioma: "pt-BR" | "en";
  onSelecionar: () => void;
}) {
  const app = appPorUrl(item.url);
  return (
    <CommandItem
      value={`${item.nome} ${item.url}`}
      onSelect={onSelecionar}
      className="gap-2.5"
    >
      {app ? (
        <img src={urlIcone(app)} alt="" className="size-5 shrink-0" draggable={false} />
      ) : (
        <Globe className="size-5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">
        {app ? app.nome : item.nome}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {app ? app.resumo[idioma] : new URL(item.url).hostname.replace(/^www\./, "")}
      </span>
    </CommandItem>
  );
}

/** Uma entrada do histórico na paleta (`#`): globo/ícone, título e host. */
function ItemHistorico({
  entrada,
  onSelecionar,
}: {
  entrada: HistoryEntry;
  onSelecionar: () => void;
}) {
  const app = appPorUrl(entrada.url);
  let host = entrada.url;
  try {
    host = new URL(entrada.url).hostname.replace(/^www\./, "");
  } catch {
    // url estranha: deixa a string crua
  }
  return (
    <CommandItem
      value={`${entrada.nome} ${entrada.url} ${entrada.id}`}
      onSelect={onSelecionar}
      className="gap-2.5"
    >
      {app ? (
        <img src={urlIcone(app)} alt="" className="size-4 shrink-0" draggable={false} />
      ) : (
        <History className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{entrada.nome}</span>
      <span className="shrink-0 truncate text-xs text-muted-foreground">
        {host}
      </span>
    </CommandItem>
  );
}

/** Uma aba aberta/dormindo na paleta (`@`): ícone do app, nome e estado. */
function ItemAba({
  aba,
  ehAtiva,
  onSelecionar,
}: {
  aba: AbaBrowser;
  ehAtiva: boolean;
  onSelecionar: () => void;
}) {
  const { t } = useIdioma();
  const app = porId(aba.id);
  const dormindo = aba.estado === "dormindo";
  return (
    <CommandItem
      value={`${aba.nome} ${aba.url}`}
      onSelect={onSelecionar}
      className="gap-2.5"
    >
      {dormindo ? (
        <Moon className="size-4 shrink-0" aria-hidden="true" />
      ) : app ? (
        <img src={urlIcone(app)} alt="" className="size-4 shrink-0" draggable={false} />
      ) : (
        <Globe className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{aba.nome}</span>
      {ehAtiva && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t.navegador.abaAtual}
        </span>
      )}
      {dormindo && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t.navegador.dormindo}
        </span>
      )}
    </CommandItem>
  );
}

/**
 * Cruiser — navegador embutido com abas. A barra de abas é React; o conteúdo de
 * cada aba é um webview NATIVO gerenciado no Rust, posicionado sobre a área
 * medida aqui. Sem aba ativa, some o webview e aparece o Launcher.
 */
export function NavegadorScreen({
  abas,
  ativa,
  onTrocar,
  onFechar,
  onDormir,
  onDormirOutras,
  onAlternarFixada,
  onAlternarManterAcordada,
  onReativada,
  onReordenar,
  onAbrir,
  onNovaAba,
  onNavegar,
  historico,
  onLimparHistorico,
  modoPrivado,
  onAlternarModoPrivado,
}: {
  abas: AbaBrowser[];
  ativa: string | null;
  onTrocar: (id: string) => void;
  onFechar: (id: string) => void;
  onDormir: (id: string) => void;
  onDormirOutras: (id: string) => void;
  onAlternarFixada: (id: string) => void;
  onAlternarManterAcordada: (id: string) => void;
  onReativada: (id: string) => void;
  onReordenar: (ids: string[]) => void;
  onAbrir: (app: AppM365) => void;
  onNovaAba: () => void;
  onNavegar: (url: string, nome: string) => void;
  historico: HistoryEntry[];
  onLimparHistorico: (periodo: PeriodoLimpeza) => void;
  modoPrivado: boolean;
  onAlternarModoPrivado: () => void;
}) {
  const { t } = useIdioma();
  const area = useRef<HTMLDivElement>(null);
  const activeTab = abas.find((tab) => tab.id === ativa);
  const sleepingCount = abas.filter((tab) => tab.estado === "dormindo").length;
  // Estado efêmero de UI (só quem lê é este componente): não pertence ao store.
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  // Z-order (#275): conta os overlays DOM abertos SOBRE a webview (menus de
  // contexto, dropdowns da barra, diálogos). Enquanto houver algum, a webview
  // fica escondida para não cortar o overlay — mesmo padrão do #174 (paleta),
  // agora generalizado via OcultarWebviewContext.
  const [overlaysWebview, setOverlaysWebview] = useState(0);
  const registrarOverlayWebview = useCallback((aberto: boolean) => {
    setOverlaysWebview((n) => Math.max(0, n + (aberto ? 1 : -1)));
  }, []);

  // --- Grupos de aba (Story 3) ---------------------------------------------
  // Grupos vivem aqui + localStorage, DESACOPLADOS do estado de abas do App (que
  // só ganhou o handler de reorder). A strip é fatiada em lanes: pins (compactos)
  // → grupos (recolhíveis) → soltas; cada lane é um Sortable horizontal.
  const [grupos, setGrupos] = useState<NavigatorGroup[]>(loadNavigatorGroups);
  const [membership, setMembership] = useState<NavigatorMembership>(
    loadNavigatorMembership,
  );
  // Grupo em edição no diálogo (nome + cor + excluir), ou null.
  const [grupoEditando, setGrupoEditando] = useState<string | null>(null);

  // --- Favoritos (Story 4 / #176) ------------------------------------------
  // Favoritos vivem aqui + localStorage (mesmo padrão dos grupos), DESACOPLADOS
  // das abas. A barra reabre rápido; a paleta os busca; o diálogo importa do
  // Chrome/Edge. `onNavegar` (aba própria) já é a mesma ponte da omnibox.
  const [favoritos, setFavoritos] = useState<Favorito[]>(loadFavoritos);

  useEffect(() => {
    persistFavoritos(favoritos);
  }, [favoritos]);

  useEffect(() => {
    persistNavigatorGroups(grupos);
  }, [grupos]);

  // Persiste o mapa já podado (sem abas fechadas / grupos inexistentes) para não
  // crescer sem limite entre sessões; o estado em memória segue cru (barato).
  useEffect(() => {
    persistNavigatorMembership(podarMembership(membership, abas, grupos));
  }, [membership, abas, grupos]);

  const lanes = useMemo(
    () => montarLanes(abas, grupos, membership),
    [abas, grupos, membership],
  );

  // Reordena UMA lane (drag) e sobe a ordem completa de ids ao App. Ordem de
  // chip pura: não toca ativa/url → nenhuma webview reposiciona.
  function reordenarLaneAbas(laneAbas: AbaBrowser[]) {
    onReordenar(
      reordenarLane(
        abas.map((a) => a.id),
        laneAbas.map((a) => a.id),
      ),
    );
  }

  function corProximoGrupo(): NavigatorGroupColor {
    const usadas = new Set(grupos.map((g) => g.cor));
    const livre = NAVIGATOR_GROUP_COLOR_ORDER.find((c) => !usadas.has(c));
    return (
      livre ??
      NAVIGATOR_GROUP_COLOR_ORDER[
        grupos.length % NAVIGATOR_GROUP_COLOR_ORDER.length
      ]
    );
  }

  function novoGrupoComAba(abaId: string) {
    const id = `grupo-${Date.now()}`;
    setGrupos((prev) => [
      ...prev,
      {
        id,
        nome: `${t.navegador.grupoNomePadrao} ${prev.length + 1}`,
        cor: corProximoGrupo(),
        recolhido: false,
      },
    ]);
    setMembership((prev) => ({ ...prev, [abaId]: id }));
  }

  function adicionarAoGrupo(abaId: string, grupoId: string) {
    setMembership((prev) => ({ ...prev, [abaId]: grupoId }));
  }

  function removerDoGrupo(abaId: string) {
    setMembership((prev) => {
      const proximo = { ...prev };
      delete proximo[abaId];
      return proximo;
    });
  }

  function alternarRecolhido(grupoId: string) {
    setGrupos((prev) =>
      prev.map((g) => (g.id === grupoId ? { ...g, recolhido: !g.recolhido } : g)),
    );
  }

  function renomearGrupo(grupoId: string, nome: string) {
    setGrupos((prev) =>
      prev.map((g) => (g.id === grupoId ? { ...g, nome } : g)),
    );
  }

  function recolorirGrupo(grupoId: string, cor: NavigatorGroupColor) {
    setGrupos((prev) =>
      prev.map((g) => (g.id === grupoId ? { ...g, cor } : g)),
    );
  }

  function excluirGrupo(grupoId: string) {
    setGrupos((prev) => prev.filter((g) => g.id !== grupoId));
    setMembership((prev) => {
      const proximo: NavigatorMembership = {};
      for (const [abaId, gid] of Object.entries(prev)) {
        if (gid !== grupoId) proximo[abaId] = gid;
      }
      return proximo;
    });
    setGrupoEditando((atual) => (atual === grupoId ? null : atual));
  }

  /** Um chip de aba (grupo/solta/pin). Reorder por drag vem de um handle
   *  dedicado (mouse), separado do corpo do chip que troca de aba (clique/teclado
   *  intactos, sem conflito com o sensor de teclado do dnd). */
  const renderChip = (aba: AbaBrowser, compact: boolean) => {
    const app = porId(aba.id);
    const ativaAba = aba.id === ativa;
    const dormindo = aba.estado === "dormindo";
    const privada = Boolean(aba.privada);
    const grupoAtual = aba.fixada ? undefined : membership[aba.id];
    const tabLabel = dormindo
      ? preencher(t.navegador.dormindoClique, { nome: aba.nome })
      : privada
        ? preencher(t.navegador.abaPrivada, { nome: aba.nome })
        : aba.fixada
          ? preencher(t.navegador.fixadaNome, { nome: aba.nome })
          : aba.nome;
    return (
      <SortableItem
        key={aba.id}
        value={aba.id}
        className="group/chip relative shrink-0"
      >
        <ContextMenu onOpenChange={registrarOverlayWebview}>
          <ContextMenuTrigger asChild>
            <div
              role="tab"
              tabIndex={0}
              aria-selected={ativaAba}
              aria-label={tabLabel}
              onClick={() => onTrocar(aba.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onTrocar(aba.id);
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-t-md border border-b-0 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                compact ? "w-10 justify-center px-2" : "w-40 px-3",
                ativaAba
                  ? "border-border bg-background font-medium"
                  : "border-transparent text-muted-foreground hover:bg-accent/50",
                dormindo && "opacity-60",
                privada && "text-info",
              )}
            >
              {dormindo ? (
                <Moon className="size-4 shrink-0" aria-hidden="true" />
              ) : privada ? (
                <EyeOff className="size-4 shrink-0 text-info" aria-hidden="true" />
              ) : app ? (
                <img
                  src={urlIcone(app)}
                  alt=""
                  className="size-4 shrink-0"
                  draggable={false}
                />
              ) : (
                <Globe className="size-4 shrink-0 text-muted-foreground" />
              )}
              {compact ? (
                <span className="sr-only">{tabLabel}</span>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 flex-1 truncate">{aba.nome}</span>
                    </TooltipTrigger>
                    <TooltipContent>{tabLabel}</TooltipContent>
                  </Tooltip>
                  {aba.manterAcordada && (
                    <Coffee
                      className="size-3.5 shrink-0"
                      aria-label={t.navegador.manterAcordadaAtivo}
                    />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t.navegador.fecharAba}
                        onClick={(event) => {
                          event.stopPropagation();
                          onFechar(aba.id);
                        }}
                        className="grid size-4 shrink-0 place-items-center rounded opacity-60 hover:bg-foreground/10 hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t.navegador.fecharAba}</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuItem
              className="gap-2"
              onClick={() => onAlternarFixada(aba.id)}
            >
              {aba.fixada ? <PinOff /> : <Pin />}
              {aba.fixada ? t.navegador.desafixarAba : t.navegador.fixarAba}
            </ContextMenuItem>
            <ContextMenuItem
              className="gap-2"
              onClick={() => onAlternarManterAcordada(aba.id)}
            >
              <Coffee />
              {aba.manterAcordada
                ? t.navegador.permitirDormir
                : t.navegador.manterAcordada}
            </ContextMenuItem>
            {!aba.fixada && (
              <>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger className="gap-2">
                    <FolderPlus />
                    {t.navegador.grupoAdicionarA}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-52">
                    {grupos.map((g) => (
                      <ContextMenuItem
                        key={g.id}
                        className="gap-2"
                        disabled={grupoAtual === g.id}
                        onClick={() => adicionarAoGrupo(aba.id, g.id)}
                      >
                        <span
                          className={cn(
                            "size-2.5 shrink-0 rounded-full",
                            NAVIGATOR_GROUP_COLORS[g.cor].dot,
                          )}
                        />
                        <span className="truncate">{g.nome}</span>
                      </ContextMenuItem>
                    ))}
                    {grupos.length > 0 && <ContextMenuSeparator />}
                    <ContextMenuItem
                      className="gap-2"
                      onClick={() => novoGrupoComAba(aba.id)}
                    >
                      <Plus />
                      {t.navegador.grupoNovo}
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                {grupoAtual && (
                  <ContextMenuItem
                    className="gap-2"
                    onClick={() => removerDoGrupo(aba.id)}
                  >
                    <FolderMinus />
                    {t.navegador.grupoRemoverDe}
                  </ContextMenuItem>
                )}
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              className="gap-2"
              disabled={
                ativaAba ||
                dormindo ||
                Boolean(aba.fixada) ||
                Boolean(aba.manterAcordada)
              }
              onClick={() => onDormir(aba.id)}
            >
              <Moon />
              {t.navegador.colocarDormir}
            </ContextMenuItem>
            <ContextMenuItem
              className="gap-2"
              onClick={() => onDormirOutras(aba.id)}
            >
              <BedDouble />
              {t.navegador.dormirOutras}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => onFechar(aba.id)}
            >
              <X />
              {t.navegador.fecharAba}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <SortableItemHandle
          aria-label={t.navegador.grupoReordenar}
          title={t.navegador.grupoReordenar}
          className={cn(
            "pointer-events-none absolute z-10 grid place-items-center text-muted-foreground opacity-0 transition-opacity group-hover/chip:pointer-events-auto group-hover/chip:opacity-70",
            compact
              ? "left-1/2 top-0.5 h-3 w-4 -translate-x-1/2"
              : "bottom-0 left-0 top-0 w-3",
          )}
        >
          {compact ? (
            <GripHorizontal className="size-3" />
          ) : (
            <GripVertical className="size-3" />
          )}
        </SortableItemHandle>
      </SortableItem>
    );
  };

  function medir(): browser.Retangulo | null {
    const el = area.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  // Ctrl/Cmd+K abre/fecha a paleta de qualquer lugar do Navigator. (O DOM só
  // recebe a tecla quando o foco NÃO está dentro da webview nativa — por isso
  // existe também o botão na barra, que funciona mesmo com a página em foco.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletaAberta((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Z-order (spec §4.2): a webview nativa do WebView2 pinta ACIMA do DOM. Com a
  // paleta aberta (ou sem aba ativa) escondemos a webview para o overlay
  // aparecer; ao fechar, este mesmo efeito reroda e revela/reposiciona a aba
  // ativa atual — restaurando a página por baixo.
  useEffect(() => {
    if (paletaAberta || overlaysWebview > 0 || !ativa) {
      browser.esconderTodas();
      return;
    }
    const r = medir();
    if (activeTab && r) {
      void browser
        .abrir(activeTab.id, activeTab.url, r)
        .catch(() => {
          // A ponte nativa pode não existir no browser mock de desenvolvimento.
        })
        .finally(() => {
          if (activeTab.reativando) onReativada(activeTab.id);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa, activeTab?.url, paletaAberta, overlaysWebview]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const reposicionar = () => {
      const r = medir();
      if (ativa && r) browser.layout(ativa, r);
    };
    const ro = new ResizeObserver(reposicionar);
    ro.observe(el);
    window.addEventListener("resize", reposicionar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", reposicionar);
    };
  }, [ativa]);

  useEffect(() => {
    return () => {
      browser.esconderTodas();
    };
  }, []);

  return (
    <OcultarWebviewContext.Provider value={registrarOverlayWebview}>
    <div className="flex h-full w-full flex-col">
      {/* Barra de abas: rola na horizontal; o "+" fica fora da rolagem. */}
      <div className="flex items-stretch border-b border-border">
        <div
          className="scrollbar-fina flex items-stretch gap-2 overflow-x-auto px-2 pt-2"
          role="tablist"
          aria-label={t.navegador.abas}
        >
          {lanes.map((lane) => {
            if (lane.tipo === "grupo" && lane.grupo) {
              const grupo = lane.grupo;
              const cor = NAVIGATOR_GROUP_COLORS[grupo.cor];
              return (
                <div
                  key={grupo.id}
                  role="group"
                  aria-label={preencher(t.navegador.grupoAria, {
                    nome: grupo.nome,
                    n: lane.abas.length,
                  })}
                  className={cn(
                    "flex items-stretch gap-1 rounded-t-md border-b-2 pr-1",
                    cor.borda,
                    cor.faixa,
                  )}
                >
                  <ContextMenu onOpenChange={registrarOverlayWebview}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => alternarRecolhido(grupo.id)}
                        aria-expanded={!grupo.recolhido}
                        className="flex shrink-0 items-center gap-1.5 rounded-t-md px-2 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          className={cn(
                            "size-2.5 shrink-0 rounded-full",
                            cor.dot,
                          )}
                        />
                        <span className="max-w-28 truncate">{grupo.nome}</span>
                        <span className="text-xs text-muted-foreground">
                          {lane.abas.length}
                        </span>
                        {grupo.recolhido ? (
                          <ChevronRight className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0" />
                        )}
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      <ContextMenuItem
                        className="gap-2"
                        onClick={() => alternarRecolhido(grupo.id)}
                      >
                        {grupo.recolhido ? <ChevronDown /> : <ChevronRight />}
                        {grupo.recolhido
                          ? t.navegador.grupoExpandir
                          : t.navegador.grupoRecolher}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="gap-2"
                        onClick={() => setGrupoEditando(grupo.id)}
                      >
                        <Pencil />
                        {t.navegador.grupoEditar}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        className="gap-2"
                        onClick={() => excluirGrupo(grupo.id)}
                      >
                        <Trash2 />
                        {t.navegador.grupoExcluir}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  {!grupo.recolhido && (
                    <Sortable
                      strategy="horizontal"
                      value={lane.abas}
                      onValueChange={reordenarLaneAbas}
                      getItemValue={(a) => a.id}
                      className="flex items-stretch gap-1"
                    >
                      {lane.abas.map((aba) => renderChip(aba, false))}
                    </Sortable>
                  )}
                </div>
              );
            }
            return (
              <Sortable
                key={lane.tipo}
                strategy="horizontal"
                value={lane.abas}
                onValueChange={reordenarLaneAbas}
                getItemValue={(a) => a.id}
                className="flex items-stretch gap-1"
              >
                {lane.abas.map((aba) => renderChip(aba, lane.tipo === "pins"))}
              </Sortable>
            );
          })}
        </div>
        {sleepingCount > 0 && (
          <Badge variant="info-light" className="my-2 shrink-0">
            <Moon />
            {preencher(t.navegador.dormindoTotal, { n: sleepingCount })}
          </Badge>
        )}
        {modoPrivado && (
          <Badge variant="info-light" className="my-2 shrink-0">
            <EyeOff />
            {t.navegador.modoPrivadoAtivo}
          </Badge>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t.navegador.historicoTitulo}
              onClick={() => setHistoricoAberto(true)}
              className={cn(
                "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
                "hover:bg-accent hover:text-foreground"
              )}
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
              aria-label={t.navegador.modoPrivado}
              aria-pressed={modoPrivado}
              onClick={onAlternarModoPrivado}
              className={cn(
                "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
                "hover:bg-accent hover:text-foreground",
                modoPrivado && "bg-info/15 text-info hover:text-info"
              )}
            >
              <EyeOff className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t.navegador.modoPrivado}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t.navegador.paleta}
              onClick={() => setPaletaAberta(true)}
              className={cn(
                "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
                "hover:bg-accent hover:text-foreground"
              )}
            >
              <CommandIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t.navegador.paleta}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t.navegador.novaAba}
              onClick={onNovaAba}
              className={cn(
                "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
                "hover:bg-accent hover:text-foreground",
                ativa === null && abas.length > 0 && "bg-accent text-foreground"
              )}
            >
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t.navegador.novaAba}</TooltipContent>
        </Tooltip>
      </div>

      {/* Barra de favoritos (#176): reabre rápido + gerencia (importar do
          Chrome/Edge, adicionar da aba ativa, pastas, renomear, remover). */}
      <BarraFavoritos
        favoritos={favoritos}
        onMudar={setFavoritos}
        onNavegar={onNavegar}
        abaAtiva={
          activeTab ? { url: activeTab.url, nome: activeTab.nome } : undefined
        }
      />

      {ativa === null ? (
        <div className="flex-1 overflow-hidden">
          <Launcher
            abas={abas}
            ativa={ativa}
            favoritos={favoritos}
            historico={historico}
            onAbrir={onAbrir}
            onNavegar={onNavegar}
            onTrocar={onTrocar}
            onFechar={onFechar}
            onNovaAba={onNovaAba}
            onAlternarFixada={onAlternarFixada}
            onDormir={onDormir}
          />
        </div>
      ) : (
        <div ref={area} className="relative flex-1 bg-background">
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-6 animate-spin opacity-40" />
              {activeTab?.reativando && (
                <span className="text-xs">{t.navegador.reativando}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overlay global (Ctrl/Cmd+K) por cima da aba viva. */}
      <PaletaOverlay
        aberta={paletaAberta}
        onAberturaMudou={setPaletaAberta}
        abas={abas}
        ativa={ativa}
        favoritos={favoritos}
        historico={historico}
        onAbrir={onAbrir}
        onNavegar={onNavegar}
        onTrocar={onTrocar}
        onFechar={onFechar}
        onNovaAba={onNovaAba}
        onAlternarFixada={onAlternarFixada}
        onDormir={onDormir}
      />

      {/* Histórico: view pesquisável + limpar por período (Story 5). */}
      <DialogHistorico
        aberto={historicoAberto}
        onFechar={() => setHistoricoAberto(false)}
        historico={historico}
        onNavegar={onNavegar}
        onLimpar={onLimparHistorico}
      />

      {/* Diálogo de edição de grupo (nome + cor + excluir). */}
      <DialogEditarGrupo
        grupo={grupos.find((g) => g.id === grupoEditando) ?? null}
        onFechar={() => setGrupoEditando(null)}
        onRenomear={renomearGrupo}
        onRecolorir={recolorirGrupo}
        onExcluir={excluirGrupo}
      />
    </div>
    </OcultarWebviewContext.Provider>
  );
}

/**
 * Diálogo de edição de um grupo: renomear, recolorir (paleta de tokens) e
 * excluir. O nome é estado local do input (efêmero); as ações sobem por props.
 */
function DialogEditarGrupo({
  grupo,
  onFechar,
  onRenomear,
  onRecolorir,
  onExcluir,
}: {
  grupo: NavigatorGroup | null;
  onFechar: () => void;
  onRenomear: (id: string, nome: string) => void;
  onRecolorir: (id: string, cor: NavigatorGroupColor) => void;
  onExcluir: (id: string) => void;
}) {
  const { t } = useIdioma();
  const [nome, setNome] = useState("");
  // z-order (#275): esconde a webview enquanto o diálogo estiver aberto.
  useOcultarWebviewEnquantoAberto(grupo != null);

  // Sincroniza o input ao abrir/trocar de grupo.
  useEffect(() => {
    if (grupo) setNome(grupo.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupo?.id]);

  const nomeCores: Record<NavigatorGroupColor, string> = {
    rosa: t.navegador.corRosa,
    violeta: t.navegador.corVioleta,
    verde: t.navegador.corVerde,
    ambar: t.navegador.corAmbar,
    vermelho: t.navegador.corVermelho,
  };

  const salvar = () => {
    if (!grupo) return;
    const limpo = nome.trim();
    if (limpo) onRenomear(grupo.id, limpo);
    onFechar();
  };

  return (
    <Dialog open={grupo != null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.navegador.grupoEditar}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.navegador.grupoEditar}
          </DialogDescription>
        </DialogHeader>
        {grupo && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="grupo-nome" className="text-sm font-medium">
                {t.navegador.grupoNomeLabel}
              </label>
              <Input
                id="grupo-nome"
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder={t.navegador.grupoNomePlaceholder}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    salvar();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t.navegador.grupoCorLabel}
              </span>
              <div className="flex gap-2">
                {NAVIGATOR_GROUP_COLOR_ORDER.map((cor) => {
                  const selecionada = grupo.cor === cor;
                  return (
                    <button
                      key={cor}
                      type="button"
                      aria-label={nomeCores[cor]}
                      aria-pressed={selecionada}
                      title={nomeCores[cor]}
                      onClick={() => onRecolorir(grupo.id, cor)}
                      className={cn(
                        "size-7 rounded-full outline-none ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring",
                        NAVIGATOR_GROUP_COLORS[cor].dot,
                        selecionada
                          ? "ring-2 ring-ring"
                          : "opacity-70 hover:opacity-100",
                      )}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => grupo && onExcluir(grupo.id)}
          >
            <Trash2 className="size-4" />
            {t.navegador.grupoExcluir}
          </Button>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t.navegador.grupoCancelar}
              </Button>
            </DialogClose>
            <Button type="button" onClick={salvar}>
              {t.navegador.grupoSalvar}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * View de histórico (Story 5): busca pesquisável + lista por recência + limpar
 * por período. A query é estado local do input; navegar/limpar sobem por props.
 */
function DialogHistorico({
  aberto,
  onFechar,
  historico,
  onNavegar,
  onLimpar,
}: {
  aberto: boolean;
  onFechar: () => void;
  historico: HistoryEntry[];
  onNavegar: (url: string, nome: string) => void;
  onLimpar: (periodo: PeriodoLimpeza) => void;
}) {
  const { idioma, t } = useIdioma();
  const [q, setQ] = useState("");
  // z-order (#275): esconde a webview enquanto o histórico estiver aberto.
  useOcultarWebviewEnquantoAberto(aberto);
  const lista = useMemo(() => buscarHistorico(historico, q), [historico, q]);
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [idioma],
  );

  const abrir = (entrada: HistoryEntry) => {
    onNavegar(entrada.url, entrada.nome);
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.navegador.historicoTitulo}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.navegador.paletaBuscar}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t.navegador.historicoBuscar}
              className="pl-8"
              autoFocus
            />
          </div>
          <div className="scrollbar-fina max-h-[360px] min-h-[120px] overflow-y-auto rounded-md border border-border">
            {lista.length === 0 ? (
              <div className="grid h-[120px] place-items-center px-4 text-center text-sm text-muted-foreground">
                {t.navegador.historicoVazio}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lista.map((entrada) => {
                  const app = appPorUrl(entrada.url);
                  let host = entrada.url;
                  try {
                    host = new URL(entrada.url).hostname.replace(/^www\./, "");
                  } catch {
                    // url estranha: deixa a string crua
                  }
                  return (
                    <li key={entrada.id}>
                      <button
                        type="button"
                        onClick={() => abrir(entrada)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                      >
                        {app ? (
                          <img
                            src={urlIcone(app)}
                            alt=""
                            className="size-4 shrink-0"
                            draggable={false}
                          />
                        ) : (
                          <History className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {entrada.nome}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {host}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {fmt.format(entrada.ts)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {t.navegador.limparHistorico}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onLimpar("ultima-hora")}
            >
              {t.navegador.limparUltimaHora}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onLimpar("hoje")}
            >
              {t.navegador.limparHoje}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => onLimpar("tudo")}
            >
              <Trash2 className="size-4" />
              {t.navegador.limparTudo}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
