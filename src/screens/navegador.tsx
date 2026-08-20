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
  MAIS_USADOS,
  porId,
  urlIcone,
  type AppM365,
} from "@/lib/apps";
// #720 (SH2): catálogo grande (~1795 apps) categorizado + ícones lazy.
import { chaveCategoria } from "@/lib/apps-catalog";
// #827 (SU1): fonte + render ÚNICOS do command (M365 curado + catálogo fundidos).
import {
  appsUnificadosPorCategoria,
  m365VisivelPara,
  type AppUnificado,
  APPS_UNIFICADOS,
} from "@/lib/apps-unificado";
import { AppIcon } from "@/components/app-icon";
// #721 (SH3): fixar/desafixar app no rail — estado no store, lógica pura.
import { useAppStore } from "@/store";
import { estaPinado, resolverPinados } from "@/lib/pinned-apps";
import { appVisivelPara, buscarUnificado } from "@/lib/apps-unificado-core";
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
  loadNavigatorPrefs,
  persistNavigatorPrefs,
  persistFaviconCache,
  NAVIGATOR_GROUP_COLORS,
  NAVIGATOR_GROUP_COLOR_ORDER,
  ehAbaInterna,
  type AbaBrowser,
  type NavigatorGroup,
  type NavigatorGroupColor,
  type NavigatorMembership,
  type TelaInterna,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { NAV, TELAS, type Tela } from "@/lib/navegacao";
