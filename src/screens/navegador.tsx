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
import { preencher, useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import {
  BedDouble,
  Coffee,
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
 * Launcher do Cruiser — aparece quando não há aba ativa. A barra é uma omnibox:
 * busca aplicativo E navega na web (digita um endereço ou um termo). Mais
 * utilizados primeiro, depois as categorias em ordem alfabética.
 */
function Launcher({
  onAbrir,
  onNavegar,
}: {
  onAbrir: (app: AppM365) => void;
  onNavegar: (url: string, nome: string) => void;
}) {
  const { idioma, t } = useIdioma();
  const [q, setQ] = useState("");

  const maisUsados = MAIS_USADOS.map((id) => APPS.find((a) => a.id === id)).filter(
    (a): a is AppM365 => a != null
  );
  const alfabetica = (a: AppM365, b: AppM365) => a.nome.localeCompare(b.nome);

  // O que a barra faria se a pessoa desse Enter agora (só quando digitou algo).
  const rota = q.trim() ? browser.interpretar(q) : null;
  const rotuloRota = rota
    ? rota.tipo === "url"
      ? preencher(t.navegador.irPara, { nome: rota.nome })
      : preencher(t.navegador.pesquisar, { q: q.trim() })
    : "";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 p-6">
      <NavigatorHero titulo={t.navegador.titulo} subtitulo={t.navegador.subtitulo} />
      <Command
        // h-auto anula o h-full padrao do Command, senao o card estica pra
        // tela toda. Card flutuante, centralizado, sobre o fundo estrelado.
        className="h-auto w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl **:data-[selected=true]:bg-muted"
        // filtra por nome/resumo; o item de rota tem o proprio texto e casa com
        // qualquer coisa digitada (o value contem o q).
        filter={(value, search) =>
          value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
        }
      >
        <CommandInput
          value={q}
          onValueChange={setQ}
          placeholder={t.navegador.buscar}
        />
        <CommandList className="scrollbar-fina max-h-[380px]">
          <CommandEmpty>{t.navegador.vazio}</CommandEmpty>

          {rota && (
            <>
              <CommandGroup heading={t.navegador.navegar}>
                <CommandItem
                  value={`__rota__ ${q}`}
                  onSelect={() => onNavegar(rota.url, rota.nome)}
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

          <CommandGroup heading={t.apps.maisUsados}>
            {maisUsados.map((app) => (
              <ItemApp key={app.id} app={app} idioma={idioma} onAbrir={onAbrir} />
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
                    onAbrir={onAbrir}
                  />
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
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

  function medir(): browser.Retangulo | null {
    const el = area.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  useEffect(() => {
    if (!ativa) {
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
  }, [ativa, activeTab?.url]);

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
          <Launcher onAbrir={onAbrir} onNavegar={onNavegar} />
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
    </div>
  );
}
