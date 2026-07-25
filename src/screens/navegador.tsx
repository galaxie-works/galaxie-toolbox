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
import { preencher, useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import { Compass, Globe, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AbaBrowser {
  id: string;
  nome: string;
  url: string;
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
    <div className="flex h-full items-center justify-center p-6">
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
  onAbrir,
  onNovaAba,
  onNavegar,
}: {
  abas: AbaBrowser[];
  ativa: string | null;
  onTrocar: (id: string) => void;
  onFechar: (id: string) => void;
  onAbrir: (app: AppM365) => void;
  onNovaAba: () => void;
  onNavegar: (url: string, nome: string) => void;
}) {
  const area = useRef<HTMLDivElement>(null);

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
    const aba = abas.find((a) => a.id === ativa);
    const r = medir();
    if (aba && r) browser.abrir(aba.id, aba.url, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa]);

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
        <div className="scrollbar-fina flex items-stretch gap-1 overflow-x-auto px-2 pt-2">
          {abas.map((aba) => {
            const app = porId(aba.id);
            const ativaAba = aba.id === ativa;
            return (
              <div
                key={aba.id}
                onClick={() => onTrocar(aba.id)}
                title={aba.nome}
                className={cn(
                  "group flex w-40 shrink-0 cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition-colors",
                  ativaAba
                    ? "border-border bg-background font-medium"
                    : "border-transparent text-muted-foreground hover:bg-accent/50"
                )}
              >
                {app ? (
                  <img
                    src={urlIcone(app)}
                    alt=""
                    className="size-4 shrink-0"
                    draggable={false}
                  />
                ) : (
                  <Globe className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{aba.nome}</span>
                <button
                  type="button"
                  aria-label={`Fechar ${aba.nome}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFechar(aba.id);
                  }}
                  className="grid size-4 shrink-0 place-items-center rounded opacity-60 hover:bg-foreground/10 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Nova aba"
          onClick={onNovaAba}
          className={cn(
            "m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
            "hover:bg-accent hover:text-foreground",
            ativa === null && abas.length > 0 && "bg-accent text-foreground"
          )}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {ativa === null ? (
        <div className="flex-1 overflow-hidden">
          <Launcher onAbrir={onAbrir} onNavegar={onNavegar} />
        </div>
      ) : (
        <div ref={area} className="relative flex-1 bg-background">
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin opacity-40" />
          </div>
        </div>
      )}
    </div>
  );
}