import type { AppUser } from "@/lib/types";
import {
  appsQueCasam,
  subviewsQueCasam,
  TELAS_IR_PARA,
  type SubviewBridge,
} from "@/lib/aliases-nav";
import { UsersIcon } from "@/components/ui/users";
import { CalendarDaysIcon } from "@/components/ui/calendar-days";
import {
  BedDouble,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Compass,
  FolderMinus,
  FolderPlus,
  FolderTree,
  Globe,
  GripHorizontal,
  GripVertical,
  History,
  Loader2,
  MonitorSmartphone,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { BridgeIcon } from "@/components/ui/icons/marca-anim";
import { ShipIcon, type ShipIconHandle } from "@/components/ui/ship";
import { PirataIcon } from "@/components/ui/icons/marca/pirata";
import { PirateSkullIcon } from "@/components/ui/icons/marca/pirate-skull";
import { Kbd } from "@/components/ui/kbd";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";

import { ChromeNavegador } from "./chrome-navegador";
import { formatShortcut } from "@/components/ui/shortcut";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";

// #656 × #663 (RC): "Ir para" só oferece produtos VISÍVEIS no sidebar — filtra
// os `oculto` do NAV (astro/outlook no RC). Reversível junto com o flag: flipou
// o produto de volta no NAV, ele reaparece aqui também.
const OCULTOS_NAV = new Set<Tela>(
  NAV.flatMap((g) => g.itens)
    .flatMap((i) => i.filhos)
    .filter((f) => f.oculto)
    .map((f) => f.id),
);
const TELAS_IR_PARA_VISIVEIS: Tela[] = TELAS_IR_PARA.filter(
  (tela) => !OCULTOS_NAV.has(tela),
);

/**
 * #719 (SH1): ícone da aba interna (Bridge/Files/Remote) na strip e no rail —
 * mesmos glifos do rail do shell (SH0) pra fidelidade visual. Fallback = globo.
 */
function iconeTelaInterna(
  tela: TelaInterna | undefined,
  // #1150: o command lista as telas do GALAXIE ao lado dos apps M365, cujos
  // ícones Fluent são 20px — por isso o tamanho é parâmetro. `size` existe
  // separado da classe porque o `IconeAnim` dimensiona por style inline (a
  // classe sozinha não o alcança); os lucide estáticos vão só pela classe.
  tamanho: { classe: string; px: number } = { classe: "size-4", px: 16 },
): ReactNode {
  switch (tela) {
    case "control-room":
      return (
        <BridgeIcon className={cn(tamanho.classe, "shrink-0")} size={tamanho.px} />
      );
    case "arquivos":
      return (
        <FolderTree className={cn(tamanho.classe, "shrink-0 text-muted-foreground")} />
      );
    case "remote":
      return (
        <MonitorSmartphone
          className={cn(tamanho.classe, "shrink-0 text-muted-foreground")}
        />
      );
    default:
      return <Globe className={cn(tamanho.classe, "shrink-0 text-muted-foreground")} />;
  }
}

/**
 * #1150: as três telas do GALAXIE no command. O ícone delas tem que ser o MESMO
 * glifo do rail e da strip de abas (`iconeTelaInterna`) — antes caíam no
 * `AppIcon`, que serve o SVG estático de `public/app-icons/galaxie-*.svg`. O do
 * Bridge é um envelope genérico; o ícone real do Bridge é o LEME (ship-wheel)
 * animado. Dois símbolos diferentes pro mesmo app, na mesma tela.
 */
const TELA_GALAXIE: Record<string, TelaInterna> = {
  "galaxie-bridge": "control-room",
  "galaxie-files": "arquivos",
  "galaxie-remote": "remote",
};

/** Tamanho do glifo no command: casa com os ícones Fluent do M365 (20px). */
const TAMANHO_COMMAND = { classe: "size-5", px: 20 } as const;

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
  rotuloPrivada,
  semprePrivadoAtivo,
  onDesligarPrivado,
}: {
  titulo: string;
  subtitulo: string;
  privada?: boolean;
  rotuloPrivada?: string;
  semprePrivadoAtivo?: boolean;
  onDesligarPrivado?: () => void;
}) {
  const { t } = useIdioma();
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
      {privada ? (
        // Aba privada (#323): badge no lugar do subtítulo "Time to set sail",
        // combinando com a borda tracejada `border-info` da aba privada (#273).
        <Badge variant="info-light" className="mt-0.5">
          <PirateSkullIcon />
          {rotuloPrivada}
        </Badge>
      ) : (
        <SoftBlurIn className="text-[15px] text-muted-foreground" delay={300} stagger={14}>
          {subtitulo}
        </SoftBlurIn>
      )}
      {/* #326: quando "Private mode only" está ON, explicar por que TODA aba é
          privada + atalho pra desligar. */}
      {privada && semprePrivadoAtivo && (
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {t.navegador.privateOnlyMotivo}{" "}
          <button
            type="button"
            onClick={onDesligarPrivado}
            className="font-medium text-info underline-offset-2 hover:underline"
          >
            {t.navegador.privateOnlyDesligar}
          </button>
        </p>
      )}
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
  /** #827 SU2b: conta ativa — gate por capability esconde M365 não-suportado. */
  user: Pick<AppUser, "provider" | "accountKind"> | null;
  onAbrir: (app: AppM365) => void;
  onNavegar: (url: string, nome: string) => void;
  onTrocar: (id: string) => void;
  onFechar: (id: string) => void;
  onNovaAba: () => void;
  /** #922: abre uma aba nova em modo PRIVADO (mesma ação da tab strip / #273). */
  onNovaAbaPrivada: () => void;
  onAlternarFixada: (id: string) => void;
  onDormir: (id: string) => void;
  /** #656: navega pra outra Tela do app (canvas), pro grupo "Ir para". */
  onNavegarTela: (tela: Tela) => void;
  /** #657: deep-link numa sub-view do Bridge (abre control-room já em People/Agenda). */
  onIrParaBridgeView: (view: SubviewBridge) => void;
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
// #1152: EXPORTADO para teste. A `lumen` reprovou a 1a entrega porque os ACs do
// grupo Pinned nao tinham guarda — e nao tinham porque ninguem conseguia montar
// a paleta. Exportar para testar e preco justo: o defeito que ela achou (o
// command abrindo o app errado) so aparece com a paleta montada de verdade.
export function ConteudoPaleta({
  abas,
  ativa,
  favoritos,
  historico,
  user,
  className,
  autoFocus,
  onExecutou,
  onAbrir,
  onNavegar,
  onTrocar,
  onFechar,
  onNovaAba,
  onNovaAbaPrivada,
  onAlternarFixada,
  onDormir,
  onNavegarTela,
  onIrParaBridgeView,
}: AcoesPaleta & {
  className?: string;
  autoFocus?: boolean;
  onExecutou?: () => void;
}) {
  const { idioma, t } = useIdioma();
  const [q, setQ] = useState("");
  const { modo, termo } = lerPrefixo(q);
  // #721 (SH3): fixar/desafixar app do catálogo no rail. O estado vem do store;
  // o botão vive dentro do CommandItem, então para o clique de propagar (senão
  // abriria o app em vez de (des)fixar).
  const appsFixados = useAppStore((s) => s.appsFixados);
  const alternarFixado = useAppStore((s) => s.alternarFixado);

  // #271: quando a paleta pede foco (overlay Ctrl+K OU Launcher da aba vazia),
  // foca o input ao montar. O `autoFocus` do overlay já vinha do Radix Dialog; o
  // Launcher inline não focava — este ref garante o foco nos dois, robusto contra
  // a flakiness do autoFocus HTML em remount.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    // rAF: foca DEPOIS do paint — robusto contra a webview-hide/remount roubando
    // o foco na mesma tick (a corrida que deixava o input sem foco). O foco por
    // MONTAGEM cobre a regressão do #454: o Launcher é remontado a cada nova aba
    // (via `key` no NavegadorScreen), então este efeito re-dispara e o command
    // recebe foco mesmo quando já estávamos na aba vazia (sem esse remount,
    // `setAbaAtiva(null)` era no-op e o clique no "+" deixava o foco no botão).
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [autoFocus]);

  // "Mais acessados" REAL: contagem derivada do historico (spec §8.3). Sem
  // historico ainda (instalacao nova), cai na lista M365 curada — sem regressao.
  // #866: o "Mais usados"/"Mais acessados" também é gateado por provider — Google/
  // MS-pessoal não vê atalho M365 que não pode usar (ex.: SharePoint/OneDrive),
  // coerente com a lista unificada de baixo. Item web não-M365 não é gateado.
  const topAcessados = maisAcessados(historico, 9).filter((item) => {
    const app = appPorUrl(item.url);
    return !app || m365VisivelPara(app.id, user);
  });
  const maisUsadosFallback = MAIS_USADOS.map((id) =>
    APPS.find((a) => a.id === id),
  )
    .filter((a): a is AppM365 => a != null)
    .filter((a) => m365VisivelPara(a.id, user));
  // Grupo `#`: historico filtrado pelo termo, ja ordenado por recencia. Fatiado
  // para nao renderizar milhares de itens no cmdk.
  const historicoLista =
    modo === "historico" ? buscarHistorico(historico, termo).slice(0, 50) : [];

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

  // #656: apps da Galaxie/M365 que casam com o termo (apelidos + rótulo),
  // pro grupo "Ir para" — só no modo omni com texto.
  const telasIrPara =
    modo === "omni" && termo
      ? appsQueCasam(
          termo,
          TELAS_IR_PARA_VISIVEIS,
          {
            "control-room": t.navegador.aliasControlRoom,
            apps: t.navegador.aliasApps,
            onedrive: t.navegador.aliasOnedrive,
            outlook: t.navegador.aliasOutlook,
            navegador: t.navegador.aliasNavegador,
            astro: t.navegador.aliasAstro,
            configuracoes: t.navegador.aliasConfiguracoes,
          },
          (tela) => t.nav[TELAS[tela].titulo],
        )
      : [];

  // #657: sub-views do Bridge (People/Agenda) — só se o Bridge estiver visível
  // (respeita o `oculto` do #663) e no modo omni com texto.
  const subviewsIrPara =
    modo === "omni" && termo && !OCULTOS_NAV.has("control-room")
      ? subviewsQueCasam(
          termo,
          {
            people: t.navegador.aliasPeople,
            agenda: t.navegador.aliasAgenda,
          },
          (view) =>
            view === "people"
              ? t.controlRoom.peopleTitulo
              : t.controlRoom.agendaTitulo,
        )
      : [];

  const abaAtivaObj = abas.find((a) => a.id === ativa);
  const favoritosLinks = favoritosParaPalette(favoritos);
  const mostrarAcoes = modo === "omni" || modo === "acoes";
  const mostrarAbas = (modo === "omni" || modo === "abas") && abas.length > 0;
  const mostrarFavoritos = modo === "omni" && favoritosLinks.length > 0;
  const mostrarApps = modo === "omni";
  // #827 (SU1): LISTA ÚNICA (M365 curado + catálogo) por categoria, taxonomia
  // única. Sem busca = prévia por categoria (perf: não monta os ~1788 de uma vez);
  // ao buscar, filtra tudo por nome/categoria e mostra todos os matches.
  const PREVIA_POR_CATEGORIA = 6;
  // #824 (SU3): teto de resultados por categoria na BUSCA. Sem isto, um termo
  // amplo ("a") casa milhares de apps → milhares de CommandItem no DOM de uma vez
  // → lag ao digitar (mesma classe do #820, no command). O teto + a linha
  // "+N mais" bounda os nós ao viewport SEM quebrar a navegação por teclado do
  // cmdk (que precisa dos itens montados) — o DoD aceita capar em vez de
  // virtualizar. Com o teto, o double-filter do `value`+`termo` também passa a
  // operar em ≤14×N itens, deixando de ser furo.
  const MAX_BUSCA_POR_CATEGORIA = 10;
  const gruposUnificados = useMemo(
    () => appsUnificadosPorCategoria(termo || undefined, user),
    [termo, user],
  );
  // #877 (decisão do Wagner, 14/08): os apps do PRÓPRIO GALAXIE (Bridge/Files/
  // Remote) vêm ANTES do "Mais usados" — são a 1ª coisa que aparece ao abrir o
  // command (o "sempre primeiro" literal, acima da seção curada M365). Separo o
  // grupo "From GALAXIE" do resto das categorias (que seguem depois do topo).
  const grupoGalaxie = useMemo(
    () => gruposUnificados.find((g) => g.categoria === "From GALAXIE"),
    [gruposUnificados],
  );
  const gruposResto = useMemo(
    () => gruposUnificados.filter((g) => g.categoria !== "From GALAXIE"),
    [gruposUnificados],
  );

  // Abre um app da lista única (#827 SU1/SU2). Prioridade:
  // 1) core M365 que o app já faz NATIVO → abre a tela interna, não aba web
  //    (Outlook→Bridge, OneDrive/SharePoint→Files via Tela; Calendar→Agenda,
  //    People→People via sub-view do Bridge). A tela alvo já degrada por provider
  //    (#803), então roteia certo pra qualquer conta.
  // 2) M365 curado (sem nativo) → `onAbrir` (login-hint + histórico do App.tsx).
  // 3) resto → aba web pela URL.
  const abrirUnificado = (app: AppUnificado) => {
    if (
      app.nativo === "control-room" ||
      app.nativo === "arquivos" ||
      app.nativo === "remote"
    ) {
      onNavegarTela(app.nativo);
      return;
    }
    if (app.nativo === "agenda" || app.nativo === "people") {
      onIrParaBridgeView(app.nativo);
      return;
    }
    if (app.m365) {
      const m = porId(app.id);
      if (m) {
        onAbrir(m);
        return;
      }
    }
    onNavegar(app.url, app.name);
  };

  // #1152 (pedido do Wagner): grupo PINNED no topo do command. Fonte é a mesma
  // lista unificada de onde o pin tira o id — resolver contra outra coisa foi o
  // bug deste card. Sem fixado, o grupo não existe (nada de cabeçalho vazio).
  //
  // #1152 rework (achado da `lumen`): o grupo TAMBÉM passa pelo termo. Antes não
  // passava, e o efeito não era cosmético: `ItemUnificado` embute o termo no
  // `value` (para atravessar o filtro do cmdk, já que o match real acontece em
  // `appsUnificadosPorCategoria`), então um fixado casava SEMPRE — e, como o
  // grupo é o primeiro, buscar "excel" com o Outlook fixado punha o Outlook
  // ACIMA do Excel. Reuso `buscarUnificado`/`appVisivelPara`, os mesmos que
  // filtram as categorias: duas regras de match divergiriam com o tempo.
  const fixadosUnificados = useMemo(() => {
    const pinados = resolverPinados(appsFixados, APPS_UNIFICADOS);
    const casam = termo ? buscarUnificado(pinados, termo) : pinados;
    // Mesmo gate de provider das categorias: fixado que a conta atual não pode
    // usar (trocou de provider depois de fixar) não deve aparecer.
    return user === undefined ? casam : casam.filter((a) => appVisivelPara(a, user));
  }, [appsFixados, termo, user]);

  // Render de UMA categoria do command — reusado pelo grupo "From GALAXIE" (no
  // topo, #877) e pelas demais categorias. Extraído p/ não duplicar o corpo.
  const renderCategoria = (grupo: (typeof gruposUnificados)[number]) => {
    // #824: na busca, capa em MAX_BUSCA_POR_CATEGORIA (perf); sem busca, a prévia
    // curada. `ocultos` alimenta a linha "+N mais".
    const apps = termo
      ? grupo.apps.slice(0, MAX_BUSCA_POR_CATEGORIA)
      : grupo.apps.slice(0, PREVIA_POR_CATEGORIA);
    const ocultos = termo ? grupo.apps.length - apps.length : 0;
    return (
      <CommandGroup
        key={`cat-${grupo.categoria}`}
        heading={t.command[chaveCategoria(grupo.categoria)]}
      >
        {apps.map((app) => (
          <ItemUnificado
            key={`app-${app.id}`}
            app={app}
            termo={termo}
            fixado={estaPinado(appsFixados, app.id)}
            onSelecionar={() => executar(() => abrirUnificado(app))}
            onAlternarPin={() => alternarFixado(app.id)}
          />
        ))}
        {ocultos > 0 && (
          // #824: afordância honesta — mostra quantos ficaram de fora (não trunca
          // em silêncio). Não é CommandItem (não navegável).
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {preencher(t.navegador.maisResultados, { n: ocultos })}
          </div>
        )}
      </CommandGroup>
    );
  };

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

        {(telasIrPara.length > 0 || subviewsIrPara.length > 0) && (
          <>
            <CommandGroup heading={t.navegador.grupoIrPara}>
              {telasIrPara.map((tela) => {
                const Icone = TELAS[tela].icone;
                const nome = t.nav[TELAS[tela].titulo];
                return (
                  <CommandItem
                    // Inclui o termo pra passar pelo filtro do cmdk (que casa por
                    // `termo`); o match real já foi feito por `appsQueCasam`.
                    key={tela}
                    value={`irpara-${tela} ${termo}`}
                    onSelect={() => executar(() => onNavegarTela(tela))}
                    className="gap-2.5"
                  >
                    <Icone className="size-4 shrink-0 text-primary" />
                    <span className="truncate">
                      {preencher(t.navegador.irParaApp, { app: nome })}
                    </span>
                  </CommandItem>
                );
              })}
              {/* #657: deep-link nas sub-views do Bridge (People/Agenda). */}
              {subviewsIrPara.map((view) => {
                const Icone = view === "people" ? UsersIcon : CalendarDaysIcon;
                const rotulo =
                  view === "people"
                    ? t.navegador.irParaContatos
                    : t.navegador.irParaAgenda;
                return (
                  <CommandItem
                    key={`bridge-${view}`}
                    value={`irpara-bridge-${view} ${termo}`}
                    onSelect={() => executar(() => onIrParaBridgeView(view))}
                    className="gap-2.5"
                  >
                    <Icone size={16} className="shrink-0 text-primary" />
                    <span className="truncate">{rotulo}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

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
              {/* #922: aba privada, ao lado da normal — reusa a ação #273 (mesmo
                  ícone pirata do menu da tab strip). */}
              <CommandItem
                value={t.navegador.novaAbaPrivada}
                onSelect={() => executar(onNovaAbaPrivada)}
                className="gap-2.5"
              >
                <PirateSkullIcon className="size-4 shrink-0" />
                <span>{t.navegador.novaAbaPrivada}</span>
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
            {/* #877 (decisão do Wagner, 14/08): os apps do GALAXIE (Bridge/Files/
                Remote) ANTES do "Mais usados" — os produtos do app são a 1ª coisa
                ao abrir o command. Só renderiza se o grupo casa (na busca pode
                não existir). */}
            {/* #1152: PINNED no topo — antes do "From GALAXIE". Some quando
                não há fixado (sem cabeçalho órfão). Não deduplico o item da
                categoria de origem DE PROPÓSITO: o command é busca, e sumir o
                Outlook de "Produtividade" porque foi fixado quebraria a
                expectativa de quem procura por ele lá. */}
            {fixadosUnificados.length > 0 && (
              <>
                <CommandGroup heading={t.command.grupoFixados}>
                  {fixadosUnificados.map((app) => (
                    <ItemUnificado
                      key={`pin-${app.id}`}
                      app={app}
                      termo={termo}
                      fixado
                      onSelecionar={() => executar(() => abrirUnificado(app))}
                      onAlternarPin={() => alternarFixado(app.id)}
                    />
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {grupoGalaxie && (
              <>
                {renderCategoria(grupoGalaxie)}
                <CommandSeparator />
              </>
            )}
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

            {/* #827 (SU1): UMA seção por categoria, taxonomia única. Cada
                categoria 1x, cada app 1x (deduped). O grupo "From GALAXIE" já foi
                renderizado ACIMA do "Mais usados" (#877) — aqui vão as demais. */}
            {gruposResto.length > 0 && <CommandSeparator />}
            {gruposResto.map((grupo) => renderCategoria(grupo))}
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
        rotuloPrivada={t.navegador.modoPrivadoAtivo}
        semprePrivadoAtivo={loadNavigatorPrefs().semprePrivado}
        onDesligarPrivado={() =>
          window.dispatchEvent(new CustomEvent("galaxie:private-only-off"))
        }
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

/**
 * #827 (SU1): item ÚNICO da lista de apps do command — serve o M365 curado E o
 * catálogo. Ícone Fluent (`fluentIcon`) OU `<AppIcon>` lazy; nome sempre
 * `font-medium` + resumo opcional (M365) → altura/espaçamento consistentes (o
 * bug de render que o Wagner viu). O botão de fixar (#721) mora aqui, um lugar só.
 */
export function ItemUnificado({
  app,
  termo,
  fixado,
  onSelecionar,
  onAlternarPin,
}: {
  app: AppUnificado;
  termo: string;
  fixado: boolean;
  onSelecionar: () => void;
  onAlternarPin: () => void;
}) {
  const { idioma, t } = useIdioma();
  // #877: as telas do GALAXIE (id `galaxie-<x>`) têm nome LOCALIZADO via
  // `t.sidebar.<x>` (Files→Arquivos, Remote→Remoto); o resto usa o nome do app.
  const nome = app.id.startsWith("galaxie-")
    ? t.sidebar[app.id.slice(8) as "bridge" | "files" | "remote"]
    : app.name;
  return (
    <CommandItem
      // Inclui o termo pra passar pelo filtro do cmdk (o match real já foi feito
      // por `appsUnificadosPorCategoria(termo)`).
      value={`app-${app.id} ${nome} ${termo}`}
      onSelect={onSelecionar}
      className="group gap-2.5"
    >
      {TELA_GALAXIE[app.id] ? (
        // #1150: reusa o glifo do rail/strip. Vem ANTES do `fluentIcon` só por
        // clareza — as telas do GALAXIE não têm Fluent —, e os M365 que abrem
        // tela nativa (Outlook → control-room) seguem com o ícone da marca
        // deles, porque o mapa é por id do app, não pela tela de destino.
        iconeTelaInterna(TELA_GALAXIE[app.id], TAMANHO_COMMAND)
      ) : app.fluentIcon ? (
        <img
          src={app.fluentIcon}
          alt=""
          className="size-5 shrink-0"
          draggable={false}
        />
      ) : (
        <AppIcon id={app.id} name={nome} />
      )}
      {/* #1154: layout com posição PREVISÍVEL do resumo — o nome (flex-1, basis-0
          → peso de shrink 0) NUNCA encolhe/corta; o resumo é sempre right-aligned
          (padrão de command palette: nome à esquerda, hint à direita), então a
          posição não depende do comprimento do nome. Regra de truncamento
          EXPLÍCITA: em janela estreita quem cede é o RESUMO (min-w-0 + shrink +
          max-w-[45%] → trunca com "…"), o nome fica protegido. Sem resumo o nome
          segue flex-1 e nem ele nem o ícone "pulam" de posição. */}
      <span className="min-w-0 flex-1 truncate font-medium">{nome}</span>
      {app.resumo && (
        <span className="ml-auto hidden min-w-0 max-w-[45%] shrink truncate text-right text-xs text-muted-foreground sm:inline">
          {app.resumo[idioma]}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={fixado ? t.command.desafixar : t.command.pinar}
            onClick={(e) => {
              e.stopPropagation();
              onAlternarPin();
            }}
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded transition-colors hover:bg-foreground/10",
              fixado
                ? "text-primary"
                : "text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100",
            )}
          >
            {fixado ? (
              <PinOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {fixado ? t.command.desafixar : t.command.pinar}
        </TooltipContent>
      </Tooltip>
    </CommandItem>
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
  onNovaAbaFiles,
  onNovaAbaPrivada,
  onReabrirFechada,
  onNavegar,
  onNavegarTela,
  onIrParaBridgeView,
  user,
  historico,
  onRestaurarAbas,
  sessaoAnteriorQtd,
  onRestaurarSessao,
  onDispensarSessao,
  onLimparHistorico,
  modoPrivado,
  onAlternarModoPrivado,
  launcherNonce,
  visivel,
  tabStripSlot,
  chromeSlot,
  renderTelaInterna,
}: {
  abas: AbaBrowser[];
  ativa: string | null;
  /** #454: muda a cada nova aba — usado como `key` do Launcher pra remontá-lo e
   * re-focar o command mesmo quando já estávamos na aba vazia. */
  launcherNonce: number;
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
  /** #872: abre uma aba de Files NOVA (para o menu de contexto da aba de Files). */
  onNovaAbaFiles: () => void;
  onNovaAbaPrivada: () => void;
  onReabrirFechada: () => void;
  onNavegar: (url: string, nome: string) => void;
  /** #656: navega pra outra Tela do app (canvas) — grupo "Ir para" do command. */
  onNavegarTela: (tela: Tela) => void;
  /** #657: deep-link numa sub-view do Bridge (People/Agenda) — grupo "Ir para". */
  onIrParaBridgeView: (view: SubviewBridge) => void;
  /** #827 SU2b: conta ativa — gate por capability na lista de apps do command. */
  user: Pick<AppUser, "provider" | "accountKind"> | null;
  historico: HistoryEntry[];
  onRestaurarAbas: (entradas: { url: string; nome: string }[]) => void;
  sessaoAnteriorQtd: number;
  onRestaurarSessao: () => void;
  onDispensarSessao: () => void;
  onLimparHistorico: (periodo: PeriodoLimpeza) => void;
  modoPrivado: boolean;
  onAlternarModoPrivado: () => void;
  /** #719 (SH1): o Navigator é o shell keep-alive (sempre montado). `visivel`
   *  = ele é a tela ativa do app; quando false, esconde TODAS as webviews. */
  visivel: boolean;
  /** #876: nó da title bar (App.tsx) onde a barra de abas é teleportada (portal).
   *  Null enquanto o header não montou / em mock/teste → a barra cai inline. O
   *  estado + os efeitos de webview z-order ficam AQUI; só o DOM viaja. */
  tabStripSlot?: HTMLElement | null;
  /** #1290: nó do cluster de chrome da title bar (App.tsx), logo DEPOIS do
   *  sino. Os três ícones (favoritos/histórico/paleta) são teleportados pra
   *  cá pra que a ordem seja `sino · favoritos · histórico · paleta · tema ·
   *  avatar`. Null em mock/teste/web → caem inline na barra de abas. */
  chromeSlot?: HTMLElement | null;
  /** #719 (SH1): renderiza a tela React (Bridge/Files/Remote) de uma aba
   *  interna. `ativa` = a aba é a atual (dá foco/polling à tela certa). O App é
   *  dono das telas e do keep-alive; o Navigator só as encaixa no slot. */
  renderTelaInterna: (
    tela: TelaInterna,
    ativa: boolean,
    abaId: string,
  ) => ReactNode;
}) {
  const { t } = useIdioma();
  const area = useRef<HTMLDivElement>(null);
  const activeTab = abas.find((tab) => tab.id === ativa);
  const sleepingCount = abas.filter((tab) => tab.estado === "dormindo").length;
  // Estado efêmero de UI (só quem lê é este componente): não pertence ao store.
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  // #275 rework: snapshot (data URL JPEG) da aba mostrado por baixo do overlay
  // pra o conteúdo não sumir quando a webview é escondida. Null = sem overlay.
  const [snapshotOverlay, setSnapshotOverlay] = useState<string | null>(null);
  // #358 → #1163/#1179: o window-event `galaxie:webview-ceder` MORREU. Ele existia
  // porque overlays do app shell (fora da árvore do Provider antigo) não tinham
  // como registrar; o #1163 (D1/D2) pôs a conta no store — qualquer overlay, em
  // qualquer lugar, registra pelo primitivo — e o #1179 trocou a última exceção
  // (tooltip do sidebar colapsado) pela REGRA de geometria. Sem produtores, o
  // listener era mecanismo morto: removido em vez de mantido "por precaução".

  // Z-order (#275): conta os overlays DOM abertos SOBRE a webview (menus de
  // contexto, dropdowns da barra, diálogos). Enquanto houver algum, a webview
  // fica escondida para não cortar o overlay — mesmo padrão do #174 (paleta).
  // #1163 (D1): a conta ERA um useState local exposto por `OcultarWebviewContext`
  // (default no-op → Furo 1; Provider abaixo do header → Furo 3). Agora vive no
  // store e os PRIMITIVOS se registram sozinhos (D2) — aqui só LEMOS a conta.
  const overlaysWebview = useAppStore((s) => s.overlaysWebview);
  // #1179: publicação da região da webview (ver o efeito lá embaixo).
  const definirWebviewRect = useAppStore((s) => s.definirWebviewRect);

  // #275 (regressão): os menus de contexto de aba/grupo escondem a webview.
  // Rastreamos UM menu aberto por vez (o Radix já só deixa um) por uma chave
  // estável, para poder controlá-los (`open=`) e, num efeito, LIMPAR a chave se o
  // dono (aba/grupo) sumir. A conta em si é do store: o `ContextMenu` controlado se
  // registra sozinho (D2, caminho controlado) e o cleanup do primitivo libera a
  // conta se o chip desmontar com o menu aberto — a auto-cura anti-tela-preta.
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
  // #307 + #856: visibilidade da barra de favoritos. Agora togglada por um ÍCONE
  // dedicado na toolbar do Navigator (+ Ctrl/Cmd+Shift+B, convenção de browser) e
  // pela pref do Settings>Navigator>Favorites — as duas escrevem a MESMA pref,
  // então ficam em sync. Escondida por padrão (o default da pref). O toggle da
  // toolbar persiste na hora (mesmo padrão do `railColapsado`).
  const [mostrarBarraFav, setMostrarBarraFav] = useState(
    () => loadNavigatorPrefs().mostrarBarraFav,
  );
  const alternarBarraFav = useCallback(() => {
    setMostrarBarraFav((v) => {
      const proximo = !v;
      persistNavigatorPrefs({
        ...loadNavigatorPrefs(),
        mostrarBarraFav: proximo,
      });
      return proximo;
    });
  }, []);
  // #318 S2: rail lateral de pinned tabs; colapso persistido em NavigatorPrefs.
  const [railColapsado, setRailColapsado] = useState(
    () => loadNavigatorPrefs().railPinsColapsado,
  );
  const alternarRail = () =>
    setRailColapsado((v) => {
      const proximo = !v;
      persistNavigatorPrefs({
        ...loadNavigatorPrefs(),
        railPinsColapsado: proximo,
      });
      return proximo;
    });
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
    // #872: aba de Files → o hover mostra o CAMINHO completo (o chip já traz
    // "Files - <local>" truncado). As outras abas mantêm o próprio label.
    const tabTooltip =
      ehAbaInterna(aba) && aba.tela === "arquivos" && aba.caminhoLocal
        ? aba.caminhoLocal
        : tabLabel;
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
                <PirateSkullIcon className="size-4 shrink-0 text-info" />
              ) : ehAbaInterna(aba) ? (
                iconeTelaInterna(aba.tela)
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
                    <TooltipContent>{tabTooltip}</TooltipContent>
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
                    <TooltipContent>
                      <ShortcutTooltip
                        label={t.navegador.fecharAba}
                        shortcut={{ key: "W", primary: true }}
                      />
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            {/* #872: menu POR TIPO de aba — a aba de Files ganha "Nova guia do
                Files" no topo (abre outra aba de Files no This PC). As ações
                comuns de aba (fixar/dormir/fechar…) seguem abaixo pra todas. */}
            {ehAbaInterna(aba) && aba.tela === "arquivos" && (
              <>
                <ContextMenuItem className="gap-2" onClick={onNovaAbaFiles}>
                  <FolderTree />
                  {t.navegador.novaGuiaFiles}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
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
        {/* #360: sem o pino estático por aba (o badge "Pinned" do grupo já
            marca); no hover, um botão de DESAFIXAR com tooltip. */}
        {aba.fixada && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t.navegador.desafixarAba}
                onClick={(event) => {
                  event.stopPropagation();
                  onAlternarFixada(aba.id);
                }}
                className="absolute -right-0.5 -bottom-0.5 z-20 grid size-4 place-items-center rounded-full border border-background bg-background text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/chip:opacity-100"
              >
                <PinOff className="size-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t.navegador.desafixarAba}
            </TooltipContent>
          </Tooltip>
        )}
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

  // #1290: um objeto só pros ícones de chrome, porque eles são renderizados em
  // DOIS lugares (portal do `App.tsx` quando há slot, inline aqui quando não há)
  // — e duas listas de props seria a chance de uma divergir da outra.
  const propsChrome = {
    mostrarBarraFav,
    onAlternarBarraFav: alternarBarraFav,
    historicoAberto,
    onAlternarHistorico: () => setHistoricoAberto((v) => !v),
    onAbrirPaleta: focarOmnibox,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F5 / Ctrl+R — recarrega a PÁGINA da aba (webview-filha), NÃO o app (#310).
      // preventDefault mata o reload default do WebView2 do app (o bug "amador").
      if (
        e.key === "F5" ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r")
      ) {
        e.preventDefault();
        if (ativa) void browser.recarregar(ativa);
        return;
      }
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
      // #856: Ctrl/Cmd+Shift+B — liga/desliga a barra de favoritos.
      if (mod && e.shiftKey && tecla === "b") {
        e.preventDefault();
        alternarBarraFav();
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
    alternarBarraFav,
    focarComandoInline,
    focarOmnibox,
    onNovaAba,
    onNovaAbaPrivada,
    onReabrirFechada,
    onFechar,
    onTrocar,
  ]);

  // #272 S2 (fecha #324): atalhos digitados com foco DENTRO da webview-filha são
  // capturados por um accelerator nativo (Rust) e chegam como evento Tauri.
  // Re-disparamos um keydown SINTÉTICO no window pra reusar EXATAMENTE o handler
  // acima — zero duplicação da lógica de atalhos. No mock/web o import falha e
  // cai no catch (a ponte nativa não existe).
  useEffect(() => {
    let vivo = true;
    let desescutar: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen<{
          key: string;
          ctrl: boolean;
          shift: boolean;
          alt: boolean;
        }>("navigator-atalho", (evento) => {
          const { key, ctrl, shift, alt } = evento.payload;
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              ctrlKey: ctrl,
              shiftKey: shift,
              altKey: alt,
              bubbles: true,
            }),
          );
        });
        if (vivo) desescutar = off;
        else off();
      } catch {
        // Sem ponte nativa (mock/web): nada a escutar.
      }
    })();
    return () => {
      vivo = false;
      desescutar?.();
    };
  }, []);

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
    // #719 (SH1) P0: o Navigator é keep-alive (sempre montado). Quando NÃO é a
    // tela visível do app, ou a aba ativa é INTERNA (React, sem webview), toda
    // webview some. Gatilho TRANSIENTE — pelo `visivel` e pelo TIPO da aba ativa,
    // nunca por estado persistente (senão a webview nunca reabre). Sem snapshot:
    // aba interna não tem webview pra congelar, e escondida-por-tela é instantânea.
    const abaInterna = activeTab != null && ehAbaInterna(activeTab);
    if (!visivel || abaInterna) {
      if (snapshotOverlay) setSnapshotOverlay(null);
      browser.esconderTodas();
      return;
    }
    // #1163/#1179: UMA conta, no store. Os primitivos de overlay se registram
    // sozinhos (D2) e os tooltips entram pela regra de geometria (#1179) — não há
    // mais canal paralelo por window-event.
    const overlayAtivo = paletaAberta || overlaysWebview > 0;
    if (overlayAtivo || !ativa) {
      // #275 rework: ANTES de esconder, tira um snapshot da aba ativa e o mostra
      // como imagem sob o overlay (conteúdo congela, não some). Só uma vez por
      // abertura (guard `!snapshotOverlay`). No mock o snapshot vem null e cai no
      // comportamento antigo (esconde). Esconder acontece de qualquer forma.
      if (ativa && activeTab && !snapshotOverlay) {
        void browser
          .snapshot(ativa)
          .then((uri) => {
            if (uri) setSnapshotOverlay(uri);
          })
          .catch(() => {})
          .finally(() => browser.esconderTodas());
      } else {
        browser.esconderTodas();
      }
      return;
    }
    // Overlay fechou: remove o snapshot e revela/reposiciona a webview real.
    if (snapshotOverlay) setSnapshotOverlay(null);
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
    // Deps são a lista curada dos sinais que DEVEM reposicionar/reabrir a webview.
    // Depender do `activeTab` inteiro ou dos helpers estáveis (browser/medir/
    // onReativada) faria a webview nativa piscar a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa, activeTab?.url, activeTab?.tipo, visivel, paletaAberta, overlaysWebview, snapshotOverlay]);

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

  // #1179: publica no store a REGIÃO que a webview ocupa. É o dado que torna a
  // regra do tooltip (*a caixa cruza o retângulo da webview?*) decidível de
  // qualquer lugar da árvore — o `TooltipContent` é global e não conhece o
  // Navigator. Publica a região quando há webview EM JOGO (tela visível + aba web
  // ativa), mesmo que ela esteja escondida por um overlay: é a área que ela ocupa,
  // não "está pintando agora" — assim um tooltip já aberto não muda de veredito no
  // meio da vida dele. Fora disso publica `null` ⇒ nenhum tooltip aciona nada.
  useEffect(() => {
    const el = area.current;
    const abaInterna = activeTab != null && ehAbaInterna(activeTab);
    if (!visivel || abaInterna || ativa === null || !el) {
      definirWebviewRect(null);
      return;
    }
    const publicar = () => definirWebviewRect(medir());
    publicar();
    const ro = new ResizeObserver(publicar);
    ro.observe(el);
    window.addEventListener("resize", publicar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publicar);
      definirWebviewRect(null);
    };
    // Mesma lista curada do efeito de z-order acima (`medir` é local e estável na
    // prática; depender dele re-observaria a cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel, ativa, activeTab?.tipo, definirWebviewRect]);

  useEffect(() => {
    return () => {
      browser.esconderTodas();
    };
  }, []);

  // #318 S2: rail lateral colapsível das pinned tabs (semente de Workspaces).
  // Só aparece quando há abas fixadas. Encolhe a área de conteúdo → o
  // ResizeObserver da `area` reposiciona a webview automaticamente. Colapsado =
  // só favicons; expandido = ícone + nome. Clicar foca a aba.
  const renderPinRail = () => {
    const pinadas = abas.filter((aba) => aba.fixada);
    if (pinadas.length === 0) return null;

    const iconeDaAba = (aba: AbaBrowser) => {
      if (ehAbaInterna(aba)) return iconeTelaInterna(aba.tela);
      const app = porId(aba.id);
      if (app)
        return (
          <img src={urlIcone(app)} alt="" className="size-4 shrink-0" draggable={false} />
        );
      const fav = !aba.privada ? faviconDaAba(aba) : undefined;
      if (fav)
        return (
          <img src={fav} alt="" className="size-4 shrink-0 rounded-[3px]" draggable={false} />
        );
      return <Globe className="size-4 shrink-0 text-muted-foreground" />;
    };

    if (railColapsado) {
      return (
        <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/30 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={alternarRail}
                aria-label={t.navegador.railPinsExpandir}
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t.navegador.railPinsExpandir}</TooltipContent>
          </Tooltip>
          {pinadas.map((aba) => (
            <Tooltip key={aba.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onTrocar(aba.id)}
                  aria-label={aba.nome}
                  aria-current={aba.id === ativa}
                  className={cn(
                    "grid size-8 place-items-center rounded-md",
                    aba.id === ativa
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {iconeDaAba(aba)}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{aba.nome}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      );
    }

    return (
      <div className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Pin className="size-3.5" />
            {t.navegador.railPinsTitulo}
          </span>
          <button
            type="button"
            onClick={alternarRail}
            aria-label={t.navegador.railPinsColapsar}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {pinadas.map((aba) => (
              <div
                key={aba.id}
                className={cn(
                  "group/pin flex items-center gap-1 rounded-md pr-1 text-sm",
                  aba.id === ativa
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onTrocar(aba.id)}
                  aria-current={aba.id === ativa}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {iconeDaAba(aba)}
                  <span className="min-w-0 flex-1 truncate">{aba.nome}</span>
                </button>
                {/* #360: unpin no hover + x pra fechar, com tooltip. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t.navegador.desafixarAba}
                      onClick={() => onAlternarFixada(aba.id)}
                      className="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/pin:opacity-100"
                    >
                      <PinOff className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.navegador.desafixarAba}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t.navegador.fecharAba}
                      onClick={() => onFechar(aba.id)}
                      className="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/pin:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.navegador.fecharAba}
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* #876: a barra de abas vive na TITLE BAR — teleportada pro `tabStripSlot`
          (App.tsx). Sem slot (mock/teste/web) cai inline aqui, comportamento
          antigo. O estado (grupos/menus/favicons) e os efeitos de webview z-order
          seguem neste componente; só o DOM da barra viaja pelo portal. */}
      {(() => {
        const barraAbas = (
      <div className="flex min-w-0 flex-1 items-stretch">
        <div
          className="scrollbar-fina flex min-w-0 items-stretch gap-2 overflow-x-auto px-2 pt-2"
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
              <div key={lane.tipo} className="flex items-stretch gap-1">
                {/* #360: badge do grupo "Pinned" (em vez do pino por aba). */}
                {lane.tipo === "pins" && (
                  <span className="my-1 flex shrink-0 items-center gap-1 self-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <Pin className="size-3" />
                    {t.navegador.railPinsTitulo}
                  </span>
                )}
                <Sortable
                  strategy="horizontal"
                  value={lane.abas}
                  onValueChange={reordenarLaneAbas}
                  getItemValue={(a) => a.id}
                  className="flex items-stretch gap-1"
                >
                  {lane.abas.map((aba) => renderChip(aba, lane.tipo === "pins"))}
                </Sortable>
              </div>
            );
          })}
        </div>
        {/* "+" logo após as abas (convenção de navegador); o spacer empurra os
            ícones (history/command) pra direita, fora do caminho do "+" (#277). */}
        {loadNavigatorPrefs().semprePrivado ? (
          // #326: "Private mode only" ON → o "+" abre DIRETO uma aba privada,
          // sem o menu (normal/privada). Cor info reforça que está privado.
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t.navegador.novaAbaPrivada}
                onClick={onNovaAbaPrivada}
                className={cn(
                  "m-1 grid size-8 shrink-0 place-items-center rounded-md text-info",
                  "hover:bg-accent",
                  ativa === null && abas.length > 0 && "bg-accent"
                )}
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t.navegador.novaAbaPrivada}</TooltipContent>
          </Tooltip>
        ) : (
        // #1163 D2: o DropdownMenu já cede a webview sozinho — sem onOpenChange manual.
        <DropdownMenu>
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
          <DropdownMenuContent
            align="start"
            // #454: ao fechar, o Radix devolve o foco ao trigger ("+") — o que
            // roubava o foco do command da aba nova. Prevenimos o auto-focus e
            // deixamos o `galaxie:foco-launcher` (de `abrirAbaVazia`) focar o input.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuItem className="gap-2" onSelect={onNovaAba}>
              <Plus className="size-4" />
              {t.navegador.novaAba}
              <Kbd className="ml-auto">
                {formatShortcut({ key: "T", primary: true })}
              </Kbd>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onSelect={onNovaAbaPrivada}>
              <PirateSkullIcon className="size-4" />
              {t.navegador.novaAbaPrivada}
              <Kbd className="ml-auto">
                {formatShortcut({ key: "N", primary: true, shift: true })}
              </Kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
        {/* #876: a faixa vazia entre as tabs e os ícones arrasta a janela. */}
        <div className="flex-1" aria-hidden="true" data-tauri-drag-region />
        {sleepingCount > 0 && (
          <Badge variant="info-light" className="my-2 shrink-0">
            <Moon />
            {preencher(t.navegador.dormindoTotal, { n: sleepingCount })}
          </Badge>
        )}
        {modoPrivado && (
          <Badge variant="info-light" className="my-2 shrink-0">
            <PirateSkullIcon />
            {t.navegador.modoPrivadoAtivo}
          </Badge>
        )}
        {/* #1290: os três ícones de chrome saíram daqui — agora o `App.tsx`
            manda na ordem da title bar e eles viajam pro slot dele, à
            DIREITA do sino. Sem slot (mock/teste/web) caem inline aqui,
            como sempre — mesmo padrão da barra de abas. */}
        {chromeSlot ? null : <ChromeNavegador {...propsChrome} />}
      </div>
        );
        return tabStripSlot
          ? createPortal(barraAbas, tabStripSlot)
          : barraAbas;
      })()}

      {/* #1290: os ícones de chrome vão pro slot do `App.tsx` (à direita do
          sino). Sem slot eles já saíram inline junto da barra de abas. */}
      {chromeSlot ? createPortal(<ChromeNavegador {...propsChrome} />, chromeSlot) : null}

      {/* Oferecer restaurar a sessão anterior (#274) — banner discreto, sem
          restaurar automático; some ao restaurar ou dispensar. */}
      {sessaoAnteriorQtd > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-info/10 px-3 py-1.5 text-sm">
          <RotateCcw className="size-4 shrink-0 text-info" />
          <span className="min-w-0 flex-1 truncate text-info-foreground">
            {preencher(t.navegador.sessaoAnterior, { n: sessaoAnteriorQtd })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0"
            onClick={onRestaurarSessao}
          >
            {t.navegador.sessaoRestaurar}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 text-muted-foreground"
            onClick={onDispensarSessao}
          >
            {t.navegador.sessaoDispensar}
          </Button>
        </div>
      )}

      {/* Barra de favoritos (#176): reabre rápido + gerencia. Visibilidade
          controlada no Settings>Navigator>Favorites (#307). */}
      {mostrarBarraFav && (
        <BarraFavoritos
          favoritos={favoritos}
          onMudar={setFavoritos}
          onNavegar={onNavegar}
          abaAtiva={
            activeTab ? { url: activeTab.url, nome: activeTab.nome } : undefined
          }
        />
      )}

      {/* #318 S2: rail das pinned tabs à esquerda + o conteúdo. #719 (SH1): o
          conteúdo passa a ser um stack de camadas absolutas — Launcher (aba
          vazia), telas internas (React, keep-alive: uma por aba interna, só a
          ativa visível) e o host da webview (aba web). O rail encolhe a área; o
          ResizeObserver da `area` reposiciona a webview. */}
      <div className="flex min-h-0 flex-1">
        {renderPinRail()}
        <div className="relative min-h-0 flex-1">
          {ativa === null && (
            <div className="absolute inset-0 overflow-hidden">
              <Launcher
                key={launcherNonce}
                abas={abas}
                ativa={ativa}
                favoritos={favoritos}
                historico={historico}
                user={user}
                privada={modoPrivado}
                onAbrir={onAbrir}
                onNavegar={onNavegar}
                onTrocar={onTrocar}
                onFechar={onFechar}
                onNovaAba={onNovaAba}
                onNovaAbaPrivada={onNovaAbaPrivada}
                onAlternarFixada={onAlternarFixada}
                onDormir={onDormir}
                onNavegarTela={onNavegarTela}
                onIrParaBridgeView={onIrParaBridgeView}
              />
            </div>
          )}

          {/* #719 (SH1): telas internas keep-alive. Cada aba interna aberta
              mantém sua tela MONTADA (só escondida por CSS quando não é a ativa),
              preservando o estado do Bridge/Files entre trocas de aba (#25). A
              tela recebe `ativa` pra pausar/retomar polling (control-room). */}
          {abas.filter((aba) => ehAbaInterna(aba)).map((aba) => {
            const ativaAba = aba.id === ativa;
            return (
              <div
                key={aba.id}
                className={cn(
                  // #913: respiro no topo do content area da aba interna (era
                  // `pt-0` → a tela embutida colava na title bar/tabs). Padding
                  // uniforme (p-4) resolvido NO HOST → vale pra Bridge/Files/Remote.
                  "absolute inset-0 min-h-0 p-4",
                  ativaAba ? "flex flex-col" : "hidden",
                )}
              >
                {renderTelaInterna(aba.tela as TelaInterna, ativaAba, aba.id)}
              </div>
            );
          })}

          {/* Host da webview: só quando a aba ativa é WEB (edge-to-edge, sem
              padding). Aba interna esconde a webview (P0, efeito acima). */}
          {ativa !== null && (!activeTab || !ehAbaInterna(activeTab)) && (
            <div ref={area} className="absolute inset-0 bg-background">
              {/* #275 rework: snapshot da webview por baixo do overlay (conteúdo
                  congela em vez de sumir quando a webview nativa é escondida). */}
              {snapshotOverlay && (
                <img
                  src={snapshotOverlay}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left-top"
                />
              )}
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
        </div>
        {/* #874: History DOCADO à direita (não Sheet/scrim) — como um irmão da
            área de conteúdo, encolhe o `area` → o ResizeObserver reposiciona a
            webview, sem sobrepor com overlay escuro. Resto da UI segue interativo.
            Mesmo padrão do Details/InspectorPane (#854) e do pin rail (à esq). */}
        {historicoAberto && (
          <PainelHistorico
            onFechar={() => setHistoricoAberto(false)}
            historico={historico}
            onNavegar={onNavegar}
            onRestaurar={onRestaurarAbas}
            onLimpar={onLimparHistorico}
          />
        )}
      </div>

      {/* Overlay global (Ctrl/Cmd+K) por cima da aba viva. */}
      <PaletaOverlay
        aberta={paletaAberta && ativa !== null}
        onAberturaMudou={setPaletaAberta}
        abas={abas}
        ativa={ativa}
        favoritos={favoritos}
        historico={historico}
        user={user}
        onAbrir={onAbrir}
        onNavegar={onNavegar}
        onTrocar={onTrocar}
        onFechar={onFechar}
        onNovaAba={onNovaAba}
        onNovaAbaPrivada={onNovaAbaPrivada}
        onAlternarFixada={onAlternarFixada}
        onDormir={onDormir}
        onNavegarTela={onNavegarTela}
        onIrParaBridgeView={onIrParaBridgeView}
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
  // z-order (#275): esconder a webview enquanto o diálogo estiver aberto agora é
  // por construção — o `<Dialog>` (D2) se registra sozinho pelo `open`. Nada aqui.

  // Sincroniza o input ao abrir/trocar de grupo.
  useEffect(() => {
    if (grupo) setNome(grupo.nome);
    // Re-sincroniza só quando o id do grupo muda (abrir/trocar). Reagir a
    // `grupo.nome` sobrescreveria a edição em andamento do usuário. `setNome` é
    // estável (setter de useState).
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
function PainelHistorico({
  onFechar,
  historico,
  onNavegar,
  onRestaurar,
  onLimpar,
}: {
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
  // #874: painel DOCADO — NÃO esconde a webview (o próprio layout a encolhe via o
  // ResizeObserver do `area`). Nada de `useOcultarWebviewEnquantoAberto` aqui:
  // aquilo era o comportamento modal/scrim que a issue removeu. O pai monta/
  // desmonta este painel pelo toggle (por isso não há mais estado `aberto`).
  const lista = useMemo(() => buscarHistorico(historico, q), [historico, q]);
  // #177 rework: sem NENHUM histórico gravado, esconder Search + botões e mostrar
  // o empty state padrão do app (Empty/reui). Busca sem resultado (mas com
  // histórico) mantém o Search + a msg inline.
  const semHistorico = historico.length === 0;
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [idioma],
  );

  // #874: o pai desmonta o painel ao fechar (toggle), então a seleção zera
  // sozinha no unmount — sem efeito de limpar-ao-fechar.
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
    <div className="flex w-96 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{t.navegador.historicoTitulo}</h2>
        <button
          type="button"
          aria-label={t.navegador.historicoFechar}
          onClick={onFechar}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

        {!semHistorico && (
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
        )}

        {/* #177 rework: sem histórico → empty state padrão do app (Empty/reui),
            sem Search nem botões. */}
        {semHistorico ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History />
                </EmptyMedia>
                <EmptyTitle>{t.navegador.historicoTitulo}</EmptyTitle>
                <EmptyDescription>
                  {t.navegador.historicoVazio}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
        /* #311: scrollbar do padrão do app (ScrollArea reui), não a do OS. */
        <ScrollArea className="min-h-0 flex-1">
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
        </ScrollArea>
        )}

        {!semHistorico && (
        <div className="flex shrink-0 flex-col gap-3 border-t border-border p-4">
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
        </div>
        )}
    </div>
  );
}
