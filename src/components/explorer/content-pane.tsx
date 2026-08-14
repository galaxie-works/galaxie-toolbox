import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderOpen,
  LayoutGrid,
  List,
  PanelRight,
  PanelRightClose,
  Search,
  Table as TableIcon,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertAction, AlertTitle } from "@/components/reui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import {
  abrirCaminhoFs,
  criarArquivo,
  criarPasta,
  enableLongPaths,
  excluirPermanente,
  listarDir,
  longPathsStatus,
  paraLixeira,
  renomear,
  revelarCaminho,
} from "@/lib/api";
import type { FsEntry } from "@/lib/types";
import { useVirtualizer } from "@tanstack/react-virtual";

import { ordenar, type ChaveOrdem, type Ordem } from "./ordenar";
import { filtrarEntradas } from "./filtro";
import { juntarCaminho, pathPai } from "./caminho";
import { ComMenu, RenameInput } from "./menu-contexto";
import {
  getEmptySpaceContextMenu,
  getFileContextMenu,
  nomeEmConflito,
  nomeUnico,
  nomeValido,
  type AcoesMenu,
  type Clipboard,
  type ItemMenu,
  type RotulosMenu,
} from "./menu-arquivo";
import {
  SELECAO_VAZIA,
  alternar,
  selecionarFaixa,
  selecionarTudo,
  selecionarUnico,
  type EstadoSelecao,
} from "./selecao";
import { type GridMetrica } from "./marquee";
import { useMarqueeSelecao } from "./use-marquee";
import { solicitarThumb } from "./thumb-fila";
import { ehImagem, iconeParaEntry } from "./icones-arquivo";
import { formatarDataArquivo, rotuloTipo } from "./format";

type ModoView = "detalhes" | "lista" | "grade";

// Estamos dentro do Tauri? (thumbnails via convertFileSrc só existem lá; no
// browser/mock degradamos pro ícone). Mesmo gate de `api.ts`.
const TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- Virtualização: alturas por view + métricas do grid --------------------
const ALTURA_DETALHES = 34; // linha de tabela (altura fixa)
const ALTURA_LISTA = 32; // linha da lista
const ALTURA_GRADE = 116; // tile (miniatura + nome)
const MIN_ITEM_W = 132; // largura-alvo do tile (grade)
const GAP = 8;
const OVERSCAN = 8;

// Colunas da tabela (Detalhes): nome flexível + 3 fixas.
const COLS_DETALHES = "minmax(0,1fr) 150px 96px 104px";

// #738 (F3): maior lado do thumbnail. ~256px = 2× o maior tile (grade, 48px)
// cobrindo HiDPI; casa com o default do `gerarThumbnail`.
const THUMB_MAX_LADO = 256;

/**
 * Miniatura de imagem carregada só quando visível (IntersectionObserver) e
 * apenas dentro do Tauri. #738: aponta o `<img>` pro thumb webp (data URI)
 * gerado/cacheado no backend — o ORIGINAL nunca é decodificado no DOM. A fila
 * (`solicitarThumb`) prioriza o viewport e cancela o que sai de tela. Fora do
 * Tauri, ou se a imagem falhar, mostra o `fallback` (o ícone).
 */
function Miniatura({
  entry,
  boxClass,
  fallback,
}: {
  entry: FsEntry;
  boxClass: string;
  fallback: ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!TAURI || erro) return;
    const el = ref.current;
    if (!el) return;
    let cancelado = false;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // #820 (P0): só pede o thumb depois que o tile ASSENTA ~120ms na
        // viewport. No scroll rápido de pasta densa os tiles que só passam
        // voando desmontam antes disso → o timer é cancelado no cleanup e
        // NENHUM pedido é enfileirado nem gerado no backend (era o que floodava
        // a fila e os cores 5/6/9 com thumbs que já saíram de tela).
        timer = window.setTimeout(() => {
          void solicitarThumb(
            entry.path,
            entry.modifiedMs ?? 0,
            THUMB_MAX_LADO,
            () => cancelado,
          ).then((uri) => {
            if (!cancelado && uri) setSrc(uri);
          });
        }, 120);
      },
      { rootMargin: "150px" },
    );
    io.observe(el);
    // Saiu de tela / trocou de pasta → cancela o timer de assentamento e o
    // pedido pendente (a fila o descarta antes de começar, ou ignoramos o
    // resultado).
    return () => {
      cancelado = true;
      if (timer !== undefined) clearTimeout(timer);
      io.disconnect();
    };
  }, [entry.path, entry.modifiedMs, erro]);

  if (!TAURI || erro || !src) {
    return (
      <span className={cn("flex items-center justify-center", boxClass)} ref={ref}>
        {fallback}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErro(true)}
      className={cn("rounded object-cover", boxClass)}
    />
  );
}

/**
 * Ícone (ou miniatura, se imagem) de uma entrada. #739 (F4): memoizada — não
 * re-renderiza no scroll/seleção enquanto `entry`/classes forem os mesmos.
 *
 * #820 (P0, causa-raiz): miniatura SÓ no Grid (`thumb`). Em Detalhes/Lista o
 * ícone é o de TIPO (extensão) — zero thumbnail, como todo file manager. Gerar
 * thumbnail por-linha em Detalhes floodava a fila e rasterizava arquivos
 * gigantes (o SVG de 23MB do Wagner) → freeze; nesses modos a `Miniatura` nem
 * monta (sem IntersectionObserver, sem `solicitarThumb`).
 */
const CelulaIcone = memo(function CelulaIcone({
  entry,
  boxClass,
  iconClass,
  thumb,
}: {
  entry: FsEntry;
  boxClass: string;
  iconClass: string;
  thumb: boolean;
}) {
  const { Icon, cor } = iconeParaEntry(entry);
  const icone = <Icon className={cn(iconClass, cor)} />;
  if (!thumb || !ehImagem(entry)) {
    return (
      <span className={cn("flex items-center justify-center", boxClass)}>
        {icone}
      </span>
    );
  }
  return <Miniatura entry={entry} boxClass={boxClass} fallback={icone} />;
});

