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
import type { AbaBrowser } from "@/lib/navigator-tabs";
import { Badge } from "@/components/reui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { preencher, useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import {
  BedDouble,
  Coffee,
  Command as CommandIcon,
  Compass,
  Globe,
  Loader2,
  Moon,
  Pin,
  PinOff,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  onAbrir: (app: AppM365) => void;
  onNavegar: (url: string, nome: string) => void;
  onTrocar: (id: string) => void;
  onFechar: (id: string) => void;
  onNovaAba: () => void;
  onAlternarFixada: (id: string) => void;
  onDormir: (id: string) => void;
};

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

  const maisUsados = MAIS_USADOS.map((id) => APPS.find((a) => a.id === id)).filter(
    (a): a is AppM365 => a != null
  );
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
  const mostrarAcoes = modo === "omni" || modo === "acoes";
  const mostrarAbas = (modo === "omni" || modo === "abas") && abas.length > 0;
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

        {mostrarApps && (
          <>
            <CommandGroup heading={t.apps.maisUsados}>
              {maisUsados.map((app) => (
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

        {/* Histórico: grupo já desenhado; a fonte de dados chega na Story 5. */}
        {modo === "historico" && (
          <div className="p-1">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {t.navegador.grupoHistorico}
            </div>
            <div className="py-5 text-center text-sm text-muted-foreground">
              {t.navegador.historicoEmBreve}
            </div>
          </div>
        )}
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
  onAbrir,
  onNovaAba,
  onNavegar,
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
  onAbrir: (app: AppM365) => void;
  onNovaAba: () => void;
  onNavegar: (url: string, nome: string) => void;
}) {
  const { t } = useIdioma();
  const area = useRef<HTMLDivElement>(null);
  const activeTab = abas.find((tab) => tab.id === ativa);
  const sleepingCount = abas.filter((tab) => tab.estado === "dormindo").length;
  // Estado efêmero de UI (só quem lê é este componente): não pertence ao store.
  const [paletaAberta, setPaletaAberta] = useState(false);

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
    if (paletaAberta || !ativa) {
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
  }, [ativa, activeTab?.url, paletaAberta]);

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
    <div className="flex h-full w-full flex-col">
      {/* Barra de abas: rola na horizontal; o "+" fica fora da rolagem. */}
      <div className="flex items-stretch border-b border-border">
        <div
          className="scrollbar-fina flex items-stretch gap-1 overflow-x-auto px-2 pt-2"
          role="tablist"
          aria-label={t.navegador.abas}
        >
          {abas.map((aba) => {
            const app = porId(aba.id);
            const ativaAba = aba.id === ativa;
            const dormindo = aba.estado === "dormindo";
            const tabLabel = dormindo
              ? preencher(t.navegador.dormindoClique, { nome: aba.nome })
              : aba.fixada
                ? preencher(t.navegador.fixadaNome, { nome: aba.nome })
                : aba.nome;
            return (
              <ContextMenu key={aba.id}>
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
                      "group flex shrink-0 cursor-pointer items-center gap-2 rounded-t-md border border-b-0 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      aba.fixada ? "w-10 justify-center px-2" : "w-40 px-3",
                      ativaAba
                        ? "border-border bg-background font-medium"
                        : "border-transparent text-muted-foreground hover:bg-accent/50",
                      dormindo && "opacity-60",
                    )}
                  >
                    {dormindo ? (
                      <Moon className="size-4 shrink-0" aria-hidden="true" />
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
                    {aba.fixada ? (
                      <span className="sr-only">{tabLabel}</span>
                    ) : (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="min-w-0 flex-1 truncate">
                              {aba.nome}
                            </span>
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
                    {aba.fixada
                      ? t.navegador.desafixarAba
                      : t.navegador.fixarAba}
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
            );
          })}
        </div>
        {sleepingCount > 0 && (
          <Badge variant="info-light" className="my-2 shrink-0">
            <Moon />
            {preencher(t.navegador.dormindoTotal, { n: sleepingCount })}
          </Badge>
        )}
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

      {ativa === null ? (
        <div className="flex-1 overflow-hidden">
          <Launcher
            abas={abas}
            ativa={ativa}
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
        onAbrir={onAbrir}
        onNavegar={onNavegar}
        onTrocar={onTrocar}
        onFechar={onFechar}
        onNovaAba={onNovaAba}
        onAlternarFixada={onAlternarFixada}
        onDormir={onDormir}
      />
    </div>
  );
}
