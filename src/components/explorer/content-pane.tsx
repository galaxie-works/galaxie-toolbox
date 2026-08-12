import {
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

// --- Cache LRU + carregador preguiçoso do convertFileSrc -------------------
let convertFn: ((p: string) => string) | null = null;
let convertPromise: Promise<void> | null = null;
function garantirConvert(): Promise<void> {
  if (convertFn) return Promise.resolve();
  if (!convertPromise) {
    convertPromise = import("@tauri-apps/api/core").then((m) => {
      convertFn = m.convertFileSrc;
    });
  }
  return convertPromise;
}

const THUMB_MAX = 200;
const thumbCache = new Map<string, string>();
function cacheGet(path: string): string | undefined {
  const v = thumbCache.get(path);
  if (v !== undefined) {
    thumbCache.delete(path);
    thumbCache.set(path, v);
  }
  return v;
}
function cacheSet(path: string, src: string): void {
  if (thumbCache.has(path)) thumbCache.delete(path);
  thumbCache.set(path, src);
  if (thumbCache.size > THUMB_MAX) {
    const primeiro = thumbCache.keys().next().value;
    if (primeiro !== undefined) thumbCache.delete(primeiro);
  }
}

/**
 * Miniatura de imagem carregada só quando visível (IntersectionObserver) e
 * apenas dentro do Tauri. Fora do Tauri, ou se a imagem falhar, mostra o
 * `fallback` (o ícone). O src resolvido fica num cache LRU por caminho.
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
  const [src, setSrc] = useState<string | null>(
    () => cacheGet(entry.path) ?? null,
  );
  const [erro, setErro] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!TAURI || src || erro) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void garantirConvert().then(() => {
          if (!convertFn) return;
          const url = convertFn(entry.path);
          cacheSet(entry.path, url);
          setSrc(url);
        });
      },
      { rootMargin: "150px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [entry.path, src, erro]);

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

/** Ícone (ou miniatura, se imagem) de uma entrada. */
function CelulaIcone({
  entry,
  boxClass,
  iconClass,
}: {
  entry: FsEntry;
  boxClass: string;
  iconClass: string;
}) {
  const { Icon, cor } = iconeParaEntry(entry);
  const icone = <Icon className={cn(iconClass, cor)} />;
  if (!ehImagem(entry)) {
    return (
      <span className={cn("flex items-center justify-center", boxClass)}>
        {icone}
      </span>
    );
  }
  return <Miniatura entry={entry} boxClass={boxClass} fallback={icone} />;
}

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
  // #714: rename in-place (path em edição), gate de exclusão permanente (Shift no
  // clique direito) e o dialog de confirmação da exclusão permanente.
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [shiftDelete, setShiftDelete] = useState(false);
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

  // #681: reporta a seleção como FsEntry[] pro shell (InspectorPane). Recalcula a
  // partir do Set sobre a lista visível — some da seleção reportada o que o filtro
  // esconder.
  useEffect(() => {
    if (!onSelecaoChange) return;
    onSelecaoChange(itens.filter((e) => selecao.selecionados.has(e.path)));
  }, [selecao, itens, onSelecaoChange]);

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
      paraLixeira: (paths) => void comRefresh(() => paraLixeira(paths)),
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
      // Propriedades (v1): seleciona o item pra o InspectorPane (S5) mostrá-lo.
      propriedades: (entry) => {
        const idx = paths.indexOf(entry.path);
        if (idx >= 0) setSelecao(selecionarUnico(paths, idx));
      },
    }),
    [
      abrirItem,
      colar,
      iniciarRename,
      criarPastaNova,
      criarArquivoNovo,
      comRefresh,
      onClipboardChange,
      paths,
      t.arquivos.erroOperacao,
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
          if (ev.shiftKey) setConfirmarPerm(alvos);
          else void comRefresh(() => paraLixeira(alvos));
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
      comRefresh,
    ],
  );

  const alternarOrdem = useCallback((chave: ChaveOrdem) => {
    setOrdem((o) =>
      o.chave === chave
        ? { chave, direcao: o.direcao === "asc" ? "desc" : "asc" }
        : { chave, direcao: "asc" },
    );
  }, []);

  // #714: itens do menu de contexto de um item (com o gate de Shift atual) +
  // handler de abertura (Shift → exclusão permanente; right-click seleciona o
  // item quando ele não faz parte da seleção corrente).
  const menuDe = useCallback(
    (entry: FsEntry) =>
      getFileContextMenu(
        entry,
        Array.from(selecao.selecionados),
        clipboard ?? null,
        acoesMenu,
        rotulosMenu,
        { permanente: shiftDelete },
      ),
    [selecao.selecionados, clipboard, acoesMenu, rotulosMenu, shiftDelete],
  );
  const aoAbrirMenu = useCallback(
    (entry: FsEntry, shift: boolean) => {
      setShiftDelete(shift);
      if (!selecao.selecionados.has(entry.path)) {
        const idx = paths.indexOf(entry.path);
        if (idx >= 0) setSelecao(selecionarUnico(paths, idx));
      }
    },
    [selecao.selecionados, paths],
  );

  // Rótulo do nome (ou o campo de rename in-place, quando este item é o alvo).
  function nomeOuRename(entry: FsEntry, spanClass: string): ReactNode {
    if (renomeando !== entry.path) {
      return <span className={spanClass}>{entry.name}</span>;
    }
    return (
      <RenameInput
        inicial={entry.name}
        onConfirmar={(nome, opts) => confirmarRename(entry, nome, opts)}
        onCancelar={() => setRenomeando(null)}
      />
    );
  }

  // --- Render de uma linha virtual (fatia de `cols` itens) ------------------
  function renderLinha(linhaIndex: number): ReactNode {
    const fatia = itens.slice(linhaIndex * cols, linhaIndex * cols + cols);

    if (modo === "grade") {
      return (
        <div
          className="grid gap-2 px-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
        >
          {fatia.map((entry, i) => {
            const index = linhaIndex * cols + i;
            const sel = selecao.selecionados.has(entry.path);
            const cursor = selecao.cursor === entry.path;
            const editando = renomeando === entry.path;
            const classe = cn(
              "flex h-[108px] w-full flex-col items-center gap-1.5 rounded-lg border border-transparent p-2 text-center outline-none transition-colors",
              sel ? "bg-accent" : "hover:bg-accent/50",
              cursor && "ring-2 ring-ring/60",
            );
            const conteudo = (
              <>
                <CelulaIcone entry={entry} boxClass="size-12" iconClass="size-9" />
                {nomeOuRename(
                  entry,
                  "line-clamp-2 w-full break-words text-xs leading-tight",
                )}
              </>
            );
            return (
              <ComMenu
                key={entry.path}
                itens={menuDe(entry)}
                onOpen={(shift) => aoAbrirMenu(entry, shift)}
              >
                {editando ? (
                  <div className={classe}>{conteudo}</div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => aoClicar(index, e)}
                    onDoubleClick={() => abrirItem(entry)}
                    className={classe}
                  >
                    {conteudo}
                  </button>
                )}
              </ComMenu>
            );
          })}
        </div>
      );
    }

    // Lista / Detalhes: 1 item por linha.
    const entry = fatia[0];
    if (!entry) return null;
    const index = linhaIndex * cols;
    const sel = selecao.selecionados.has(entry.path);
    const cursor = selecao.cursor === entry.path;
    const editando = renomeando === entry.path;

    if (modo === "lista") {
      const classe = cn(
        "flex h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left outline-none",
        sel ? "bg-accent" : "hover:bg-accent/50",
        cursor && "ring-2 ring-ring/60",
      );
      const conteudo = (
        <>
          <CelulaIcone entry={entry} boxClass="size-5" iconClass="size-4" />
          {nomeOuRename(entry, "min-w-0 flex-1 truncate text-sm")}
        </>
      );
      return (
        <ComMenu
          className="w-full"
          itens={menuDe(entry)}
          onOpen={(shift) => aoAbrirMenu(entry, shift)}
        >
          {editando ? (
            <div className={classe}>{conteudo}</div>
          ) : (
            <button
              type="button"
              onClick={(e) => aoClicar(index, e)}
              onDoubleClick={() => abrirItem(entry)}
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
          <CelulaIcone entry={entry} boxClass="size-5" iconClass="size-4" />
          {nomeOuRename(entry, "min-w-0 truncate text-sm")}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {formatarDataArquivo(entry.modifiedMs, idioma)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {rotuloTipo(entry, {
            pasta: t.arquivos.tipoPasta,
            arquivo: t.arquivos.tipoArquivo,
          })}
        </span>
        <span className="truncate text-right text-xs text-muted-foreground tabular-nums">
          {entry.isDir ? "" : formatBytes(entry.size)}
        </span>
      </>
    );
    return (
      <ComMenu
        className="w-full"
        itens={menuDe(entry)}
        onOpen={(shift) => aoAbrirMenu(entry, shift)}
      >
        {editando ? (
          <div className={classe} style={{ gridTemplateColumns: COLS_DETALHES }}>
            {conteudo}
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => aoClicar(index, e)}
            onDoubleClick={() => abrirItem(entry)}
            className={classe}
            style={{ gridTemplateColumns: COLS_DETALHES }}
          >
            {conteudo}
          </button>
        )}
      </ComMenu>
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
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
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

      {/* Cabeçalho da tabela (só em Detalhes) */}
      {modo === "detalhes" && (
        <div
          className="grid shrink-0 items-center gap-2 border-b px-2 pb-1"
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
        className="min-h-0 flex-1 overflow-y-auto rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
      >
        <ComMenu
          className="block min-h-full"
          itens={getEmptySpaceContextMenu(
            currentPath,
            clipboard ?? null,
            acoesMenu,
            rotulosMenu,
          )}
          onOpen={() => setShiftDelete(false)}
          onClick={(e) => {
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
            </div>
          )}
        </ComMenu>
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
                if (alvos && alvos.length > 0) {
                  void comRefresh(() => excluirPermanente(alvos));
                }
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