type ItemArquivoProps = {
  entry: FsEntry;
  index: number;
  modo: ModoView;
  sel: boolean;
  cursor: boolean;
  editando: boolean;
  idioma: string;
  labelTipoPasta: string;
  labelTipoArquivo: string;
  onClicar: (
    index: number,
    ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => void;
  onAbrir: (entry: FsEntry) => void;
  onAbrirMenu: (entry: FsEntry) => void;
  construirMenu: (entry: FsEntry, shift: boolean) => ItemMenu[];
  onConfirmarRename: (
    entry: FsEntry,
    nome: string,
    opts: { mover: boolean; viaBlur: boolean },
  ) => void;
  onCancelarRename: () => void;
};

/**
 * #739 (F4): UMA linha/tile do Explorer, MEMOIZADO. Só re-renderiza quando o
 * próprio `entry`/`sel`/`cursor`/`editando` muda — os callbacks chegam ESTÁVEIS
 * do ContentPane (useCallback + refs). No scroll/seleção, as linhas que não
 * mudaram são puladas (era o gargalo de main-thread do #739). O menu de contexto
 * é montado sob demanda (thunk), não por-linha a cada render.
 */
const ItemArquivo = memo(function ItemArquivo({
  entry,
  index,
  modo,
  sel,
  cursor,
  editando,
  idioma,
  labelTipoPasta,
  labelTipoArquivo,
  onClicar,
  onAbrir,
  onAbrirMenu,
  construirMenu,
  onConfirmarRename,
  onCancelarRename,
}: ItemArquivoProps) {
  const menuThunk = (shift: boolean) => construirMenu(entry, shift);
  const abrirMenu = () => onAbrirMenu(entry);
  const nome = (spanClass: string): ReactNode =>
    editando ? (
      <RenameInput
        inicial={entry.name}
        ehPasta={entry.isDir}
        onConfirmar={(n, opts) => onConfirmarRename(entry, n, opts)}
        onCancelar={onCancelarRename}
      />
    ) : (
      <span className={spanClass}>{entry.name}</span>
    );

  if (modo === "grade") {
    const classe = cn(
      "flex h-[108px] w-full flex-col items-center gap-1.5 rounded-lg border border-transparent p-2 text-center outline-none transition-colors",
      sel ? "bg-accent" : "hover:bg-accent/50",
      cursor && "ring-2 ring-ring/60",
    );
    const conteudo = (
      <>
        <CelulaIcone entry={entry} boxClass="size-12" iconClass="size-9" thumb />
        {nome("line-clamp-2 w-full break-words text-xs leading-tight")}
      </>
    );
    return (
      <ComMenu itens={menuThunk} onOpen={abrirMenu}>
        {editando ? (
          <div className={classe}>{conteudo}</div>
        ) : (
          <button
            type="button"
            onClick={(e) => onClicar(index, e)}
            onDoubleClick={() => onAbrir(entry)}
            className={classe}
          >
            {conteudo}
          </button>
        )}
      </ComMenu>
    );
  }

  if (modo === "lista") {
    const classe = cn(
      "flex h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left outline-none",
      sel ? "bg-accent" : "hover:bg-accent/50",
      cursor && "ring-2 ring-ring/60",
    );
    const conteudo = (
      <>
        <CelulaIcone entry={entry} boxClass="size-5" iconClass="size-4" thumb={false} />
        {nome("min-w-0 flex-1 truncate text-sm")}
      </>
    );
    return (
      <ComMenu className="w-full" itens={menuThunk} onOpen={abrirMenu}>
        {editando ? (
          <div className={classe}>{conteudo}</div>
        ) : (
          <button
            type="button"
            onClick={(e) => onClicar(index, e)}
            onDoubleClick={() => onAbrir(entry)}
            className={classe}
          >
            {conteudo}
          </button>
        )}
      </ComMenu>
    );
  }

  // Detalhes: linha de tabela alinhada ao cabeçalho.
  const classe = cn(
    "grid h-[34px] w-full items-center gap-2 rounded-md border border-transparent px-2 text-left outline-none",
    sel ? "bg-accent" : "hover:bg-accent/50",
    cursor && "ring-2 ring-ring/60",
  );
  const conteudo = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <CelulaIcone entry={entry} boxClass="size-5" iconClass="size-4" thumb={false} />
        {nome("min-w-0 truncate text-sm")}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {formatarDataArquivo(entry.modifiedMs, idioma)}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {rotuloTipo(entry, { pasta: labelTipoPasta, arquivo: labelTipoArquivo })}
      </span>
      <span className="truncate text-right text-xs text-muted-foreground tabular-nums">
        {entry.isDir ? "" : formatBytes(entry.size)}
      </span>
    </>
  );
  return (
    <ComMenu className="w-full" itens={menuThunk} onOpen={abrirMenu}>
      {editando ? (
        <div className={classe} style={{ gridTemplateColumns: COLS_DETALHES }}>
          {conteudo}
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => onClicar(index, e)}
          onDoubleClick={() => onAbrir(entry)}
          className={classe}
          style={{ gridTemplateColumns: COLS_DETALHES }}
        >
          {conteudo}
        </button>
      )}
    </ComMenu>
  );
});

/**
 * #678: painel de conteúdo do Explorer — lista virtualizada (um único caminho,
 * sempre virtual) com 3 views (Detalhes / Lista / Grade), ordenação
 * pastas-primeiro, seleção âncora+faixa e teclado. Carrega via `listarDir` ao
 * mudar `currentPath` (com guarda de corrida). Pasta abre navegando; arquivo é
 * hook de S3 (no-op hoje).
 */
// Windows MAX_PATH: acima disso o caminho precisa do suporte a caminhos longos.
const MAX_PATH = 260;

