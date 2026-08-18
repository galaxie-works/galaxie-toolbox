import { useEffect, useState } from "react";
import {
  ChevronDown,
  Folder,
  FolderPlus,
  Globe,
  Link2,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  achatarLinks,
  criarPasta,
  inserirFavorito,
  novoFavoritoId,
  removerFavorito,
  renomearFavorito,
  type Favorito,
} from "@/lib/navigator-bookmarks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
// #1163 D2: os dropdowns/menus/diálogos daqui cedem a webview do Navigator sozinhos
// (o registro vive nos primitivos de `@/components/ui/*`) — sem hook manual.

/**
 * Favoritos do Navigator (#176, opção C — mínimo honesto).
 *
 * Gerenciamento manual, sem tocar no perfil do navegador (bloqueado por EDR e
 * comportamento de infostealer): adicionar a aba ativa, **colar/adicionar uma
 * URL** e **arrastar um link** pra barra, além de pastas/renomear/remover. O
 * import automático de outros navegadores fica pra um épico à parte (ponte por
 * extensão), fora daqui.
 */

/** Normaliza uma entrada em URL http(s) válida (ou `null`). Prefixa https:// se
 *  faltar esquema; exige um host com ponto pra descartar texto solto. */
function normalizarUrl(entrada: string): string | null {
  const limpo = entrada.trim();
  if (!limpo) return null;
  const comEsquema = /^https?:\/\//i.test(limpo) ? limpo : `https://${limpo}`;
  try {
    const u = new URL(comEsquema);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Nome padrão amigável a partir da URL (hostname sem www). */
function nomeDeUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** Extrai a primeira URL válida de um evento de drop (uri-list ou texto). */
function urlDoDrop(dt: DataTransfer): string | null {
  const bruto = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
  const linha = bruto
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  return linha ? normalizarUrl(linha) : null;
}

/** Itens de um menu de pasta (recursivo): link abre, subpasta abre submenu. */
function ItensPasta({
  itens,
  onAbrir,
  onRemover,
  rotuloRemover,
}: {
  itens: Favorito[];
  onAbrir: (fav: Favorito) => void;
  onRemover: (id: string) => void;
  rotuloRemover: string;
}) {
  if (itens.length === 0) {
    return <DropdownMenuItem disabled>—</DropdownMenuItem>;
  }
  return (
    <>
      {itens.map((fav) =>
        fav.tipo === "pasta" ? (
          <DropdownMenuSub key={fav.id}>
            <DropdownMenuSubTrigger className="gap-2">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{fav.nome}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-64">
              <ItensPasta
                itens={fav.filhos ?? []}
                onAbrir={onAbrir}
                onRemover={onRemover}
                rotuloRemover={rotuloRemover}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            key={fav.id}
            className="group/fav gap-2"
            onSelect={() => onAbrir(fav)}
          >
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{fav.nome}</span>
            <button
              type="button"
              aria-label={rotuloRemover}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemover(fav.id);
              }}
              className="grid size-4 shrink-0 place-items-center rounded opacity-0 hover:bg-foreground/10 group-hover/fav:opacity-70"
            >
              <X className="size-3" />
            </button>
          </DropdownMenuItem>
        ),
      )}
    </>
  );
}

/**
 * Barra de favoritos do Navigator: abre rápido os links salvos e concentra o
 * gerenciamento (adicionar da aba ativa, adicionar/colar URL, nova pasta,
 * renomear, remover). Aceita arrastar um link pra cima da barra. Estado dos
 * favoritos vem por prop; as mudanças sobem por `onMudar`.
 */
