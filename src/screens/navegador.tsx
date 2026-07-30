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
import { fetchFavicon } from "@/lib/api";
import {
  montarLanes,
  reordenarLane,
  loadNavigatorGroups,
  persistNavigatorGroups,
  loadNavigatorMembership,
  persistNavigatorMembership,
  podarMembership,
  origemDaUrl,
  loadFaviconCache,
  persistFaviconCache,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  RotateCcw,
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
import { PirataIcon } from "@/components/ui/icons/marca/pirata";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";

/**
 * Hero da aba vazia do Navigator (#74): a nave (lucide-animated) balançando em
 * loop infinito + título "Navigator" + subtítulo "Time to set sail", todos com
 * animação de entrada (ícone: fade/scale via `logo-in`; textos: SoftBlurIn — o
 * mesmo reveal da tela de login/reconexão). Fica acima da omnibox.
 */
function NavigatorHero({
  titulo,
  subtitulo,
  privada,
}: {
  titulo: string;
  subtitulo: string;
  privada?: boolean;
}) {
  const nave = useRef<ShipIconHandle>(null);
  // Anima no mount e mantém o balanço infinito (o <g> do barco tem repeat:Infinity).
  useEffect(() => {
    if (!privada) nave.current?.startAnimation();
  }, [privada]);
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {privada ? (
        // Aba privada (#273): o timão vira o PIRATA (Lottie recolorido primária).
        <PirataIcon className="logo-in size-10" />
      ) : (
        <ShipIcon
          ref={nave}
          size={40}
          className="logo-in text-primary [&_svg]:size-10"
        />
      )}
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

  // #271: quando a paleta pede foco (overlay Ctrl+K OU Launcher da aba vazia),
  // foca o input ao montar. O `autoFocus` do overlay já vinha do Radix Dialog; o
  // Launcher inline não focava — este ref garante o foco nos dois, robusto contra
  // a flakiness do autoFocus HTML em remount.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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
        ref={inputRef}
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
function Launcher({ privada, ...props }: AcoesPaleta & { privada?: boolean }) {
  const { t } = useIdioma();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 p-6">
      <NavigatorHero
        titulo={t.navegador.titulo}
        subtitulo={t.navegador.subtitulo}
        privada={privada}
      />
      <ConteudoPaleta
        {...props}
        autoFocus
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
  onFecharOutras,
  onDormir,
  onDormirOutras,
  onAlternarFixada,
  onAlternarManterAcordada,
  onReativada,
  onReordenar,
  onAbrir,
  onNovaAba,
  onNovaAbaPrivada,
  onReabrirFechada,
  onNavegar,
  historico,
  onRestaurarAbas,
  onLimparHistorico,
  modoPrivado,
  onAlternarModoPrivado,
}: {
  abas: AbaBrowser[];
  ativa: string | null;
  onTrocar: (id: string) => void;
  onFechar: (id: string) => void;
  onFecharOutras: (id: string) => void;
  onDormir: (id: string) => void;
  onDormirOutras: (id: string) => void;
  onAlternarFixada: (id: string) => void;
  onAlternarManterAcordada: (id: string) => void;
  onReativada: (id: string) => void;
  onReordenar: (ids: string[]) => void;
  onAbrir: (app: AppM365) => void;
  onNovaAba: () => void;
  onNovaAbaPrivada: () => void;
  onReabrirFechada: () => void;
  onNavegar: (url: string, nome: string) => void;
  historico: HistoryEntry[];
  onRestaurarAbas: (entradas: { url: string; nome: string }[]) => void;
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

  // #275 (regressão): os menus de contexto de aba/grupo escondem a webview. Antes
  // isso ia por `onOpenChange` cru no contador — mas se o chip DESMONTASSE com o
  // menu aberto (re-render por timer de sleeping/favicon), o decremento nunca
  // vinha e a webview ficava presa escondida (tela PRETA). Aqui rastreamos UM
  // menu aberto por vez (o Radix já só deixa um) por uma chave estável e, num
  // efeito, LIMPAMOS a chave se o dono (aba/grupo) sumir — auto-cura, nunca trava.
  const [menuAbertoId, setMenuAbertoId] = useState<string | null>(null);
  const aoAbrirMenu = (chave: string) => (aberto: boolean) =>
    setMenuAbertoId((atual) => (aberto ? chave : atual === chave ? null : atual));

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

  // --- Favicons das abas web (#276) ----------------------------------------
  // Abas de apps M365 já têm ícone (urlIcone); para abas web livres, o Rust busca
  // o favicon do PRÓPRIO domínio (sem terceiros) e cacheamos por origem.
  const [favicons, setFavicons] = useState<Record<string, string>>(
    loadFaviconCache,
  );
  const faviconTentados = useRef<Set<string>>(new Set());

  useEffect(() => {
    persistFaviconCache(favicons);
  }, [favicons]);

  useEffect(() => {
    let vivo = true;
    for (const aba of abas) {
      if (porId(aba.id)) continue; // app M365 já tem ícone próprio
      if (aba.privada) continue; // aba privada não cacheia origem (privacidade)
      const origem = origemDaUrl(aba.url);
      if (!origem || favicons[origem] || faviconTentados.current.has(origem)) {
        continue;
      }
      faviconTentados.current.add(origem);
      void fetchFavicon(aba.url).then((uri) => {
        if (vivo && uri) setFavicons((prev) => ({ ...prev, [origem]: uri }));
      });
    }
    return () => {
      vivo = false;
    };
  }, [abas, favicons]);

  // Favicon de uma aba web: o salvo na própria aba, ou o cacheado por origem.
  const faviconDaAba = (aba: AbaBrowser): string | undefined => {
    if (aba.favicon) return aba.favicon;
    const origem = origemDaUrl(aba.url);
    return origem ? favicons[origem] : undefined;
  };

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
    const fav = !app && !privada ? faviconDaAba(aba) : undefined;
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
        <ContextMenu
          open={menuAbertoId === `aba:${aba.id}`}
          onOpenChange={aoAbrirMenu(`aba:${aba.id}`)}
        >
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
                // Aba privada (#273): borda tracejada info, visualmente distinta.
                privada && "border-info/60 border-dashed text-info",
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
              ) : fav ? (
                <img
                  src={fav}
                  alt=""
                  className="size-4 shrink-0 rounded-[3px]"
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
            <ContextMenuItem
              className="gap-2"
              disabled={abas.length <= 1}
              onClick={() => onFecharOutras(aba.id)}
            >
              <X />
              {t.navegador.fecharOutras}
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

  // #174: na aba vazia o Launcher inline JÁ é o command. Em vez de abrir o
  // overlay (que empilharia um segundo command opaco por cima), foca o input
  // inline existente.
  const focarComandoInline = useCallback(() => {
    document
      .querySelector<HTMLInputElement>('[data-slot="command-input"]')
      ?.focus();
  }, []);

  // Atalhos de navegador (#272, S1 — camada React). Funcionam quando o foco NÃO
  // está dentro da webview nativa (o app chrome). Para valerem SEMPRE (webview em
  // foco), falta o accelerator nativo em Rust (S2, follow-up). Ctrl+K é do #174.
  const focarOmnibox = useCallback(() => {
    if (ativa === null) focarComandoInline();
    else setPaletaAberta(true);
  }, [ativa, focarComandoInline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod && !e.altKey) return;
      const tecla = e.key.toLowerCase();

      // Ctrl/Cmd+K — paleta (comportamento do #174).
      if (mod && !e.shiftKey && tecla === "k") {
        e.preventDefault();
        if (ativa === null) focarComandoInline();
        else setPaletaAberta((v) => !v);
        return;
      }
      // Ctrl+L / Alt+D — focar o command/omnibox.
      if ((mod && tecla === "l") || (e.altKey && !mod && tecla === "d")) {
        e.preventDefault();
        focarOmnibox();
        return;
      }
      // Ctrl+T — nova aba (foca o command, liga com #271).
      if (mod && !e.shiftKey && tecla === "t") {
        e.preventDefault();
        onNovaAba();
        return;
      }
      // Ctrl+Shift+T — reabrir a última aba fechada.
      if (mod && e.shiftKey && tecla === "t") {
        e.preventDefault();
        onReabrirFechada();
        return;
      }
      // Ctrl+Shift+N — nova aba privada (#273, padrão de navegador).
      if (mod && e.shiftKey && tecla === "n") {
        e.preventDefault();
        onNovaAbaPrivada();
        return;
      }
      // Ctrl+W — fechar a aba atual.
      if (mod && tecla === "w") {
        e.preventDefault();
        if (ativa) onFechar(ativa);
        return;
      }
      // Ctrl+Tab / Ctrl+Shift+Tab — próxima / anterior aba.
      if (mod && e.key === "Tab") {
        e.preventDefault();
        if (abas.length === 0) return;
        const idx = abas.findIndex((a) => a.id === ativa);
        const passo = e.shiftKey ? -1 : 1;
        const base = idx === -1 ? (e.shiftKey ? 0 : -1) : idx;
        const prox = abas[(base + passo + abas.length) % abas.length];
        if (prox) onTrocar(prox.id);
        return;
      }
      // Ctrl+1..8 → ir pra aba N; Ctrl+9 → última aba.
      if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        if (abas.length === 0) return;
        const n = Number(e.key);
        const alvo = n === 9 ? abas[abas.length - 1] : abas[n - 1];
        if (alvo) onTrocar(alvo.id);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    abas,
    ativa,
    focarComandoInline,
    focarOmnibox,
    onNovaAba,
    onNovaAbaPrivada,
    onReabrirFechada,
    onFechar,
    onTrocar,
  ]);

  // #174: ao cair na aba vazia (Launcher inline cobre), zera o overlay pendente
  // — senão ele reabriria sozinho ao voltar para uma aba viva.
  useEffect(() => {
    if (ativa === null) setPaletaAberta(false);
  }, [ativa]);

  // Z-order (spec §4.2): a webview nativa do WebView2 pinta ACIMA do DOM. Com a
  // paleta aberta (ou sem aba ativa) escondemos a webview para o overlay
  // aparecer; ao fechar, este mesmo efeito reroda e revela/reposiciona a aba
  // ativa atual — restaurando a página por baixo.
  useEffect(() => {
    if (paletaAberta || overlaysWebview > 0 || menuAbertoId !== null || !ativa) {
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
  }, [ativa, activeTab?.url, paletaAberta, overlaysWebview, menuAbertoId]);

  // Auto-cura do menu de contexto (#275): se o dono do menu aberto (aba/grupo)
  // sumiu — chip desmontou com o menu aberto, sem disparar o fechamento — limpa a
  // chave para a webview voltar a aparecer, em vez de ficar presa escondida.
  useEffect(() => {
    if (!menuAbertoId) return;
    const existe = menuAbertoId.startsWith("aba:")
      ? abas.some((a) => `aba:${a.id}` === menuAbertoId)
      : lanes.some((l) => l.grupo && `grupo:${l.grupo.id}` === menuAbertoId);
    if (!existe) setMenuAbertoId(null);
  }, [abas, lanes, menuAbertoId]);

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
                  <ContextMenu
                    open={menuAbertoId === `grupo:${grupo.id}`}
                    onOpenChange={aoAbrirMenu(`grupo:${grupo.id}`)}
                  >
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
              aria-label={t.navegador.paleta}
              onClick={() =>
                ativa === null ? focarComandoInline() : setPaletaAberta(true)
              }
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
        {/* "+" com submenu (#273): Nova aba / Nova aba privada. */}
        <DropdownMenu onOpenChange={registrarOverlayWebview}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t.navegador.novaAba}
              className={cn(
                "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
                "hover:bg-accent hover:text-foreground",
                ativa === null && abas.length > 0 && "bg-accent text-foreground"
              )}
            >
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="gap-2" onSelect={onNovaAba}>
              <Plus className="size-4" />
              {t.navegador.novaAba}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onSelect={onNovaAbaPrivada}>
              <EyeOff className="size-4" />
              {t.navegador.novaAbaPrivada}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
            privada={modoPrivado}
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
        aberta={paletaAberta && ativa !== null}
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
      <SheetHistorico
        aberto={historicoAberto}
        onFechar={() => setHistoricoAberto(false)}
        historico={historico}
        onNavegar={onNavegar}
        onRestaurar={onRestaurarAbas}
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
function SheetHistorico({
  aberto,
  onFechar,
  historico,
  onNavegar,
  onRestaurar,
  onLimpar,
}: {
  aberto: boolean;
  onFechar: () => void;
  historico: HistoryEntry[];
  onNavegar: (url: string, nome: string) => void;
  onRestaurar: (entradas: { url: string; nome: string }[]) => void;
  onLimpar: (periodo: PeriodoLimpeza) => void;
}) {
  const { idioma, t } = useIdioma();
  const [q, setQ] = useState("");
  // #177: itens selecionáveis para restaurar abas + período de limpeza via Select.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [periodo, setPeriodo] = useState<PeriodoLimpeza>("ultima-hora");
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

  // Limpa a seleção sempre que o Sheet fecha.
  useEffect(() => {
    if (!aberto) setSelecionados(new Set());
  }, [aberto]);

  const alternar = (id: string) =>
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  const abrir = (entrada: HistoryEntry) => {
    onNavegar(entrada.url, entrada.nome);
    onFechar();
  };

  const restaurar = () => {
    const escolhidas = lista
      .filter((e) => selecionados.has(e.id))
      .map((e) => ({ url: e.url, nome: e.nome }));
    if (escolhidas.length === 0) return;
    onRestaurar(escolhidas);
    onFechar();
  };

  return (
    <Sheet open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t.navegador.historicoTitulo}</SheetTitle>
          <SheetDescription className="sr-only">
            {t.navegador.historicoBuscar}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 pb-2">
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
        </div>

        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">
          {lista.length === 0 ? (
            <div className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">
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
                const marcada = selecionados.has(entrada.id);
                return (
                  <li
                    key={entrada.id}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={marcada}
                      onCheckedChange={() => alternar(entrada.id)}
                      aria-label={preencher(t.navegador.historicoSelecionar, {
                        nome: entrada.nome,
                      })}
                    />
                    <button
                      type="button"
                      onClick={() => abrir(entrada)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline"
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

        <SheetFooter className="gap-3 border-t border-border">
          <Button
            type="button"
            disabled={selecionados.size === 0}
            onClick={restaurar}
            className="gap-2"
          >
            <RotateCcw className="size-4" />
            {selecionados.size > 0
              ? preencher(t.navegador.historicoRestaurar, {
                  n: selecionados.size,
                })
              : t.navegador.historicoRestaurarVazio}
          </Button>
          <div className="flex items-center gap-2">
            <Select
              value={periodo}
              onValueChange={(v) => setPeriodo(v as PeriodoLimpeza)}
            >
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ultima-hora">
                  {t.navegador.limparUltimaHora}
                </SelectItem>
                <SelectItem value="hoje">{t.navegador.limparHoje}</SelectItem>
                <SelectItem value="tudo">{t.navegador.limparTudo}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
              onClick={() => onLimpar(periodo)}
            >
              <Trash2 className="size-4" />
              {t.navegador.limparHistorico}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