export function ContentPane({
  currentPath,
  onNavegar,
  onVoltar,
  onAvancar,
  onAcima,
  onSelecaoChange,
  clipboard,
  onClipboardChange,
  onTransferir,
  refreshSignal,
  mostrarInspector,
  onToggleInspector,
}: {
  currentPath: string;
  onNavegar: (path: string) => void;
  /** #863: navegação por teclado com foco na lista (Alt+←/Backspace = voltar,
   *  Alt+→ = avançar, Alt+↑ = pasta acima) — os handlers vêm do shell. */
  onVoltar?: () => void;
  onAvancar?: () => void;
  onAcima?: () => void;
  /** #681: reporta a seleção (FsEntry[]) pro shell alimentar o InspectorPane. */
  onSelecaoChange?: (itensSelecionados: FsEntry[]) => void;
  /** #714: área de transferência interna (recortar/copiar/colar), no shell. */
  clipboard?: Clipboard | null;
  onClipboardChange?: (c: Clipboard | null) => void;
  /** #724: dispara colar/copiar/mover via o fluxo de progresso + conflito (shell). */
  onTransferir?: (
    sources: string[],
    destDir: string,
    op: Clipboard["op"],
  ) => void;
  /** #724: nonce do watcher — bumpar re-lê a MESMA pasta (live refresh). */
  refreshSignal?: number;
  /** Estado do painel de detalhes (controlado pelo shell) — pro botão de toggle. */
  mostrarInspector?: boolean;
  onToggleInspector?: () => void;
}) {
  const { t, idioma } = useIdioma();
  const [entradas, setEntradas] = useState<FsEntry[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  // #714: nonce de recarga — bumpar re-dispara o `listarDir` do currentPath
  // (refresh pós-operação sem mexer no loader do S2).
  const [recarregarNonce, setRecarregarNonce] = useState(0);
  const recarregar = useCallback(() => setRecarregarNonce((n) => n + 1), []);
  // #714: rename in-place (path em edição) e o dialog de confirmação da exclusão
  // permanente. #739: o gate de Shift do delete permanente saiu do state e vai
  // direto na thunk do menu (o ComMenu captura o Shift do clique).
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [confirmarPerm, setConfirmarPerm] = useState<string[] | null>(null);
  // Path recém-criado que deve entrar em rename assim que aparecer na listagem.
  const renomearAoAparecer = useRef<string | null>(null);
  const [modo, setModo] = useState<ModoView>("detalhes");
  const [ordem, setOrdem] = useState<Ordem>({ chave: "nome", direcao: "asc" });
  const [selecao, setSelecao] = useState<EstadoSelecao>(SELECAO_VAZIA);
  const [largura, setLargura] = useState(0);
  // #681: filtro in-folder (as-you-type) + toggle de ocultos (off por padrão).
  const [filtro, setFiltro] = useState("");
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  // #681: suporte a caminhos longos — checado 1x no mount, re-checado após habilitar.
  const [longPathsOn, setLongPathsOn] = useState<boolean | null>(null);
  const [habilitandoLong, setHabilitandoLong] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // #863: Ctrl+F foca o filtro in-folder (ref pro Input abaixo).
  const filtroRef = useRef<HTMLInputElement>(null);

  // --- Carga com guarda de corrida (ignora respostas de caminho antigo) -----
  useEffect(() => {
    if (!currentPath) {
      setEntradas(null);
      return;
    }
    let vivo = true;
    setCarregando(true);
    setErro(false);
    setSelecao(SELECAO_VAZIA);
    setFiltro(""); // filtro é por-pasta: zera ao trocar de caminho
    void listarDir(currentPath)
      .then((lista) => {
        if (!vivo) return;
        setEntradas(lista);
      })
      .catch(() => {
        if (!vivo) return;
        setEntradas(null);
        setErro(true);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
    // recarregarNonce força a releitura da MESMA pasta após uma operação local;
    // refreshSignal faz o mesmo a partir do watcher de disco do shell (#724).
  }, [currentPath, recarregarNonce, refreshSignal]);

  // Volta ao topo a cada nova pasta.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentPath]);

  // #714: troca de pasta cancela rename em curso e o pending de criar→renomear.
  useEffect(() => {
    renomearAoAparecer.current = null;
    setRenomeando(null);
  }, [currentPath]);

  // Pipeline: FILTRA (nome + ocultos) → ORDENA → virtualiza. A seleção/teclado
  // operam sobre a lista VISÍVEL (filtrada+ordenada).
  const itens = useMemo(() => {
    if (!entradas) return [];
    return ordenar(filtrarEntradas(entradas, filtro, mostrarOcultos), ordem);
  }, [entradas, filtro, mostrarOcultos, ordem]);
  const paths = useMemo(() => itens.map((e) => e.path), [itens]);
  // #739 (F4): índice path→entry pra reportar a seleção em O(nº selecionados),
  // não O(n) filtrando a lista inteira a cada tecla (jank em 5000 itens).
  const porPath = useMemo(() => {
    const m = new Map<string, FsEntry>();
    for (const e of itens) m.set(e.path, e);
    return m;
  }, [itens]);
  // #739 (F4): refs sempre-atuais de seleção/clipboard/paths pra os callbacks do
  // menu de contexto e do right-click ficarem ESTÁVEIS (deps só do que muda raro),
  // sem re-render por-linha a cada mudança de seleção — a chave da memoização.
  const selecaoRef = useRef(selecao);
  selecaoRef.current = selecao;
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  const pathsRef = useRef(paths);
  pathsRef.current = paths;

  // #681: status de caminhos longos — 1x no mount (cacheado). Re-checa após enable.
  useEffect(() => {
    let vivo = true;
    void longPathsStatus()
      .then((on) => vivo && setLongPathsOn(on))
      .catch(() => vivo && setLongPathsOn(true)); // erro → não incomoda com o CTA
    return () => {
      vivo = false;
    };
  }, []);

  // #681: reporta a seleção como FsEntry[] pro shell (InspectorPane). #739 (F4):
  // itera o Set de selecionados (pequeno no caso comum) resolvendo via `porPath`,
  // em vez de filtrar a lista visível inteira — o que o filtro esconder não está
  // no índice, então some da seleção reportada, igual antes.
  useEffect(() => {
    if (!onSelecaoChange) return;
    const out: FsEntry[] = [];
    for (const p of selecao.selecionados) {
      const e = porPath.get(p);
      if (e) out.push(e);
    }
    onSelecaoChange(out);
  }, [selecao, porPath, onSelecaoChange]);

  // #714: após criar pasta/arquivo, entra em rename assim que o item aparece na
  // listagem recarregada (mock é no-op → simplesmente não dispara).
  useEffect(() => {
    const alvo = renomearAoAparecer.current;
    if (!alvo || !entradas) return;
    if (entradas.some((e) => e.path === alvo)) {
      renomearAoAparecer.current = null;
      setRenomeando(alvo);
    }
  }, [entradas]);

  const mostrarLongPathCta =
    longPathsOn === false && currentPath.length > MAX_PATH;

  const habilitarLongPaths = useCallback(async () => {
    if (habilitandoLong) return;
    setHabilitandoLong(true);
    try {
      await enableLongPaths(); // dispara UAC no Tauri
      setLongPathsOn(await longPathsStatus());
    } catch (e) {
      toast.error(t.arquivos.longPathErro, { description: String(e) });
      // Elevação negada não muda o registro → volta pro estado REAL.
      setLongPathsOn(await longPathsStatus().catch(() => false));
    } finally {
      setHabilitandoLong(false);
    }
  }, [habilitandoLong, t.arquivos.longPathErro]);

  // --- Colunas do grid (Grade multi-coluna; Detalhes/Lista = 1) -------------
  const cols = useMemo(() => {
    if (modo !== "grade") return 1;
    if (largura <= 0) return 1;
    return Math.max(1, Math.floor((largura + GAP) / (MIN_ITEM_W + GAP)));
  }, [modo, largura]);

  const alturaLinha =
    modo === "grade"
      ? ALTURA_GRADE
      : modo === "lista"
        ? ALTURA_LISTA
        : ALTURA_DETALHES;

  const totalLinhas = Math.ceil(itens.length / cols);

  const virtualizer = useVirtualizer({
    count: totalLinhas,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => alturaLinha,
    overscan: OVERSCAN,
  });

  // Remede quando muda a view/colunas (altura de linha diferente).
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [modo, cols, virtualizer]);

  // #748: marquee/rubber-band. A métrica espelha o layout virtualizado (linha ×
  // coluna) pra selecionar por índice — itens fora do viewport entram também. O
  // `px-1` do container da grade = 4px de padding lateral.
  const metricaGrid = useMemo<GridMetrica>(
    () => ({
      cols,
      alturaLinha,
      largura,
      alturaTotal: virtualizer.getTotalSize(),
      count: itens.length,
      gap: GAP,
      padX: 4,
      modoGrade: modo === "grade",
    }),
    [cols, alturaLinha, largura, virtualizer, itens.length, modo],
  );
  const marquee = useMarqueeSelecao({
    scrollRef,
    metrica: metricaGrid,
    paths,
    selecao,
    setSelecao,
  });

  // --- ResizeObserver no parent de scroll → largura (recomputa colunas) -----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setLargura(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setLargura(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Interações -----------------------------------------------------------
  const abrirItem = useCallback(
    (entry: FsEntry) => {
      if (entry.isDir) onNavegar(entry.path);
      else void abrirCaminhoFs(entry.path).catch(() => {
        toast.error(t.arquivos.erroOperacao);
      });
    },
    [onNavegar, t.arquivos.erroOperacao],
  );

  // --- #714: operações de arquivo (recortar/copiar/colar/renomear/excluir) ----
  // Envolve uma mutação: roda, dá refresh e mostra toast de erro tipado.
  const comRefresh = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
        recarregar();
      } catch (e) {
        toast.error(t.arquivos.erroOperacao, { description: String(e) });
      }
    },
    [recarregar, t.arquivos.erroOperacao],
  );

  // #849 (P1): guard de exclusão POR CAMINHO. A Lixeira do Windows leva ~10s sem
  // feedback → o usuário aperta Del 3x → 3 `fs_trash`/`excluirPermanente`
  // concorrentes na MESMA seleção: o 2º/3º erram (path já sumiu) → toast espúrio
  // + 3× refresh → a lista enlouquece. O set de pendentes filtra os alvos já em
  // andamento (todos pendentes = no-op, mata o 3x) e dá FEEDBACK IMEDIATO (toast
  // que resolve em sucesso/erro) pra matar a sensação de "não funciona".
  const pendenteExclusaoRef = useRef<Set<string>>(new Set());
  const excluirComGuard = useCallback(
    (alvos: string[], permanente: boolean) => {
      const pend = pendenteExclusaoRef.current;
      const novos = alvos.filter((p) => !pend.has(p));
      if (novos.length === 0) return; // tudo já em andamento → no-op
      for (const p of novos) pend.add(p);
      const id = `excluir:${novos[0]}:${novos.length}`;
      toast.loading(
        permanente ? t.arquivos.excluindoPerm : t.arquivos.movendoLixeira,
        { id },
      );
      void (async () => {
        try {
          if (permanente) await excluirPermanente(novos);
          else await paraLixeira(novos);
          toast.success(
            permanente ? t.arquivos.excluidoPerm : t.arquivos.movidoLixeira,
            { id },
          );
          recarregar();
        } catch (e) {
          // Erro persiste mais (o usuário precisa ver o que falhou).
          toast.error(t.arquivos.erroOperacao, {
            id,
            description: String(e),
            duration: 8000,
          });
        } finally {
          for (const p of novos) pend.delete(p);
        }
      })();
    },
    [
      recarregar,
      t.arquivos.movendoLixeira,
      t.arquivos.excluindoPerm,
      t.arquivos.movidoLixeira,
      t.arquivos.excluidoPerm,
      t.arquivos.erroOperacao,
    ],
  );

  // #724: colar delega ao shell — checa conflitos, mostra progresso/cancel e (no
  // cut) limpa o clipboard. O refresh vem do watcher (não do comRefresh local).
  const colar = useCallback(
    (destDir: string) => {
      if (!clipboard || clipboard.paths.length === 0) return;
      onTransferir?.(clipboard.paths, destDir, clipboard.op);
    },
    [clipboard, onTransferir],
  );

  const iniciarRename = useCallback((entry: FsEntry) => {
    setRenomeando(entry.path);
  }, []);

  const criarPastaNova = useCallback(
    (destDir: string) => {
      const base = nomeUnico(t.arquivos.novaPastaNome, entradas ?? []);
      const alvo = juntarCaminho(destDir, base);
      renomearAoAparecer.current = alvo; // entra em rename quando aparecer
      void comRefresh(() => criarPasta(alvo));
    },
    [comRefresh, entradas, t.arquivos.novaPastaNome],
  );

  const criarArquivoNovo = useCallback(
    (destDir: string) => {
      const base = nomeUnico(t.arquivos.novoArquivoNome, entradas ?? []);
      const alvo = juntarCaminho(destDir, base);
      renomearAoAparecer.current = alvo;
      void comRefresh(() => criarArquivo(alvo));
    },
    [comRefresh, entradas, t.arquivos.novoArquivoNome],
  );

  const acoesMenu = useMemo<AcoesMenu>(
    () => ({
      abrir: abrirItem,
      abrirCom: (entry) =>
        void abrirCaminhoFs(entry.path).catch(() =>
          toast.error(t.arquivos.erroOperacao),
        ),
      recortar: (paths) => onClipboardChange?.({ paths, op: "cut" }),
      copiar: (paths) => onClipboardChange?.({ paths, op: "copy" }),
      colar,
      renomear: iniciarRename,
      // #849: pelo guard (dedup por caminho + feedback), não direto na api.
      paraLixeira: (paths) => excluirComGuard(paths, false),
      // Exclusão permanente NUNCA chama a api direto: passa pelo dialog.
      excluirPerm: (paths) => setConfirmarPerm(paths),
      novaPasta: criarPastaNova,
      novoArquivo: criarArquivoNovo,
      copiarCaminho: (paths) =>
        void navigator.clipboard
          ?.writeText(paths.join("\n"))
          .catch(() => toast.error(t.arquivos.erroOperacao)),
      revelar: (path) =>
        void revelarCaminho(path).catch(() =>
          toast.error(t.arquivos.erroOperacao),
        ),
      // Propriedades (#749): RESPEITA a seleção múltipla. O `aoAbrirMenu` (no
      // open do menu) já deixou a seleção certa — preserva o conjunto se o item
      // clicado já estava selecionado, ou vira single se estava fora. Aqui só
      // garante o InspectorPane visível; NÃO força single (era o bug).
      propriedades: () => {
        if (!mostrarInspector) onToggleInspector?.();
      },
    }),
    [
      abrirItem,
      colar,
      iniciarRename,
      criarPastaNova,
      criarArquivoNovo,
      excluirComGuard,
      onClipboardChange,
      paths,
      t.arquivos.erroOperacao,
      mostrarInspector,
      onToggleInspector,
    ],
  );

  const rotulosMenu = useMemo<RotulosMenu>(
    () => ({
      abrir: t.arquivos.abrir,
      abrirCom: t.arquivos.abrirCom,
      abrirComPadrao: t.arquivos.abrirComPadrao,
      recortar: t.arquivos.recortar,
      copiar: t.arquivos.copiar,
      colar: t.arquivos.colar,
      renomear: t.arquivos.renomear,
      excluir: t.arquivos.excluir,
      excluirPerm: t.arquivos.excluirPerm,
      novaPasta: t.arquivos.novaPasta,
      novoArquivo: t.arquivos.novoArquivo,
      copiarCaminho: t.arquivos.copiarCaminho,
      revelar: t.arquivos.revelar,
      propriedades: t.arquivos.propriedades,
    }),
    [t.arquivos],
  );

  // Confirma um rename: valida vazio/inválido/conflito e chama `renomear`. Vindo
  // do blur, nome ruim cancela em silêncio; via teclado, mostra toast e segura.
  const confirmarRename = useCallback(
    (
      entry: FsEntry,
      novoNome: string,
      { viaBlur }: { mover: boolean; viaBlur: boolean },
    ) => {
      const nome = novoNome.trim();
      if (nome === entry.name || nome === "") {
        setRenomeando(null);
        return;
      }
      if (!nomeValido(nome)) {
        if (viaBlur) setRenomeando(null);
        else toast.error(t.arquivos.renomearInvalido);
        return;
      }
      if (nomeEmConflito(nome, entradas ?? [], entry.path)) {
        if (viaBlur) setRenomeando(null);
        else toast.error(t.arquivos.renomearConflito);
        return;
      }
      setRenomeando(null);
      const destino = juntarCaminho(pathPai(entry.path), nome);
      void comRefresh(() => renomear(entry.path, destino));
    },
    [entradas, comRefresh, t.arquivos.renomearInvalido, t.arquivos.renomearConflito],
  );

  const aoClicar = useCallback(
    (index: number, ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
      scrollRef.current?.focus({ preventScroll: true });
      if (ev.shiftKey) {
        setSelecao((s) => selecionarFaixa(s, paths, index));
      } else if (ev.ctrlKey || ev.metaKey) {
        setSelecao((s) => alternar(s, paths, index));
      } else {
        setSelecao(selecionarUnico(paths, index));
      }
    },
    [paths],
  );

  const moverCursor = useCallback(
    (destino: number, shift: boolean) => {
      const alvo = Math.max(0, Math.min(paths.length - 1, destino));
      if (alvo < 0 || paths.length === 0) return;
      setSelecao((s) =>
        shift ? selecionarFaixa(s, paths, alvo) : selecionarUnico(paths, alvo),
      );
      virtualizer.scrollToIndex(Math.floor(alvo / cols));
    },
    [paths, cols, virtualizer],
  );

  const aoTeclar = useCallback(
    (ev: React.KeyboardEvent<HTMLDivElement>) => {
      // Não sequestra o teclado se o foco está num input/editável (ex.: o campo
      // de endereço da navbar) — só age quando o próprio painel tem o foco.
      const ativo = document.activeElement;
      if (
        ativo instanceof HTMLElement &&
        (ativo.tagName === "INPUT" ||
          ativo.tagName === "TEXTAREA" ||
          ativo.isContentEditable)
      ) {
        return;
      }
      // #863: atalhos que NÃO dependem de haver itens (navegação / view / ocultos
      // / filtro / refresh) — ANTES do guard de lista vazia. Casam com o catálogo
      // `atalhos.ts` (sem entrada morta) e não disparam com foco em input (guard
      // acima). Alt+seta é tratado aqui pra não cair no mover-cursor da seta pura.
      const ctrl = ev.ctrlKey || ev.metaKey;
      if ((ev.altKey && ev.key === "ArrowLeft") || ev.key === "Backspace") {
        ev.preventDefault();
        onVoltar?.();
        return;
      }
      if (ev.altKey && ev.key === "ArrowRight") {
        ev.preventDefault();
        onAvancar?.();
        return;
      }
      if (ev.altKey && ev.key === "ArrowUp") {
        ev.preventDefault();
        onAcima?.();
        return;
      }
      if (ev.key === "F5") {
        ev.preventDefault();
        recarregar();
        return;
      }
      if (ctrl && ev.shiftKey && (ev.key === "N" || ev.key === "n")) {
        ev.preventDefault();
        criarPastaNova(currentPath);
        return;
      }
      if (ctrl && (ev.key === "1" || ev.key === "2" || ev.key === "3")) {
        ev.preventDefault();
        setModo(ev.key === "1" ? "detalhes" : ev.key === "2" ? "lista" : "grade");
        return;
      }
      if (ctrl && (ev.key === "h" || ev.key === "H")) {
        ev.preventDefault();
        setMostrarOcultos((v) => !v);
        return;
      }
      if (ctrl && (ev.key === "f" || ev.key === "F")) {
        ev.preventDefault();
        filtroRef.current?.focus();
        return;
      }
      if (paths.length === 0) return;
      const atual = selecao.cursor ? paths.indexOf(selecao.cursor) : -1;
      const base = atual < 0 ? 0 : atual;
      const shift = ev.shiftKey;

      switch (ev.key) {
        case "ArrowRight":
          ev.preventDefault();
          moverCursor(base + 1, shift);
          break;
        case "ArrowLeft":
          ev.preventDefault();
          moverCursor(base - 1, shift);
          break;
        case "ArrowDown":
          ev.preventDefault();
          moverCursor(base + cols, shift);
          break;
        case "ArrowUp":
          ev.preventDefault();
          moverCursor(base - cols, shift);
          break;
        case "Home":
          ev.preventDefault();
          moverCursor(0, shift);
          break;
        case "End":
          ev.preventDefault();
          moverCursor(paths.length - 1, shift);
          break;
        case "Enter": {
          ev.preventDefault();
          const alvo = atual < 0 ? undefined : itens[atual];
          if (alvo) abrirItem(alvo);
          break;
        }
        case "a":
        case "A":
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            setSelecao((s) => selecionarTudo(paths, s));
          }
          break;
        // #680: Ctrl+C/X/V ligam nos MESMOS handlers do menu (área de
        // transferência interna do shell) — copiar/recortar a seleção, colar na
        // pasta atual (o colar já passa pelo fluxo de conflito/progresso).
        case "c":
        case "C":
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            const alvos = Array.from(selecao.selecionados);
            if (alvos.length > 0) acoesMenu.copiar(alvos);
          }
          break;
        case "x":
        case "X":
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            const alvos = Array.from(selecao.selecionados);
            if (alvos.length > 0) acoesMenu.recortar(alvos);
          }
          break;
        case "v":
        case "V":
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            acoesMenu.colar(currentPath);
          }
          break;
        case "F2": {
          ev.preventDefault();
          const alvo = atual < 0 ? undefined : itens[atual];
          if (alvo) setRenomeando(alvo.path);
          break;
        }
        case "Delete": {
          ev.preventDefault();
          const alvos = Array.from(selecao.selecionados);
          if (alvos.length === 0) break;
          // #849: Del repetido não empilha ops — o guard dedup por caminho.
          if (ev.shiftKey) setConfirmarPerm(alvos);
          else excluirComGuard(alvos, false);
          break;
        }
        case "Escape": {
          // #714 (Wagner): ESC na lista LIMPA a seleção. Se algo ficou "renomeando"
          // sem o input focado (foco escapou), cancela o rename também.
          ev.preventDefault();
          if (renomeando) setRenomeando(null);
          setSelecao(SELECAO_VAZIA);
          break;
        }
        default:
          break;
      }
    },
    [
      paths,
      selecao.cursor,
      selecao.selecionados,
      cols,
      moverCursor,
      itens,
      abrirItem,
      excluirComGuard,
      renomeando,
      acoesMenu,
      currentPath,
      onVoltar,
      onAvancar,
      onAcima,
      recarregar,
      criarPastaNova,
    ],
  );

  const alternarOrdem = useCallback((chave: ChaveOrdem) => {
    setOrdem((o) =>
      o.chave === chave
        ? { chave, direcao: o.direcao === "asc" ? "desc" : "asc" }
        : { chave, direcao: "asc" },
    );
  }, []);

  // #714/#739: monta os itens do menu de contexto de um item SOB DEMANDA (o
  // ComMenu chama esta thunk só ao abrir, passando o Shift do clique pro gate de
  // exclusão permanente) — não mais um objeto por-linha a cada render. Lê
  // seleção/clipboard por ref (estável), e os alvos consideram o item clicado
  // mesmo que o setSelecao do right-click ainda não tenha aplicado.
  const construirMenuItem = useCallback(
    (entry: FsEntry, shift: boolean): ItemMenu[] => {
      const sel = selecaoRef.current.selecionados;
      const alvos = sel.has(entry.path) ? Array.from(sel) : [entry.path];
      return getFileContextMenu(
        entry,
        alvos,
        clipboardRef.current ?? null,
        acoesMenu,
        rotulosMenu,
        { permanente: shift },
      );
    },
    [acoesMenu, rotulosMenu],
  );
  // Right-click num item FORA da seleção corrente passa a selecioná-lo (pra o
  // menu agir sobre ele). Estável (lê refs) → não quebra a memoização das linhas.
  const aoAbrirMenu = useCallback((entry: FsEntry) => {
    if (!selecaoRef.current.selecionados.has(entry.path)) {
      const idx = pathsRef.current.indexOf(entry.path);
      if (idx >= 0) setSelecao(selecionarUnico(pathsRef.current, idx));
    }
  }, []);
  const cancelarRename = useCallback(() => setRenomeando(null), []);

  // #777: com TUDO selecionado (Ctrl+A) o anel do cursor sobra num único item
  // (o que estava selecionado antes) e destoa da seleção uniforme. Nesse caso
  // some o anel — a seleção (bg) já cobre todos; o cursor segue valendo pro
  // teclado, só não pinta o anel destoante.
  const todosSelec =
    itens.length > 0 && selecao.selecionados.size >= itens.length;

  // --- Render de uma linha virtual (fatia de `cols` itens) ------------------
  // #739 (F4): cada item é um `<ItemArquivo>` MEMOIZADO; esta função só monta os
  // elementos (props estáveis + sel/cursor/editando por item). No scroll/seleção,
  // os itens que não mudaram não re-renderizam.
  const itemProps = (entry: FsEntry, index: number, m: ModoView) => ({
    entry,
    index,
    modo: m,
    sel: selecao.selecionados.has(entry.path),
    cursor: selecao.cursor === entry.path && !todosSelec,
    editando: renomeando === entry.path,
    idioma,
    labelTipoPasta: t.arquivos.tipoPasta,
    labelTipoArquivo: t.arquivos.tipoArquivo,
    onClicar: aoClicar,
    onAbrir: abrirItem,
    onAbrirMenu: aoAbrirMenu,
    construirMenu: construirMenuItem,
    onConfirmarRename: confirmarRename,
    onCancelarRename: cancelarRename,
  });

  function renderLinha(linhaIndex: number): ReactNode {
    const fatia = itens.slice(linhaIndex * cols, linhaIndex * cols + cols);

    if (modo === "grade") {
      return (
        <div
          className="grid gap-2 px-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
        >
          {fatia.map((entry, i) => (
            <ItemArquivo
              key={entry.path}
              {...itemProps(entry, linhaIndex * cols + i, "grade")}
            />
          ))}
        </div>
      );
    }

    // Lista / Detalhes: 1 item por linha.
    const entry = fatia[0];
    if (!entry) return null;
    return (
      <ItemArquivo
        key={entry.path}
        {...itemProps(entry, linhaIndex * cols, modo)}
      />
    );
  }

  const selCount = selecao.selecionados.size;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Toolbar: views + filtro in-folder + ocultos + toggle do inspector */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          <BotaoView
            ativo={modo === "detalhes"}
            onClick={() => setModo("detalhes")}
            label={t.arquivos.viewDetalhes}
            icon={<TableIcon className="size-4" />}
          />
          <BotaoView
            ativo={modo === "lista"}
            onClick={() => setModo("lista")}
            label={t.arquivos.viewLista}
            icon={<List className="size-4" />}
          />
          <BotaoView
            ativo={modo === "grade"}
            onClick={() => setModo("grade")}
            label={t.arquivos.viewGrade}
            icon={<LayoutGrid className="size-4" />}
          />
        </div>

        {/* Filtro in-folder (as-you-type) */}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={filtroRef}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            onKeyDown={(e) => {
              // ESC no filtro: com texto, LIMPA e não propaga (senão o ESC da
              // lista limparia a seleção junto); vazio, só tira o foco do campo.
              if (e.key === "Escape") {
                if (filtro) {
                  e.preventDefault();
                  e.stopPropagation();
                  setFiltro("");
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
            placeholder={t.arquivos.filtrar}
            aria-label={t.arquivos.filtrar}
            className="h-8 pl-8 pr-8"
          />
          {filtro && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
              onClick={() => setFiltro("")}
              aria-label={t.arquivos.limparFiltro}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={mostrarOcultos ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            onClick={() => setMostrarOcultos((v) => !v)}
            aria-pressed={mostrarOcultos}
            aria-label={t.arquivos.mostrarOcultos}
            title={t.arquivos.mostrarOcultos}
          >
            {mostrarOcultos ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
          </Button>
          {onToggleInspector && (
            <Button
              variant={mostrarInspector ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              onClick={onToggleInspector}
              aria-pressed={mostrarInspector}
              aria-label={t.arquivos.detalhes}
              title={t.arquivos.detalhes}
            >
              {mostrarInspector ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRight className="size-4" />
              )}
            </Button>
          )}
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {selCount > 0
              ? preencher(t.arquivos.itensSelec, { n: selCount })
              : preencher(t.arquivos.total, { n: itens.length })}
          </span>
        </div>
      </div>

      {/* CTA de caminhos longos (#681): só quando o caminho passa de MAX_PATH e o
          suporte está desligado. Habilitar dispara UAC (Tauri) e re-checa. */}
      {mostrarLongPathCta && (
        <Alert variant="warning" className="shrink-0">
          <TriangleAlert />
          <AlertTitle>{t.arquivos.longPathAviso}</AlertTitle>
          <AlertAction>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void habilitarLongPaths()}
              disabled={habilitandoLong}
            >
              {habilitandoLong && (
                <Spinner className="size-3.5" />
              )}
              {t.arquivos.longPathHabilitar}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {/* #854: a LISTA (cabeçalho + área virtualizada) mora no seu PRÓPRIO card —
          a toolbar (navbar + views/filtro) acima fica bare no topo da
          content-area, separada da lista. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      {/* Cabeçalho da tabela (só em Detalhes) */}
      {modo === "detalhes" && (
        <div
          // #768: alinha com o recuo das linhas (px-1.5 do wrapper + px-2 do
          // conteúdo da linha = 14px) pra as colunas do cabeçalho baterem.
          className="grid shrink-0 items-center gap-2 border-b px-3.5 pb-1"
          style={{ gridTemplateColumns: COLS_DETALHES }}
        >
          <CabecalhoOrd
            label={t.arquivos.colNome}
            chave="nome"
            ordem={ordem}
            onClick={alternarOrdem}
          />
          <CabecalhoOrd
            label={t.arquivos.colModificado}
            chave="modificado"
            ordem={ordem}
            onClick={alternarOrdem}
          />
          <CabecalhoOrd
            label={t.arquivos.colTipo}
            chave="tipo"
            ordem={ordem}
            onClick={alternarOrdem}
          />
          <CabecalhoOrd
            label={t.arquivos.colTamanho}
            chave="tamanho"
            ordem={ordem}
            onClick={alternarOrdem}
            alinharDireita
          />
        </div>
      )}

      {/* Área virtualizada. O menu de contexto do ESPAÇO VAZIO (Colar / Nova
          pasta / Novo arquivo) envolve o conteúdo; menus de item (linhas/tiles)
          ficam aninhados e têm precedência. */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={aoTeclar}
        onPointerDown={marquee.onPointerDown}
        onPointerMove={marquee.onPointerMove}
        onPointerUp={marquee.onPointerUp}
        className={cn(
          // #767: scrollbar padrão do app (fina, como o CommandList do Navigator),
          // em vez da nativa do SO. #770: sem `focus-visible:ring` — o anel em
          // volta da lista (ao focar via clique/shift) virava uma "borda extra"
          // sobre a borda do card externo; o card já delimita a área.
          "min-h-0 flex-1 overflow-y-auto scrollbar-fina rounded-md outline-none",
          marquee.arrastando && "select-none",
        )}
      >
        <ComMenu
          className="block min-h-full"
          itens={() =>
            getEmptySpaceContextMenu(
              currentPath,
              clipboard ?? null,
              acoesMenu,
              rotulosMenu,
            )
          }
          onClick={(e) => {
            // #748: um arrasto REAL de marquee já ajustou a seleção — não deixa o
            // clique-solto que o encerra limpar tudo em seguida. Clique simples no
            // vazio (sem arrasto) segue limpando.
            if (marquee.arrastouRef.current) {
              marquee.arrastouRef.current = false;
              return;
            }
            if (e.target === e.currentTarget) setSelecao(SELECAO_VAZIA);
          }}
        >
          {carregando ? (
            <div className="flex h-full items-center justify-center py-10">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : erro ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <AlertCircle className="size-8" />
              <p className="text-sm">{t.arquivos.erroLer}</p>
            </div>
          ) : itens.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <FolderOpen className="size-8" />
              <p className="text-sm">{t.arquivos.vazio}</p>
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virtualizer.getVirtualItems().map((vr) => (
                <div
                  key={vr.key}
                  data-index={vr.index}
                  // #768: nas views de 1 item por linha (detalhes/lista) a linha
                  // vai edge-to-edge; um respiro lateral (px-1.5) impede que o
                  // realce da seleção (bg + cantos arredondados) seja cortado
                  // rente à borda/scrollbar. Grade fica sem — os tiles já vêm
                  // recuados pelo grid, e o marquee da grade depende do padX=4.
                  className={modo === "grade" ? undefined : "px-1.5"}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vr.start}px)`,
                  }}
                >
                  {renderLinha(vr.index)}
                </div>
              ))}
              {/* #748: retângulo do marquee — coords de conteúdo (rola junto). */}
              {marquee.rect && (
                <div
                  className="pointer-events-none absolute z-10 rounded-[2px] border border-primary/70 bg-primary/15"
                  style={{
                    left: marquee.rect.x1,
                    top: marquee.rect.y1,
                    width: marquee.rect.x2 - marquee.rect.x1,
                    height: marquee.rect.y2 - marquee.rect.y1,
                  }}
                />
              )}
            </div>
          )}
        </ComMenu>
      </div>
      </div>

      {/* #714: confirmação da exclusão PERMANENTE (Shift+Delete / item do menu).
          A Lixeira não confirma; só a permanente passa por aqui. */}
      <AlertDialog
        open={confirmarPerm !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmarPerm(null);
        }}
      >
        <AlertDialogContent className="max-w-sm!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.arquivos.confirmarExclusaoPermTitulo}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preencher(t.arquivos.confirmarExclusaoPerm, {
                n: confirmarPerm?.length ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.arquivos.cancelar}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const alvos = confirmarPerm;
                setConfirmarPerm(null);
                // #849: mesmo guard (dedup + feedback) da exclusão permanente.
                if (alvos && alvos.length > 0) excluirComGuard(alvos, true);
              }}
            >
              {t.arquivos.excluirPerm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BotaoView({
  ativo,
  onClick,
  label,
  icon,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Button
      variant={ativo ? "secondary" : "ghost"}
      size="sm"
      className="h-8 gap-1.5"
      onClick={onClick}
      aria-pressed={ativo}
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Button>
  );
}

function CabecalhoOrd({
  label,
  chave,
  ordem,
  onClick,
  alinharDireita,
}: {
  label: string;
  chave: ChaveOrdem;
  ordem: Ordem;
  onClick: (chave: ChaveOrdem) => void;
  alinharDireita?: boolean;
}) {
  const ativo = ordem.chave === chave;
  return (
    <button
      type="button"
      onClick={() => onClick(chave)}
      className={cn(
        "flex items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground",
        alinharDireita && "justify-end",
      )}
    >
      <span className="truncate">{label}</span>
      {ativo &&
        (ordem.direcao === "asc" ? (
          <ChevronUp className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        ))}
    </button>
  );
}
