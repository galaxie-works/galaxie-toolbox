import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderPlus,
  Globe,
  Loader2,
  Minus,
  Pencil,
  Plus,
  ShieldAlert,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  importBrowserBookmarks,
  type BookmarkNode,
  type BrowserBookmarks,
} from "@/lib/api";
import {
  achatarLinks,
  chaveNo,
  criarPasta,
  inserirFavorito,
  linksDescendentes,
  novoFavoritoId,
  parseBookmarksHtml,
  removerFavorito,
  renomearFavorito,
  selecaoParaFavoritos,
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
  DropdownMenuSeparator,
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
import { preencher, useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";
import {
  useOcultarWebviewEnquantoAberto,
  useRegistrarOverlayWebview,
} from "@/lib/navigator-overlay";
import { Checkbox } from "@/components/ui/checkbox";
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";

const ROTULO_NAVEGADOR: Record<string, string> = {
  chrome: "Chrome",
  edge: "Edge",
};

/** Dado de um item da árvore de importação para o headless-tree (@reui/tree). */
interface ItemArvoreDado {
  nome: string;
  ehLink: boolean;
  children: string[];
}

const RAIZ_ARVORE = "__raiz__";

/**
 * Achata as origens (BrowserBookmarks) numa tabela de itens para o headless-tree:
 * cada origem vira uma pasta de topo; cada nó vira um item (id = chaveNo).
 * `linksPorId` guarda os links descendentes de cada item — base do tri-state e do
 * toggle de pasta. Assim reusamos o @reui/tree do registry, sem árvore custom.
 */
function montarArvore(
  origens: BrowserBookmarks[],
  rotuloOrigem: (o: BrowserBookmarks) => string,
): {
  itens: Record<string, ItemArvoreDado>;
  expandir: string[];
  linksPorId: Record<string, string[]>;
} {
  const itens: Record<string, ItemArvoreDado> = {};
  const linksPorId: Record<string, string[]> = {};
  const expandir: string[] = [];
  const raizes: string[] = [];

  const visitar = (origem: BrowserBookmarks, no: BookmarkNode): string => {
    const id = chaveNo(origem, no);
    if (no.url) {
      itens[id] = { nome: no.nome || no.url, ehLink: true, children: [] };
      linksPorId[id] = [id];
      return id;
    }
    const filhos = no.filhos.map((f) => visitar(origem, f));
    itens[id] = { nome: no.nome || "—", ehLink: false, children: filhos };
    linksPorId[id] = filhos.flatMap((fid) => linksPorId[fid] ?? []);
    return id;
  };

  for (const origem of origens) {
    const origemId = `origem:${origem.navegador}:${origem.perfil}`;
    const rootIds = origem.roots.map((raiz) => visitar(origem, raiz));
    itens[origemId] = {
      nome: rotuloOrigem(origem),
      ehLink: false,
      children: rootIds,
    };
    linksPorId[origemId] = rootIds.flatMap((rid) => linksPorId[rid] ?? []);
    raizes.push(origemId);
    expandir.push(origemId);
    for (const rid of rootIds) if (!itens[rid].ehLink) expandir.push(rid);
  }

  itens[RAIZ_ARVORE] = { nome: "", ehLink: false, children: raizes };
  linksPorId[RAIZ_ARVORE] = raizes.flatMap((r) => linksPorId[r] ?? []);
  return { itens, expandir, linksPorId };
}

/**
 * Árvore de importação com o **@reui/tree** (headless-tree) — sem árvore custom
 * (#176 rework). A seleção tri-state por pasta/item vive fora, num Set de chaves
 * de link; a pasta reflete/alterna os links descendentes. A expansão é do próprio
 * headless-tree. Remonta (via `key` no pai) quando as origens trocam.
 */
function ArvoreFavoritos({
  origens,
  selecionados,
  onToggle,
}: {
  origens: BrowserBookmarks[];
  selecionados: Set<string>;
  onToggle: (chaves: string[], ligar: boolean) => void;
}) {
  const { t } = useIdioma();
  const { itens, expandir, linksPorId } = useMemo(
    () =>
      montarArvore(origens, (o) =>
        preencher(t.navegador.importarPerfil, {
          navegador: ROTULO_NAVEGADOR[o.navegador] ?? o.navegador,
          perfil: o.perfil,
        }),
      ),
    [origens, t],
  );

  const tree = useTree<ItemArvoreDado>({
    initialState: { expandedItems: expandir },
    indent: 18,
    rootItemId: RAIZ_ARVORE,
    getItemName: (item) => item.getItemData().nome,
    isItemFolder: (item) => !item.getItemData().ehLink,
    dataLoader: {
      getItem: (id) => itens[id],
      getChildren: (id) => itens[id]?.children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  return (
    <Tree indent={18} tree={tree} toggleIconType="chevron">
      {tree.getItems().map((item) => {
        const id = item.getId();
        const dado = item.getItemData();
        const links = linksPorId[id] ?? [];
        const marcados = links.filter((l) => selecionados.has(l)).length;
        const estado: boolean | "indeterminate" =
          links.length > 0 && marcados === links.length
            ? true
            : marcados === 0
              ? false
              : "indeterminate";
        return (
          <TreeItem key={id} item={item} asChild>
            <div>
              <TreeItemLabel>
                <span className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    checked={estado}
                    onCheckedChange={() => onToggle(links, estado !== true)}
                    onClick={(event) => event.stopPropagation()}
                    className="size-3.5 shrink-0"
                    aria-label={dado.nome}
                  />
                  {dado.ehLink ? (
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{dado.nome}</span>
                </span>
              </TreeItemLabel>
            </div>
          </TreeItem>
        );
      })}
    </Tree>
  );
}

/**
 * Diálogo de importação: lê os favoritos do Chrome/Edge (Rust `std::fs`), mostra
 * a árvore com seleção tri-state por pasta/item, e ao aplicar converte a seleção
 * em `Favorito`s do app.
 */
export function DialogImportarFavoritos({
  aberto,
  onFechar,
  onAplicar,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAplicar: (favoritos: Favorito[]) => void;
}) {
  const { t } = useIdioma();
  // z-order (#275): esconde a webview enquanto o diálogo de import estiver aberto.
  useOcultarWebviewEnquantoAberto(aberto);
  const [carregando, setCarregando] = useState(false);
  const [origens, setOrigens] = useState<BrowserBookmarks[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // Diagnóstico da import automática (#176): navegadores detectados vs. com o
  // acesso bloqueado (antivírus/EDR) — decide a mensagem honesta.
  const [diag, setDiag] = useState<{ detectados: string[]; bloqueados: string[] }>({
    detectados: [],
    bloqueados: [],
  });
  const arquivoRef = useRef<HTMLInputElement>(null);

  // Marca TODOS os links (o usuário veio importar — é mais rápido desmarcar). A
  // expansão inicial fica com o headless-tree (@reui/tree). Reusado pela import
  // automática e pela por arquivo.
  const preSelecionarTudo = (dados: BrowserBookmarks[]) => {
    const marcar = new Set<string>();
    for (const origem of dados) {
      for (const raiz of origem.roots) {
        for (const chave of linksDescendentes(origem, raiz)) marcar.add(chave);
      }
    }
    setSelecionados(marcar);
  };

  // Import por arquivo HTML (export do próprio navegador): destrava mesmo com a
  // pasta de perfil bloqueada, sem tocar nela. Só favoritos, nunca credenciais.
  const carregarArquivo = async (evento: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = ""; // permite reimportar o mesmo arquivo
    if (!arquivo) return;
    const texto = await arquivo.text();
    const origem = parseBookmarksHtml(texto, arquivo.name);
    setDiag({ detectados: [], bloqueados: [] });
    setOrigens([origem]);
    preSelecionarTudo([origem]);
  };

  // Carrega ao abrir; zera ao fechar. Por padrão expande as pastas de topo e
  // deixa TUDO marcado (o usuário veio importar — é mais rápido desmarcar).
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    setOrigens([]);
    setSelecionados(new Set());
    setDiag({ detectados: [], bloqueados: [] });
    importBrowserBookmarks()
      .then((res) => {
        if (!vivo) return;
        setOrigens(res.navegadores);
        setDiag({ detectados: res.detectados, bloqueados: res.bloqueados });
        preSelecionarTudo(res.navegadores);
      })
      .catch(() => {
        if (vivo) setOrigens([]);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [aberto]);

  const totalLinks = useMemo(
    () =>
      origens.reduce(
        (soma, origem) =>
          soma +
          origem.roots.reduce(
            (s, raiz) => s + linksDescendentes(origem, raiz).length,
            0,
          ),
        0,
      ),
    [origens],
  );

  const alternarSelecao = (chaves: string[], ligar: boolean) => {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      for (const chave of chaves) {
        if (ligar) proximo.add(chave);
        else proximo.delete(chave);
      }
      return proximo;
    });
  };

  const selecionarTudo = () => {
    const todos = new Set<string>();
    for (const origem of origens) {
      for (const raiz of origem.roots) {
        for (const chave of linksDescendentes(origem, raiz)) todos.add(chave);
      }
    }
    setSelecionados(todos);
  };

  const aplicar = () => {
    const favoritos = selecaoParaFavoritos(origens, selecionados);
    onAplicar(favoritos);
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.navegador.importarTitulo}</DialogTitle>
          <DialogDescription>{t.navegador.importarDescricao}</DialogDescription>
        </DialogHeader>

        {/* Import por arquivo HTML (export do próprio navegador) — sempre
            disponível, e o único caminho quando a pasta de perfil está bloqueada. */}
        <input
          ref={arquivoRef}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          onChange={carregarArquivo}
        />

        {carregando ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="size-6 animate-spin opacity-60" />
            <span className="text-sm">{t.navegador.importarCarregando}</span>
          </div>
        ) : origens.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
            {diag.bloqueados.length > 0 ? (
              <ShieldAlert className="size-7 text-warning" />
            ) : (
              <Globe className="size-7 opacity-40" />
            )}
            <span className="max-w-xs text-sm">
              {diag.bloqueados.length > 0
                ? t.navegador.importarBloqueado
                : diag.detectados.length > 0
                  ? t.navegador.importarSemFavoritos
                  : t.navegador.importarVazio}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => arquivoRef.current?.click()}
            >
              <Upload className="size-4" />
              {t.navegador.importarArquivo}
            </Button>
            <span className="max-w-xs text-xs">
              {t.navegador.importarArquivoDica}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {preencher(t.navegador.importarContagem, {
                  n: selecionados.size,
                  total: totalLinks,
                })}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selecionarTudo}
                >
                  {t.navegador.importarSelecionarTudo}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelecionados(new Set())}
                >
                  {t.navegador.importarLimpar}
                </Button>
              </div>
            </div>
            <div className="scrollbar-fina max-h-[46vh] overflow-y-auto rounded-md border border-border p-2">
              <ArvoreFavoritos
                key={origens
                  .map((o) => `${o.navegador}:${o.perfil}`)
                  .join("|")}
                origens={origens}
                selecionados={selecionados}
                onToggle={alternarSelecao}
              />
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => arquivoRef.current?.click()}
          >
            <Upload className="size-4" />
            {t.navegador.importarArquivo}
          </Button>
          <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.navegador.favCancelar}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={aplicar}
            disabled={selecionados.size === 0}
          >
            {selecionados.size > 0
              ? preencher(t.navegador.importarAplicar, { n: selecionados.size })
              : t.navegador.importarNada}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
 * gerenciamento (adicionar da aba ativa, nova pasta, importar, renomear,
 * remover). Estado dos favoritos vem por prop; as mudanças sobem por `onMudar`.
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
  const registrarOverlayWebview = useRegistrarOverlayWebview();
  const [importar, setImportar] = useState(false);
  const [renomeando, setRenomeando] = useState<Favorito | null>(null);

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

  const novaPasta = () => {
    const { favoritos: proximo } = criarPasta(favoritos, t.navegador.favPastaNomePadrao);
    onMudar(proximo);
  };

  const aplicarImportacao = (importados: Favorito[]) => {
    if (importados.length === 0) return;
    onMudar([...favoritos, ...importados]);
  };

  return (
    <div
      className="flex items-center gap-0.5 border-b border-border px-1.5 py-1"
      role="toolbar"
      aria-label={t.navegador.favoritosBarra}
    >
      {/* Menu de gerenciamento (estrela). */}
      <DropdownMenu onOpenChange={registrarOverlayWebview}>
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
          <DropdownMenuItem className="gap-2" onSelect={novaPasta}>
            <FolderPlus className="size-4" />
            {t.navegador.favNovaPasta}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onSelect={() => setImportar(true)}>
            <Download className="size-4" />
            {t.navegador.favImportar}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {favoritos.length === 0 ? (
        <button
          type="button"
          onClick={() => setImportar(true)}
          className="ml-1 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {t.navegador.favImportarDica}
        </button>
      ) : (
        <div className="scrollbar-fina flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {favoritos.map((fav) => (
            <ContextMenu key={fav.id} onOpenChange={registrarOverlayWebview}>
              <ContextMenuTrigger asChild>
                {fav.tipo === "pasta" ? (
                  <span className="shrink-0">
                    <DropdownMenu onOpenChange={registrarOverlayWebview}>
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
                          onRemover={(id) => onMudar(removerFavorito(favoritos, id))}
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
                <ContextMenuItem className="gap-2" onClick={() => setRenomeando(fav)}>
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

      <DialogImportarFavoritos
        aberto={importar}
        onFechar={() => setImportar(false)}
        onAplicar={aplicarImportacao}
      />

      <DialogRenomearFavorito
        favorito={renomeando}
        onFechar={() => setRenomeando(null)}
        onRenomear={(id, nome) => onMudar(renomearFavorito(favoritos, id, nome))}
      />
    </div>
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
  // z-order (#275): esconde a webview enquanto o diálogo de renomear estiver aberto.
  useOcultarWebviewEnquantoAberto(favorito != null);
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