export function BarraFavoritos({
  favoritos,
  onMudar,
  onNavegar,
  abaAtiva,
}: {
  favoritos: Favorito[];
  onMudar: (proximo: Favorito[]) => void;
  onNavegar: (url: string, nome: string) => void;
  abaAtiva?: { url: string; nome: string };
}) {
  const { t } = useIdioma();
  const [urlAberto, setUrlAberto] = useState(false);
  const [renomeando, setRenomeando] = useState<Favorito | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const podeAdicionarAba = Boolean(abaAtiva && /^https?:\/\//i.test(abaAtiva.url));

  const adicionarAbaAtiva = () => {
    if (!abaAtiva) return;
    onMudar(
      inserirFavorito(favoritos, {
        id: novoFavoritoId(),
        tipo: "link",
        nome: abaAtiva.nome || abaAtiva.url,
        url: abaAtiva.url,
      }),
    );
  };

  const adicionarUrl = (url: string, nome: string) => {
    onMudar(
      inserirFavorito(favoritos, {
        id: novoFavoritoId(),
        tipo: "link",
        nome: nome || nomeDeUrl(url),
        url,
      }),
    );
  };

  const novaPasta = () => {
    const { favoritos: proximo } = criarPasta(
      favoritos,
      t.navegador.favPastaNomePadrao,
    );
    onMudar(proximo);
  };

  // Drag-and-drop de um link (do próprio app, de outra aba/DOM ou de fora) pra
  // dentro da barra — só reage quando o arrasto carrega URL/texto.
  const aoArrastarSobre = (event: React.DragEvent) => {
    if (
      Array.from(event.dataTransfer.types).some(
        (tipo) => tipo === "text/uri-list" || tipo === "text/plain",
      )
    ) {
      event.preventDefault();
      setArrastando(true);
    }
  };
  const aoSoltar = (event: React.DragEvent) => {
    event.preventDefault();
    setArrastando(false);
    const url = urlDoDrop(event.dataTransfer);
    if (url) adicionarUrl(url, nomeDeUrl(url));
  };

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 border-b border-border px-1.5 py-1",
        arrastando && "ring-2 ring-inset ring-primary/60",
      )}
      role="toolbar"
      aria-label={t.navegador.favoritosBarra}
      onDragOver={aoArrastarSobre}
      onDragLeave={() => setArrastando(false)}
      onDrop={aoSoltar}
    >
      {/* Menu de gerenciamento (estrela). #1163 D2: cede a webview sozinho. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t.navegador.favMenu}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Star className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t.navegador.favMenu}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            className="gap-2"
            disabled={!podeAdicionarAba}
            onSelect={adicionarAbaAtiva}
          >
            <Plus className="size-4" />
            {t.navegador.favAdicionarAba}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onSelect={() => setUrlAberto(true)}>
            <Link2 className="size-4" />
            {t.navegador.favAdicionarUrl}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onSelect={novaPasta}>
            <FolderPlus className="size-4" />
            {t.navegador.favNovaPasta}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {favoritos.length === 0 ? (
        <button
          type="button"
          onClick={() => setUrlAberto(true)}
          className="ml-1 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {arrastando ? t.navegador.favSoltarUrl : t.navegador.favVazioDica}
        </button>
      ) : (
        <div className="scrollbar-fina flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {favoritos.map((fav) => (
            <ContextMenu key={fav.id}>
              <ContextMenuTrigger asChild>
                {fav.tipo === "pasta" ? (
                  <span className="shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex max-w-44 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground/80 hover:bg-accent hover:text-foreground"
                        >
                          <Folder className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{fav.nome}</span>
                          <ChevronDown className="size-3 shrink-0 opacity-60" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-60">
                        <ItensPasta
                          itens={fav.filhos ?? []}
                          onAbrir={(f) => f.url && onNavegar(f.url, f.nome)}
                          onRemover={(id) =>
                            onMudar(removerFavorito(favoritos, id))
                          }
                          rotuloRemover={t.navegador.favRemover}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => fav.url && onNavegar(fav.url, fav.nome)}
                    className="flex max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground/80 hover:bg-accent hover:text-foreground"
                    title={fav.url}
                  >
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{fav.nome}</span>
                  </button>
                )}
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                {fav.tipo === "link" && (
                  <>
                    <ContextMenuItem
                      className="gap-2"
                      onClick={() => fav.url && onNavegar(fav.url, fav.nome)}
                    >
                      <Globe className="size-4" />
                      {t.navegador.favAbrir}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                {fav.tipo === "pasta" && podeAdicionarAba && (
                  <>
                    <ContextMenuItem
                      className="gap-2"
                      onClick={() =>
                        abaAtiva &&
                        onMudar(
                          inserirFavorito(
                            favoritos,
                            {
                              id: novoFavoritoId(),
                              tipo: "link",
                              nome: abaAtiva.nome || abaAtiva.url,
                              url: abaAtiva.url,
                            },
                            fav.id,
                          ),
                        )
                      }
                    >
                      <Plus className="size-4" />
                      {t.navegador.favAdicionarAba}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                <ContextMenuItem
                  className="gap-2"
                  onClick={() => setRenomeando(fav)}
                >
                  <Pencil className="size-4" />
                  {t.navegador.favRenomear}
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  className="gap-2"
                  onClick={() => onMudar(removerFavorito(favoritos, fav.id))}
                >
                  <Trash2 className="size-4" />
                  {t.navegador.favRemover}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}

      <DialogAdicionarUrl
        aberto={urlAberto}
        onFechar={() => setUrlAberto(false)}
        onAdicionar={adicionarUrl}
      />

      <DialogRenomearFavorito
        favorito={renomeando}
        onFechar={() => setRenomeando(null)}
        onRenomear={(id, nome) => onMudar(renomearFavorito(favoritos, id, nome))}
      />
    </div>
  );
}

/** Diálogo de adicionar URL (alvo de "colar"): prefill best-effort da área de
 *  transferência, valida http(s) e salva com nome opcional. */
function DialogAdicionarUrl({
  aberto,
  onFechar,
  onAdicionar,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAdicionar: (url: string, nome: string) => void;
}) {
  const { t } = useIdioma();
  // z-order (#275): esconder a webview enquanto aberto é por construção — o
  // `<Dialog>` (D2) se registra sozinho pelo `open`. Nada a fazer aqui.
  const [url, setUrl] = useState("");
  const [nome, setNome] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setUrl("");
    setNome("");
    let vivo = true;
    // Best-effort: se a área de transferência já tem uma URL, pré-preenche
    // (o "colar" fica a um Enter). Ignora erro/permissão silenciosamente.
    navigator.clipboard
      ?.readText?.()
      .then((texto) => {
        if (!vivo) return;
        const norm = texto ? normalizarUrl(texto) : null;
        if (norm) setUrl(norm);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [aberto]);

  const norm = normalizarUrl(url);
  const salvar = () => {
    if (!norm) return;
    onAdicionar(norm, nome.trim());
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.navegador.favUrlTitulo}</DialogTitle>
          <DialogDescription>{t.navegador.favUrlDescricao}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fav-url" className="text-sm font-medium">
              {t.navegador.favUrlLabel}
            </label>
            <Input
              id="fav-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  salvar();
                }
              }}
              placeholder={t.navegador.favUrlPlaceholder}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fav-url-nome" className="text-sm font-medium">
              {t.navegador.favUrlNomeLabel}
            </label>
            <Input
              id="fav-url-nome"
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  salvar();
                }
              }}
              placeholder={norm ? nomeDeUrl(norm) : ""}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.navegador.favCancelar}
            </Button>
          </DialogClose>
          <Button type="button" onClick={salvar} disabled={!norm}>
            {t.navegador.favAdicionar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Diálogo simples de renomear (link ou pasta). */
function DialogRenomearFavorito({
  favorito,
  onFechar,
  onRenomear,
}: {
  favorito: Favorito | null;
  onFechar: () => void;
  onRenomear: (id: string, nome: string) => void;
}) {
  const { t } = useIdioma();
  // z-order (#275): o `<Dialog>` (D2) cede a webview sozinho pelo `open`.
  const [nome, setNome] = useState("");

  useEffect(() => {
    if (favorito) setNome(favorito.nome);
  }, [favorito]);

  const salvar = () => {
    if (!favorito) return;
    const limpo = nome.trim();
    if (limpo) onRenomear(favorito.id, limpo);
    onFechar();
  };

  return (
    <Dialog open={favorito != null} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.navegador.favRenomearTitulo}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.navegador.favRenomearTitulo}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fav-nome" className="text-sm font-medium">
            {t.navegador.favNomeLabel}
          </label>
          <Input
            id="fav-nome"
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                salvar();
              }
            }}
            autoFocus
          />
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.navegador.favCancelar}
            </Button>
          </DialogClose>
          <Button type="button" onClick={salvar}>
            {t.navegador.favSalvar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Achata os favoritos em links pesquisáveis para a command palette. */
export function favoritosParaPalette(favoritos: Favorito[]) {
  return achatarLinks(favoritos);
}
