import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { DayButton } from "react-day-picker";
import { Frame, FramePanel } from "@/components/reui/frame";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DropdownProps } from "react-day-picker";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  ComporMensagem,
  type ComporMensagemHandle,
} from "@/components/compose/compor-mensagem";
import { toast } from "sonner";
import { toastIcone, toastDownload, toastMensagem } from "@/lib/toasts";
import * as api from "@/lib/api";
import { preencher, useIdioma } from "@/lib/idioma";
import { cn, comLoginHint } from "@/lib/utils";
import type {
  AnexoEmail,
  AppUser,
  EmailDetalhe,
  EmailItem,
  EventoAgenda,
  EventoDetalhe,
  PastaEmail,
  Participante,
} from "@/lib/types";
import {
  Archive,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FilePen,
  Flag,
  Forward,
  Inbox,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Send as SendIcon,
  ShieldAlert,
  Star,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

// --- helpers de data/horário ------------------------------------------------

function comZ(iso: string): string {
  return iso.endsWith("Z") ? iso : iso + "Z";
}

function hora(iso: string, idioma: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" });
}

function faixaHora(ini: string, fim: string, idioma: string): string {
  const a = hora(ini, idioma);
  const b = hora(fim, idioma);
  return b ? `${a} – ${b}` : a;
}

/** Data + hora curtas para a lista (hoje = só hora; senão data curta + hora). */
function quandoCurto(iso: string, idioma: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const hora = d.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return hora;
  const mesmoAno = d.getFullYear() === hoje.getFullYear();
  const data = d.toLocaleDateString(idioma, {
    day: "2-digit",
    month: "short",
    year: mesmoAno ? undefined : "2-digit",
  });
  return `${data} · ${hora}`;
}

// --- avatares dos participantes --------------------------------------------

function GrupoParticipantes({
  participantes,
  total,
}: {
  participantes: Participante[];
  total: number;
}) {
  if (participantes.length === 0) return null;
  const extra = total - participantes.length;
  return (
    <AvatarGroup>
      {participantes.map((p) => (
        <Avatar key={p.email || p.nome} size="sm">
          {p.foto && <AvatarImage src={p.foto} alt={p.nome} />}
          <AvatarFallback>{p.iniciais}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && <AvatarGroupCount>+{extra}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

// --- corpo (html/texto) do Graph -------------------------------------------

/**
 * Corpo HTML renderizado num IFRAME isolado (como Outlook/Gmail fazem). Motivos:
 * (1) o CSS do nosso app não mutila o layout do e-mail (e vice-versa);
 * (2) e-mails de largura fixa (tabelas 600px+) são ESCALADOS pra caber no painel
 *     em vez de cortar — não-responsividade é do remetente, mas mitigamos aqui.
 * `sandbox` sem `allow-scripts` = nenhum script do e-mail roda.
 */
function CorpoHtml({ corpo }: { corpo: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(120);

  const doc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
      // overflow:hidden garante ZERO scrollbar interna do iframe — nós ajustamos
      // a altura por fora; a largura encaixa via `zoom` (reflui o layout).
      `<style>html,body{margin:0;padding:0;overflow:hidden}body{background:#fff;` +
      `color:#111;font-family:system-ui,-apple-system,Segoe UI,sans-serif;` +
      `font-size:14px;line-height:1.5;padding:6px}img{max-width:100%;height:auto}` +
      `a{color:#7c3aed}</style></head><body>${corpo}</body></html>`,
    [corpo]
  );

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let ultimaLargura = 0;
    const ajustar = () => {
      try {
        const d = iframe.contentDocument;
        const body = d?.body;
        if (!body) return;
        // `zoom` (Chromium/WebView2) escala reflowando: a largura passa a caber.
        body.style.zoom = "1";
        const conteudo = body.scrollWidth;
        const disponivel = iframe.clientWidth;
        const zoom = conteudo > disponivel && conteudo > 0 ? disponivel / conteudo : 1;
        body.style.zoom = String(zoom);
        // altura VISÍVEL (pós-zoom) via bounding rect; setAltura só se mudou de
        // verdade (evita re-render à toa).
        const h = Math.ceil(body.getBoundingClientRect().height) + 4;
        setAltura((a) => (Math.abs(a - h) > 1 ? h : a));
      } catch {
        /* srcDoc é same-origin; catch só por segurança */
      }
    };
    const onLoad = () => {
      ultimaLargura = iframe.clientWidth;
      ajustar();
      const d = iframe.contentDocument;
      d?.querySelectorAll("img").forEach((img) => {
        if (!img.complete) img.addEventListener("load", ajustar, { once: true });
      });
    };
    iframe.addEventListener("load", onLoad);
    // IMPORTANTE: só re-mede quando a LARGURA muda (arrastar o splitter). Reagir
    // à altura criava loop de feedback (setAltura -> resize -> ajustar -> cresce).
    const ro = new ResizeObserver(() => {
      const w = iframe.clientWidth;
      if (w !== ultimaLargura) {
        ultimaLargura = w;
        ajustar();
      }
    });
    ro.observe(iframe);
    return () => {
      iframe.removeEventListener("load", onLoad);
      ro.disconnect();
    };
  }, [doc]);

  return (
    <iframe
      ref={ref}
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups"
      title="e-mail"
      scrolling="no"
      className="w-full border-0 bg-white"
      style={{ height: altura }}
    />
  );
}

function CorpoMensagem({ corpo, tipo }: { corpo: string; tipo: "html" | "text" }) {
  const { t } = useIdioma();
  if (!corpo.trim()) {
    return <p className="text-sm text-muted-foreground">{t.controlRoom.semCorpo}</p>;
  }
  if (tipo === "html") return <CorpoHtml corpo={corpo} />;
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{corpo}</p>
  );
}

// --- empty states (reui c-empty-15 / c-empty-20) ---------------------------

/** Ilustração de cards empilhados (c-empty-15) — pasta de e-mail vazia. */
function IlustracaoCards() {
  return (
    <div className="relative h-24 w-52" aria-hidden="true">
      <div className="absolute inset-x-6 top-0 h-6 rounded-t-lg border border-border/50 bg-muted/60 dark:bg-muted/30" />
      <div className="absolute inset-x-3 top-3 h-6 rounded-t-lg border border-border/60 bg-muted/80 dark:bg-muted/50" />
      <div className="absolute inset-x-0 top-6 flex h-16 items-center gap-3 rounded-lg border border-border bg-background px-4 shadow-sm">
        <div className="size-8 shrink-0 rounded bg-muted" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-2.5 w-3/4 rounded bg-muted" />
          <div className="h-2 w-1/2 rounded bg-muted/60" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-background/0 via-background/60 to-background" />
    </div>
  );
}

/** Ilustração de calendário (c-empty-20) — dia sem eventos. */
function IlustracaoCalendario() {
  return (
    <svg
      width="140"
      height="122"
      viewBox="0 0 160 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="24" y="28" width="112" height="96" rx="10" className="fill-background stroke-border" strokeWidth="1.5" />
      <rect x="24" y="28" width="112" height="24" rx="10" className="fill-muted dark:fill-muted/60" />
      <rect x="24" y="42" width="112" height="10" className="fill-muted dark:fill-muted/60" />
      <line x1="56" y1="20" x2="56" y2="36" className="stroke-muted-foreground/30" strokeWidth="3" strokeLinecap="round" />
      <line x1="104" y1="20" x2="104" y2="36" className="stroke-muted-foreground/30" strokeWidth="3" strokeLinecap="round" />
      {[68, 86, 104].map((cy) =>
        [48, 68, 88, 108].map((cx) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" className="fill-muted-foreground/10" />
        ))
      )}
      <circle cx="88" cy="86" r="4" className="fill-primary/25" />
      <circle cx="88" cy="86" r="2" className="fill-primary" />
      <circle cx="148" cy="56" r="2.5" className="fill-primary/10" />
    </svg>
  );
}

function PastaVazia({ t }: { t: ReturnType<typeof useIdioma>["t"] }) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia>
          <IlustracaoCards />
        </EmptyMedia>
        <EmptyTitle>{t.controlRoom.semMensagensTitulo}</EmptyTitle>
        <EmptyDescription>{t.controlRoom.semMensagens}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Contexto exibido no painel de detalhe quando há multi-seleção (c-empty-15). */
function MultiSelecaoContexto({
  n,
  onExcluir,
  onLimpar,
  t,
}: {
  n: number;
  onExcluir: () => void;
  onLimpar: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  return (
    <section className="flex h-full items-center justify-center rounded-xl border bg-card">
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia>
            <IlustracaoCards />
          </EmptyMedia>
          <EmptyTitle>
            {preencher(
              n === 1 ? t.controlRoom.conversaSelecionada : t.controlRoom.conversasSelecionadas,
              { n }
            )}
          </EmptyTitle>
          <EmptyDescription>{t.controlRoom.multiSelecaoDica}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onLimpar}>
              {t.controlRoom.limparSelecao}
            </Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onExcluir}
            >
              <Trash2 /> {t.controlRoom.excluirSelecionados}
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </section>
  );
}

function AgendaVazia({ t }: { t: ReturnType<typeof useIdioma>["t"] }) {
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia>
          <IlustracaoCalendario />
        </EmptyMedia>
        <EmptyTitle>{t.controlRoom.semEventosTitulo}</EmptyTitle>
        <EmptyDescription>{t.controlRoom.semEventos}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ===========================================================================
// Painel 1 — pastas
// ===========================================================================

const ICONE_PASTA: Record<string, React.ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  drafts: FilePen,
  sentitems: SendIcon,
  archive: Archive,
  junkemail: ShieldAlert,
  deleteditems: Trash2,
};

const GRUPO_MAIL = ["inbox", "drafts", "sentitems"];

function rotuloPasta(tipo: string, nome: string, t: ReturnType<typeof useIdioma>["t"]): string {
  const m: Record<string, string> = {
    inbox: t.controlRoom.pastaInbox,
    drafts: t.controlRoom.pastaDrafts,
    sentitems: t.controlRoom.pastaSent,
    archive: t.controlRoom.pastaArchive,
    junkemail: t.controlRoom.pastaJunk,
    deleteditems: t.controlRoom.pastaTrash,
  };
  return m[tipo] ?? nome;
}

function FolderSidebar({
  pastas,
  sel,
  onSel,
  onNovo,
  onComposeOutlook,
  colapsada,
  t,
}: {
  pastas: PastaEmail[] | null;
  sel: string;
  onSel: (id: string) => void;
  onNovo: () => void;
  onComposeOutlook: () => void;
  colapsada: boolean;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const mail = (pastas ?? []).filter((p) => GRUPO_MAIL.includes(p.tipo));
  const outras = (pastas ?? []).filter((p) => !GRUPO_MAIL.includes(p.tipo));

  // Subpastas (childFolders): carregadas sob demanda ao expandir.
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [filhos, setFilhos] = useState<Record<string, PastaEmail[]>>({});
  const alternarExpandir = async (id: string) => {
    setExpandidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    if (filhos[id] === undefined) {
      try {
        const cs = await api.crSubpastas(id);
        setFilhos((f) => ({ ...f, [id]: cs }));
      } catch {
        setFilhos((f) => ({ ...f, [id]: [] }));
      }
    }
  };

  const Linha = (p: PastaEmail, ehFilho = false) => {
    const Ico = ICONE_PASTA[p.tipo] ?? Inbox;
    const ativo = p.id === sel;
    const contagem = p.tipo === "drafts" || p.tipo === "sentitems" ? p.total : p.naoLidos;
    const rotulo = rotuloPasta(p.tipo, p.nome, t);
    const linhaBtn = (
      <button
        type="button"
        onClick={() => onSel(p.id)}
        title={colapsada ? rotulo : undefined}
        className={cn(
          "flex items-center rounded-md text-sm transition-colors",
          colapsada ? "relative size-9 justify-center" : "flex-1 gap-2.5 px-2.5 py-2",
          ativo ? "bg-secondary font-medium text-secondary-foreground" : "hover:bg-accent/50"
        )}
      >
        <Ico className="size-4 shrink-0 text-muted-foreground" />
        {colapsada ? (
          contagem > 0 && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
          )
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
            {contagem > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">{contagem}</span>
            )}
          </>
        )}
      </button>
    );
    if (colapsada) return <div key={p.id}>{linhaBtn}</div>;
    return (
      <div key={p.id}>
        <div className={cn("flex items-center", ehFilho && "pl-5")}>
          {!ehFilho ? (
            <button
              type="button"
              onClick={() => alternarExpandir(p.id)}
              aria-label={rotulo}
              className="grid size-5 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  expandidas.has(p.id) && "rotate-90"
                )}
              />
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          {linhaBtn}
        </div>
        {expandidas.has(p.id) &&
          (filhos[p.id] ?? []).map((c) => Linha({ ...c, tipo: "child" }, true))}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-3 rounded-xl border bg-card p-3 transition-[width] duration-200",
        colapsada ? "w-16 items-center" : "w-52"
      )}
    >
      {colapsada ? (
        <Button size="icon" onClick={onNovo} aria-label={t.controlRoom.novoEmail}>
          <PenSquare />
        </Button>
      ) : (
        <ButtonGroup className="w-full">
          <Button className="flex-1" onClick={onNovo}>
            <PenSquare /> {t.controlRoom.novoEmail}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label={t.controlRoom.composeOutlook}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onComposeOutlook}>
                {t.controlRoom.composeOutlook}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      )}

      {!pastas ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : (
        <ScrollArea className="min-h-0 w-full flex-1">
          <div className={cn(colapsada ? "flex flex-col items-center gap-0.5" : "pr-2")}>
            {!colapsada && (
              <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                {t.controlRoom.grupoMail}
              </p>
            )}
            <div className={cn("flex flex-col gap-0.5", colapsada && "items-center")}>
              {mail.map((p) => Linha(p))}
            </div>

            {outras.length > 0 && (
              <>
                {colapsada ? (
                  <Separator className="my-1.5 w-6" />
                ) : (
                  <p className="px-2.5 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                    {t.controlRoom.grupoOutras}
                  </p>
                )}
                <div className={cn("flex flex-col gap-0.5", colapsada && "items-center")}>
                  {outras.map((p) => Linha(p))}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

// ===========================================================================
// Painel 2 — lista de mensagens
// ===========================================================================

type Aba = "todos" | "naoLidos" | "sinalizados" | "anexos";

function MessageList({
  titulo,
  mensagens,
  sel,
  onSel,
  onRefresh,
  sidebarAberta,
  onToggleSidebar,
  pastaTipo,
  onEsvaziar,
  onCarregarMais,
  carregandoMais,
  temMais,
  onFlag,
  onExcluir,
  selecionados,
  setSelecionados,
  naoLidosPasta,
  t,
  idioma,
}: {
  titulo: string;
  mensagens: EmailItem[] | null;
  sel: string | null;
  onSel: (id: string) => void;
  onRefresh: () => void;
  sidebarAberta: boolean;
  onToggleSidebar: () => void;
  pastaTipo: string;
  onEsvaziar: () => void;
  onCarregarMais: () => void;
  carregandoMais: boolean;
  temMais: boolean;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void;
  selecionados: Set<string>;
  setSelecionados: React.Dispatch<React.SetStateAction<Set<string>>>;
  naoLidosPasta: number;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const [aba, setAba] = useState<Aba>("todos");
  const [busca, setBusca] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);

  // ESC limpa a busca e volta a mostrar tudo.
  const limparBusca = () => {
    setBusca("");
    setAba("todos");
  };

  const alternarSel = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filtrada = useMemo(() => {
    if (!mensagens) return [];
    const q = busca.trim().toLowerCase();
    return mensagens.filter((m) => {
      if (aba === "naoLidos" && m.lido) return false;
      if (aba === "sinalizados" && !m.sinalizado) return false;
      if (aba === "anexos" && !m.temAnexos) return false;
      if (q && !`${m.de} ${m.assunto} ${m.preview}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mensagens, aba, busca]);

  const filtrando = busca.trim() !== "" || aba !== "todos";
  // Busca/filtro só enxergam os carregados; se não achou nada e há mais páginas,
  // carrega a próxima (progressivo) até aparecer resultado ou acabar.
  useEffect(() => {
    if (filtrando && filtrada.length === 0 && temMais && !carregandoMais) onCarregarMais();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrando, filtrada.length, temMais, carregandoMais]);

  const comEstrela = mensagens?.filter((m) => m.sinalizado).length ?? 0;
  const comAnexo = mensagens?.filter((m) => m.temAnexos).length ?? 0;
  const abas: { id: Aba; label: string; n?: number }[] = [
    { id: "todos", label: t.controlRoom.abaTodos },
    // não lidos = total REAL da pasta (não só os carregados na lista)
    { id: "naoLidos", label: t.controlRoom.abaNaoLidos, n: naoLidosPasta },
    { id: "sinalizados", label: t.controlRoom.abaSinalizados, n: comEstrela },
    { id: "anexos", label: t.controlRoom.abaAnexos, n: comAnexo },
  ];

  // Teclado: ESC desfaz multi-seleção; Ctrl+A seleciona tudo (se já há ≥1);
  // ↑/↓ movem a seleção; Delete exclui.
  function navegar(e: React.KeyboardEvent) {
    if (e.key === "Escape" && selecionados.size > 0) {
      e.preventDefault();
      setSelecionados(new Set());
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && selecionados.size > 0) {
      e.preventDefault();
      setSelecionados(new Set(idsFiltrados));
      return;
    }
    if (filtrada.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = filtrada.findIndex((m) => m.id === sel);
      const prox =
        idx === -1
          ? 0
          : e.key === "ArrowDown"
            ? Math.min(filtrada.length - 1, idx + 1)
            : Math.max(0, idx - 1);
      const alvo = filtrada[prox];
      if (alvo) {
        onSel(alvo.id);
        listaRef.current
          ?.querySelector(`[data-msgid="${alvo.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Delete") {
      const alvos = selecionados.size > 0 ? [...selecionados] : sel ? [sel] : [];
      if (alvos.length > 0) {
        e.preventDefault();
        onExcluir(alvos);
      }
    }
  }

  const idsFiltrados = filtrada.map((m) => m.id);
  const todosSel = idsFiltrados.length > 0 && idsFiltrados.every((id) => selecionados.has(id));

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-3 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label={sidebarAberta ? "‹" : "›"}
        >
          {sidebarAberta ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {mensagens && (
          <Badge variant="secondary" size="sm">
            {mensagens.length}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {pastaTipo === "deleteditems" && (mensagens?.length ?? 0) > 0 && (
            <Button variant="ghost" size="sm" onClick={onEsvaziar}>
              <Trash2 /> {t.controlRoom.esvaziarLixeira}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="↻">
            <RefreshCw />
          </Button>
        </div>
      </div>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              if (selecionados.size > 0) setSelecionados(new Set());
              else limparBusca();
            }}
            placeholder={t.controlRoom.buscarEmail}
            className="h-8 w-full rounded-md border bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      </div>

      {selecionados.size > 0 ? (
        <div className="flex items-center gap-2 px-3 pb-2">
          <input
            type="checkbox"
            checked={todosSel}
            onChange={(e) =>
              setSelecionados(e.target.checked ? new Set(idsFiltrados) : new Set())
            }
            className="size-3.5 accent-primary"
            aria-label={t.controlRoom.limparSelecao}
          />
          <span className="text-xs font-medium">
            {preencher(t.controlRoom.nSelecionados, { n: selecionados.size })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              onExcluir([...selecionados]);
              setSelecionados(new Set());
            }}
          >
            <Trash2 /> {t.controlRoom.excluirSelecionados}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setSelecionados(new Set())}>
            <X />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-3 pb-2">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                aba === a.id
                  ? "bg-secondary font-medium text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {a.label}
              {a.n != null && a.n > 0 && <span className="text-muted-foreground">{a.n}</span>}
            </button>
          ))}
        </div>
      )}

      <Separator />

      {!mensagens ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : filtrada.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          {carregandoMais ? (
            <Spinner className="size-5 text-muted-foreground" />
          ) : filtrando ? (
            <p className="text-sm text-muted-foreground">{t.controlRoom.semResultados}</p>
          ) : (
            <PastaVazia t={t} />
          )}
        </div>
      ) : (
        <div
          ref={listaRef}
          tabIndex={0}
          onKeyDown={navegar}
          className="min-h-0 flex-1 overflow-y-auto scrollbar-fina outline-none"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) onCarregarMais();
          }}
        >
          <div className="flex flex-col gap-0.5 px-2 py-1">
            {filtrada.map((m) => {
              const ativo = m.id === sel;
              const marcado = selecionados.has(m.id);
              return (
                <Item
                  key={m.id}
                  size="sm"
                  data-msgid={m.id}
                  onClick={() => onSel(m.id)}
                  data-active={ativo}
                  className={cn(
                    "group/row cursor-pointer flex-nowrap gap-2.5 px-2 py-2.5",
                    ativo ? "bg-accent" : "hover:bg-accent/50",
                    !m.lido && !ativo && "bg-primary/[0.03]"
                  )}
                >
                  {/* checkbox — aparece no hover ou quando marcado */}
                  <label
                    className={cn(
                      "flex items-center self-start pt-1.5 transition-opacity",
                      !marcado && "opacity-0 group-hover/row:opacity-100"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => alternarSel(m.id)}
                      className="size-3.5 accent-primary"
                      aria-label={m.assunto}
                    />
                  </label>

                  <ItemMedia className="relative self-start">
                    <Avatar>
                      <AvatarFallback>{m.iniciais}</AvatarFallback>
                    </Avatar>
                    {!m.lido && (
                      <span className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />
                    )}
                  </ItemMedia>
                  <ItemContent className="min-w-0 gap-0.5">
                    <div className="flex items-center gap-2">
                      <ItemTitle
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          m.lido ? "font-medium" : "font-semibold"
                        )}
                      >
                        {m.de}
                      </ItemTitle>
                      {m.sinalizado && (
                        <Flag className="size-3.5 shrink-0 fill-red-500 text-red-500" />
                      )}
                      {/* data (some no hover) + ações rápidas (aparecem no hover) */}
                      <span className="shrink-0 text-xs text-muted-foreground group-hover/row:hidden">
                        {quandoCurto(m.recebido, idioma)}
                      </span>
                      <div
                        className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onFlag(m.id, !m.sinalizado)}
                          className="grid size-6 place-items-center rounded hover:bg-background"
                          aria-label={t.controlRoom.sinalizar}
                        >
                          <Flag
                            className={cn(
                              "size-3.5",
                              m.sinalizado ? "fill-red-500 text-red-500" : "text-muted-foreground"
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => onExcluir([m.id])}
                          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t.controlRoom.excluir}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className={cn("truncate text-sm", !m.lido && "font-medium")}>{m.assunto}</p>
                    <ItemDescription className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate">{m.preview}</span>
                      {m.temAnexos && <Paperclip className="size-3 shrink-0" />}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              );
            })}
          </div>
          {carregandoMais && (
            <div className="flex justify-center py-3">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ===========================================================================
// Painel 3 — detalhe da mensagem + compose inline
// ===========================================================================

function LinhaPessoas({ rotulo, nomes }: { rotulo: string; nomes: string[] }) {
  if (nomes.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">{rotulo}:</span> {nomes.join(", ")}
    </p>
  );
}

function MessageDetail({
  id,
  userEmail,
  sinalizado,
  onFlag,
  onExcluir,
  onMudou,
  t,
  idioma,
}: {
  id: string | null;
  userEmail?: string | null;
  sinalizado: boolean;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void;
  onMudou: () => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const [det, setDet] = useState<EmailDetalhe | null>(null);
  const [modo, setModo] = useState<null | "responder" | "responderTodos" | "encaminhar">(null);
  const [enviando, setEnviando] = useState(false);
  const comporRef = useRef<ComporMensagemHandle>(null);

  useEffect(() => {
    if (!id) {
      setDet(null);
      return;
    }
    let vivo = true;
    setDet(null);
    setModo(null);
    api.crEmailCorpo(id).then((d) => vivo && setDet(d)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, [id]);

  async function baixarAnexo(anexo: AnexoEmail) {
    if (!id) return;
    try {
      const caminho = await api.crBaixarAnexo(id, anexo.id);
      toastDownload({
        titulo: t.controlRoom.downloadTitulo,
        arquivo: anexo.nome,
        rotuloAbrir: t.controlRoom.abrirArquivo,
        rotuloPasta: t.controlRoom.abrirPasta,
        onAbrir: () => {
          void api.abrirCaminho(caminho);
        },
        onPasta: () => {
          void api.revelarNoExplorer(caminho);
        },
      });
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  const abrirOutlook = () =>
    det?.webLink && api.abrirAppInterno("outlook", comLoginHint(det.webLink, userEmail), "Outlook");

  async function enviar() {
    if (!id) return;
    const c = comporRef.current;
    const html = c?.getHtml() ?? "";
    const texto = c?.getTexto()?.trim() ?? "";
    if (!texto) {
      toast.error(t.controlRoom.escrevaAlgo);
      return;
    }
    const destinos =
      modo === "encaminhar"
        ? [...(c?.getPara() ?? []), ...(c?.getCc() ?? []), ...(c?.getCco() ?? [])]
        : [];
    if (modo === "encaminhar" && destinos.length === 0) {
      toast.error(t.controlRoom.informeDestino);
      return;
    }
    setEnviando(true);
    try {
      if (modo === "encaminhar") {
        await api.crEncaminhar(id, html, destinos);
        // salva os destinatários nos Contatos (best-effort, silencioso)
        api
          .crSalvarContatos(destinos.map((e) => ({ nome: e, email: e })))
          .catch(() => {});
      } else {
        await api.crResponder(id, html, modo === "responderTodos");
      }
      toastIcone(t.controlRoom.enviado, t.controlRoom.enviadoDescricao, "enviado");
      setModo(null);
      onMudou();
    } catch (e) {
      toast.error(t.controlRoom.erroEnvio, { description: String(e) });
    } finally {
      setEnviando(false);
    }
  }

  const textosCompose = {
    para: t.controlRoom.para,
    cc: t.controlRoom.ccLabel,
    cco: t.controlRoom.ccoLabel,
    assunto: t.controlRoom.assunto,
    assuntoPlaceholder: t.controlRoom.assuntoPlaceholder,
    corpoPlaceholder: t.controlRoom.corpoPlaceholder,
    mostrarCcCco: t.controlRoom.mostrarCcCco,
  };

  if (!id) {
    return (
      <section className="flex h-full flex-col items-center justify-center rounded-xl border bg-card text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-muted/60 text-muted-foreground">
          <Inbox className="size-6" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{t.controlRoom.escolhaEmail}</p>
      </section>
    );
  }

  if (!det) {
    return (
      <section className="flex h-full items-center justify-center rounded-xl border bg-card">
        <Spinner className="size-6 text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border bg-card">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => setModo("responder")}>
          <Reply /> {t.controlRoom.responder}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setModo("responderTodos")}>
          <ReplyAll /> {t.controlRoom.responderTodos}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setModo("encaminhar")}>
          <Forward /> {t.controlRoom.encaminhar}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => id && onFlag(id, !sinalizado)}
            aria-label={t.controlRoom.sinalizar}
          >
            <Flag className={cn("size-4", sinalizado && "fill-red-500 text-red-500")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => id && onExcluir([id])}
            aria-label={t.controlRoom.excluir}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={abrirOutlook} aria-label="Outlook">
            <ExternalLink />
          </Button>
        </div>
      </div>

      {/* Cabeçalho do e-mail */}
      <div className="border-b px-5 py-4">
        <h1 className="text-base font-semibold">{det.assunto}</h1>
        <div className="mt-3 flex items-start gap-3">
          <Avatar>
            <AvatarFallback>
              {det.de
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{det.de}</span>
              {det.deEmail && (
                <span className="truncate text-xs text-muted-foreground">&lt;{det.deEmail}&gt;</span>
              )}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {new Date(comZ(det.recebido)).toLocaleString(idioma)}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              <LinhaPessoas rotulo={t.controlRoom.para} nomes={det.para} />
              <LinhaPessoas rotulo={t.controlRoom.ccLabel} nomes={det.cc} />
            </div>
          </div>
        </div>
      </div>

      {/* Corpo + anexos (rola) */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-fina">
        <div className="px-5 py-4">
          <CorpoMensagem corpo={det.corpo} tipo={det.corpoTipo} />
          {det.anexos.length > 0 && (
            <>
              <Separator className="my-4" />
              <p className="mb-2 text-xs font-medium">{t.controlRoom.anexosTitulo}</p>
              <div className="flex flex-wrap gap-2">
                {det.anexos.map((a, i) => (
                  <button
                    key={a.id || i}
                    type="button"
                    onClick={() => baixarAnexo(a)}
                    className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                    title={t.controlRoom.abrirArquivo}
                  >
                    <Paperclip className="size-3.5 text-muted-foreground" />
                    <span className="max-w-40 truncate">{a.nome}</span>
                    <Download className="size-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Painel de compose (abaixo do e-mail) — redimensionável (resize-y). */}
      {modo && (
        <div className="flex max-h-[75vh] min-h-[240px] flex-col overflow-hidden border-t bg-muted/20">
          <div className="flex shrink-0 items-center gap-2 px-4 py-2">
            <span className="text-sm font-medium">
              {modo === "encaminhar"
                ? t.controlRoom.encaminhar
                : modo === "responderTodos"
                  ? t.controlRoom.responderTodos
                  : t.controlRoom.responder}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={() => setModo(null)}
              aria-label="×"
            >
              <X />
            </Button>
          </div>
          {/* arrasta a borda inferior desta área pra crescer/encolher */}
          <div className="min-h-0 flex-1 resize-y overflow-hidden px-4">
            <ComporMensagem
              key={modo}
              ref={comporRef}
              mostrarDestinatarios={modo === "encaminhar"}
              textos={textosCompose}
            />
          </div>
          <div className="flex shrink-0 justify-end gap-2 px-4 py-2">
            <Button variant="ghost" onClick={() => setModo(null)} disabled={enviando}>
              {t.controlRoom.cancelar}
            </Button>
            <Button onClick={enviar} disabled={enviando}>
              {enviando ? <Spinner className="size-4" /> : <Send />}
              {t.controlRoom.enviar}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ===========================================================================
// Painel 4 — calendário + agenda do dia (schedule-8)
// ===========================================================================

/** Dropdown de mês/ano estilizado (do @reui/c-calendar-8). */
function DropdownCalendario(props: DropdownProps) {
  const { options, value, onChange } = props;
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => {
        if (onChange) {
          onChange({ target: { value: v } } as unknown as React.ChangeEvent<HTMLSelectElement>);
        }
      }}
    >
      <SelectTrigger size="sm" className="h-7 first:grow">
        <SelectValue>{options?.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-64">
        {options?.map((o) => (
          <SelectItem key={o.value} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AgendaPanel({
  user,
  onEvento,
  t,
  idioma,
}: {
  user: AppUser;
  onEvento: (id: string) => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  void user;
  const [dia, setDia] = useState<Date>(() => new Date());
  const [mesEventos, setMesEventos] = useState<EventoAgenda[] | null>(null);

  const chaveDia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  // Busca o MÊS inteiro (uma chamada) — alimenta os pontos do calendário; a
  // lista do dia é derivada por filtro.
  const ano = dia.getFullYear();
  const mes = dia.getMonth();
  const { mesIni, mesFim } = useMemo(() => {
    const ini = new Date(ano, mes, 1, 0, 0, 0, 0);
    const fim = new Date(ano, mes + 1, 1, 0, 0, 0, 0);
    return { mesIni: ini.toISOString(), mesFim: fim.toISOString() };
  }, [ano, mes]);

  useEffect(() => {
    let vivo = true;
    setMesEventos(null);
    api.crAgenda(mesIni, mesFim).then((d) => vivo && setMesEventos(d)).catch(() => vivo && setMesEventos([]));
    return () => {
      vivo = false;
    };
  }, [mesIni, mesFim]);

  // Cores reais das categorias do Outlook (nome -> hex), carregadas uma vez.
  const [coresCat, setCoresCat] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let vivo = true;
    api
      .crCategorias()
      .then((cs) => vivo && setCoresCat(new Map(cs.map((c) => [c.nome, c.cor]))))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const agenda = useMemo(() => {
    if (!mesEventos) return null;
    const k = chaveDia(dia);
    return mesEventos.filter((ev) => {
      const d = new Date(comZ(ev.inicio));
      return !Number.isNaN(d.getTime()) && chaveDia(d) === k;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesEventos, dia]);

  // dia (YYYY-M-D) -> cores (hex) dos pontos, até 3. Só eventos COM categoria
  // definida pelo usuário no Outlook — a cor é a real da categoria.
  const pontos = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ev of mesEventos ?? []) {
      if (!ev.categorias || ev.categorias.length === 0) continue;
      const d = new Date(comZ(ev.inicio));
      if (Number.isNaN(d.getTime())) continue;
      const k = chaveDia(d);
      const arr = m.get(k) ?? [];
      for (const nome of ev.categorias) {
        if (arr.length >= 3) break;
        arr.push(coresCat.get(nome) ?? "#8A8886");
      }
      m.set(k, arr);
    }
    return m;
  }, [mesEventos, coresCat]);

  // Botão de dia com células preenchidas + pontos (schedule-8).
  const DiaBotao = (props: React.ComponentProps<typeof DayButton>) => {
    const { day, modifiers, className, ...rest } = props;
    const cores = pontos.get(chaveDia(day.date)) ?? [];
    const sel = modifiers.selected && !modifiers.range_middle;
    return (
      <Button
        variant="ghost"
        size="icon"
        data-selected-single={sel || undefined}
        className={cn(
          "relative flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-md bg-muted/50 font-normal leading-none hover:bg-muted",
          "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:hover:bg-primary",
          className
        )}
        {...rest}
      >
        {day.date.getDate()}
        {cores.length > 0 && (
          <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
            {cores.map((c, i) => (
              <span
                key={i}
                className="size-1 rounded-full"
                style={{ backgroundColor: c }}
                aria-hidden
              />
            ))}
          </span>
        )}
      </Button>
    );
  };

  const rotuloDia = dia.toLocaleDateString(idioma, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="w-80 shrink-0">
      <Frame className="h-full">
        <FramePanel className="flex h-full flex-col gap-3 p-3">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={dia}
            month={dia}
            onMonthChange={setDia}
            onSelect={(d) => d && setDia(d)}
            showOutsideDays
            className="w-full p-0 [--cell-size:--spacing(9)]"
            classNames={{
              weekdays: "flex gap-1",
              week: "mt-1 flex gap-1",
              weekday:
                "flex h-6 flex-1 items-center justify-center text-xs font-medium text-muted-foreground",
              day: "aspect-square flex-1 p-0",
            }}
            formatters={{
              formatWeekdayName: (d) =>
                d.toLocaleDateString(idioma, { weekday: "short" }).slice(0, 3).toUpperCase(),
            }}
            components={{ DayButton: DiaBotao, Dropdown: DropdownCalendario }}
          />

          <Separator />

          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold capitalize">{rotuloDia}</h3>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  setDia((d) => {
                    const n = new Date(d);
                    n.setDate(n.getDate() - 1);
                    return n;
                  })
                }
                aria-label="−1"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  setDia((d) => {
                    const n = new Date(d);
                    n.setDate(n.getDate() + 1);
                    return n;
                  })
                }
                aria-label="+1"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>

          {/* Lista de eventos: rola por dentro, com esmaecimento no fim */}
          <div className="relative min-h-0 flex-1">
            {agenda === null ? (
              <div className="flex justify-center py-8">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : agenda.length === 0 ? (
              <AgendaVazia t={t} />
            ) : (
              <div className="h-full overflow-y-auto scrollbar-fina">
                <div className="flex flex-col gap-2 pr-2 pb-6">
                  {agenda.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onEvento(ev.id)}
                      className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              ev.categoria === "event" ? "bg-info" : "bg-primary"
                            )}
                          />
                          <span className="truncate text-sm font-semibold">{ev.assunto}</span>
                        </div>
                        {ev.online && <Video className="size-3.5 shrink-0 text-muted-foreground" />}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ev.diaInteiro
                          ? t.controlRoom.diaInteiro
                          : faixaHora(ev.inicio, ev.fim, idioma)}
                      </p>
                      {ev.totalParticipantes > 0 && (
                        <div className="mt-2">
                          <GrupoParticipantes
                            participantes={ev.participantes}
                            total={ev.totalParticipantes}
                          />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* esmaecimento no fim do frame */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-card to-transparent" />
          </div>
        </FramePanel>
      </Frame>
    </div>
  );
}

// --- modal de detalhe do evento --------------------------------------------

function EventoDialog({
  id,
  userEmail,
  onClose,
}: {
  id: string | null;
  userEmail?: string | null;
  onClose: () => void;
}) {
  const { idioma, t } = useIdioma();
  const [det, setDet] = useState<EventoDetalhe | null>(null);

  useEffect(() => {
    if (!id) {
      setDet(null);
      return;
    }
    let vivo = true;
    setDet(null);
    api.crEventoCorpo(id).then((d) => vivo && setDet(d)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, [id]);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {!det ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-left">{det.assunto}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarClock className="size-4 shrink-0" />
                <span>{faixaHora(det.inicio, det.fim, idioma)}</span>
              </div>
              {(det.online || det.local) && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  {det.online ? (
                    <Video className="size-4 shrink-0" />
                  ) : (
                    <MapPin className="size-4 shrink-0" />
                  )}
                  <span>{det.online ? t.controlRoom.online : det.local}</span>
                </div>
              )}
              {det.organizador && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{t.controlRoom.organizador}:</span>{" "}
                  {det.organizador}
                </p>
              )}
              {det.participantes.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium">{t.controlRoom.convidadosTitulo}</p>
                  <div className="flex flex-wrap gap-2">
                    {det.participantes.map((p) => (
                      <div
                        key={p.email || p.nome}
                        className="flex items-center gap-2 rounded-full bg-muted/60 py-1 pr-3 pl-1"
                      >
                        <Avatar size="sm">
                          <AvatarFallback>{p.iniciais}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{p.nome}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {det.corpo.trim() && (
                <>
                  <Separator />
                  <div className="max-h-64 overflow-auto">
                    <CorpoMensagem corpo={det.corpo} tipo={det.corpoTipo} />
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              {det.online && det.joinUrl && (
                <Button onClick={() => api.openUrl(det.joinUrl!)}>
                  <Video /> {t.controlRoom.entrarReuniao}
                </Button>
              )}
              {det.webLink && (
                <Button
                  variant="outline"
                  onClick={() => api.openUrl(comLoginHint(det.webLink, userEmail))}
                >
                  <ExternalLink /> {t.controlRoom.abrirOutlook}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- modal "Nova mensagem" -------------------------------------------------

function NovaMensagemModal({
  aberto,
  onClose,
  t,
}: {
  aberto: boolean;
  onClose: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const comporRef = useRef<ComporMensagemHandle>(null);
  const [enviando, setEnviando] = useState(false);
  const textos = {
    para: t.controlRoom.para,
    cc: t.controlRoom.ccLabel,
    cco: t.controlRoom.ccoLabel,
    assunto: t.controlRoom.assunto,
    assuntoPlaceholder: t.controlRoom.assuntoPlaceholder,
    corpoPlaceholder: t.controlRoom.corpoPlaceholder,
    mostrarCcCco: t.controlRoom.mostrarCcCco,
  };

  async function enviar() {
    const c = comporRef.current;
    const para = c?.getPara() ?? [];
    const cc = c?.getCc() ?? [];
    const cco = c?.getCco() ?? [];
    if (para.length === 0) {
      toast.error(t.controlRoom.informeDestino);
      return;
    }
    setEnviando(true);
    try {
      await api.crEnviarNovo(para, cc, cco, c?.getAssunto() ?? "", c?.getHtml() ?? "");
      api
        .crSalvarContatos([...para, ...cc, ...cco].map((e) => ({ nome: e, email: e })))
        .catch(() => {});
      toastIcone(t.controlRoom.enviado, t.controlRoom.enviadoDescricao, "enviado");
      onClose();
    } catch (e) {
      toast.error(t.controlRoom.erroEnvio, { description: String(e) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[72vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-left">{t.controlRoom.novaMensagem}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ComporMensagem key={String(aberto)} ref={comporRef} mostrarAssunto textos={textos} />
        </div>
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={enviando}>
            {t.controlRoom.cancelar}
          </Button>
          <Button onClick={enviar} disabled={enviando}>
            {enviando ? <Spinner className="size-4" /> : <Send />}
            {t.controlRoom.enviar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Tela
// ===========================================================================

export function ControlRoomScreen({ user }: { user: AppUser }) {
  const { idioma, t } = useIdioma();
  const [pastas, setPastas] = useState<PastaEmail[] | null>(null);
  const [pastaSel, setPastaSel] = useState("inbox");
  const [mensagens, setMensagens] = useState<EmailItem[] | null>(null);
  const [msgSel, setMsgSel] = useState<string | null>(null);
  const [eventoSel, setEventoSel] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  // recargaPastas atualiza SÓ as contagens do sidebar, sem recarregar a lista
  // (ações como excluir/responder não devem zerar o lazy load nem o scroll).
  const [recargaPastas, setRecargaPastas] = useState(0);
  const [sidebarAberta, setSidebarAberta] = useState(true);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [novaAberta, setNovaAberta] = useState(false);
  const carregandoMaisRef = useRef(false);
  const PAGINA = 50;

  const primeiroNome = user.displayName.split(" ")[0];

  // pastas (recarrega as contagens junto com as ações e no refresh manual)
  useEffect(() => {
    let vivo = true;
    api.crMailFolders().then((p) => vivo && setPastas(p)).catch(() => vivo && setPastas([]));
    return () => {
      vivo = false;
    };
  }, [recarga, recargaPastas]);

  // Polling leve da Inbox: baseline no mount (sem toast), depois a cada 15 min
  // avisa por toast os e-mails novos não lidos. TODO: intervalo configurável em
  // Settings (ver memória projeto). Roda só enquanto o Bridge está montado.
  const ultimoVistoRef = useRef<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const INTERVALO = 15 * 60 * 1000;
    const checar = async () => {
      try {
        const msgs = await api.crFolderMensagens("inbox");
        if (!vivo || msgs.length === 0) return;
        const anterior = ultimoVistoRef.current;
        ultimoVistoRef.current = msgs[0].recebido;
        if (!anterior) return; // baseline: não avisa no primeiro carregamento
        const novos = msgs.filter((m) => m.recebido > anterior && !m.lido);
        for (const m of novos.slice(0, 3)) {
          toastMensagem({
            nome: m.de,
            iniciais: m.iniciais,
            texto: `${m.assunto} — ${m.preview}`,
            quando: quandoCurto(m.recebido, idioma),
            rotuloResponder: t.controlRoom.responder,
            rotuloDispensar: t.controlRoom.dispensar,
            onResponder: () => {
              setPastaSel("inbox");
              setMsgSel(m.id);
            },
          });
        }
      } catch {
        /* silencioso: é só o aviso de novos e-mails */
      }
    };
    // NÃO chamamos checar() no mount de propósito: o efeito de mensagens já
    // busca a inbox e semeia ultimoVistoRef; um fetch duplo aqui competia com
    // ele e o Graph estrangulava (429), deixando a lista vazia até trocar de
    // pasta. O baseline vem de lá; aqui só o intervalo.
    const iv = setInterval(checar, INTERVALO);
    return () => {
      vivo = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idioma]);

  async function esvaziarLixeira() {
    try {
      const n = await api.crEsvaziarLixeira();
      toast.success(preencher(t.controlRoom.lixeiraEsvaziada, { n }));
      setRecarga((x) => x + 1);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  // Ações rápidas da LISTA (sinalizar/excluir por linha ou em lote).
  // Atualizam a lista NO LUGAR (nada de recarregar tudo e perder scroll/páginas).
  async function acaoFlag(id: string, novo: boolean) {
    // otimista: pinta o item já
    setMensagens((prev) =>
      prev?.map((m) => (m.id === id ? { ...m, sinalizado: novo } : m)) ?? prev
    );
    try {
      await api.crMarcarEmail(id, novo);
      toastIcone(
        novo ? t.controlRoom.flagAdicionada : t.controlRoom.flagRemovida,
        "",
        novo ? "marcado" : "desmarcado"
      );
    } catch (e) {
      // desfaz
      setMensagens((prev) =>
        prev?.map((m) => (m.id === id ? { ...m, sinalizado: !novo } : m)) ?? prev
      );
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  async function acaoExcluir(ids: string[]) {
    if (ids.length === 0) return;
    const res = await Promise.allSettled(ids.map((id) => api.crExcluirEmail(id)));
    const ok = ids.filter((_, i) => res[i].status === "fulfilled");
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setMensagens((prev) => prev?.filter((m) => !okSet.has(m.id)) ?? prev);
      if (msgSel && okSet.has(msgSel)) setMsgSel(null);
      setSelecionados((s) => {
        const n = new Set(s);
        ok.forEach((id) => n.delete(id));
        return n;
      });
      setRecargaPastas((x) => x + 1); // atualiza contagens do sidebar
      toast.success(
        ok.length > 1
          ? preencher(t.controlRoom.selecionadosExcluidos, { n: ok.length })
          : t.controlRoom.emailExcluido
      );
    }
    if (ok.length < ids.length) {
      toast.error(t.controlRoom.erroAcao);
    }
  }

  // mensagens da pasta (1ª página); auto-seleciona a primeira e semeia o
  // baseline do polling quando é a inbox.
  useEffect(() => {
    let vivo = true;
    setMensagens(null);
    setTemMais(false);
    setSelecionados(new Set());
    carregandoMaisRef.current = false;
    api
      .crFolderMensagens(pastaSel, 0)
      .then((ms) => {
        if (!vivo) return;
        setMensagens(ms);
        // mantém a mensagem já selecionada se ela existir na lista nova (ex.:
        // clicar "Responder" num toast já selecionou a msg antes do fetch);
        // senão pega a primeira.
        setMsgSel((cur) => (cur && ms.some((m) => m.id === cur) ? cur : (ms[0]?.id ?? null)));
        setTemMais(ms.length === PAGINA);
        if (pastaSel === "inbox" && ms[0]) ultimoVistoRef.current = ms[0].recebido;
      })
      .catch(() => vivo && setMensagens([]));
    return () => {
      vivo = false;
    };
  }, [pastaSel, recarga]);

  // Lazy load: rolar até o fim carrega a próxima página e concatena.
  async function carregarMais() {
    if (carregandoMaisRef.current || !temMais || !mensagens) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      const pagina = await api.crFolderMensagens(pastaSel, mensagens.length);
      setMensagens((prev) => [...(prev ?? []), ...pagina]);
      setTemMais(pagina.length === PAGINA);
    } catch {
      /* silencioso */
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

  const pastaAtual = pastas?.find((p) => p.id === pastaSel);
  const tituloLista = pastaAtual ? rotuloPasta(pastaAtual.tipo, pastaAtual.nome, t) : "";
  const msgAtual = mensagens?.find((m) => m.id === msgSel);

  // "Compose in Outlook" — comportamento atual (abre o Outlook interno).
  const composeOutlook = () =>
    api.abrirAppInterno(
      "outlook",
      comLoginHint("https://outlook.office.com/mail/deeplink/compose", user.email),
      "Outlook"
    );
  // "New mail" — abre o nosso composer em modal.
  const novoEmailModal = () => setNovaAberta(true);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Cabeçalho */}
      <div className="flex shrink-0 items-center gap-3">
        <Avatar className="size-11">
          {user.photo && <AvatarImage src={user.photo} alt="" />}
          <AvatarFallback>{user.initials}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {preencher(t.controlRoom.saudacao, { nome: primeiroNome })}
          </h1>
          <p className="text-sm text-muted-foreground">{t.controlRoom.subtitulo}</p>
        </div>
      </div>

      {/* 4 painéis: sidebar (colapsável) · [lista ⇔ detalhe] · agenda */}
      <div className="flex min-h-0 flex-1 gap-4">
        <FolderSidebar
          pastas={pastas}
          sel={pastaSel}
          onSel={setPastaSel}
          onNovo={novoEmailModal}
          onComposeOutlook={composeOutlook}
          colapsada={!sidebarAberta}
          t={t}
        />

        {/* Lista e detalhe compartilham o espaço, com splitter arrastável. */}
        <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1 overflow-hidden">
          <ResizablePanel defaultSize={38} minSize={24} maxSize={55} className="overflow-hidden">
            <MessageList
              titulo={tituloLista}
              mensagens={mensagens}
              sel={msgSel}
              onSel={setMsgSel}
              onRefresh={() => setRecarga((n) => n + 1)}
              sidebarAberta={sidebarAberta}
              onToggleSidebar={() => setSidebarAberta((v) => !v)}
              pastaTipo={pastaAtual?.tipo ?? ""}
              onEsvaziar={esvaziarLixeira}
              onCarregarMais={carregarMais}
              carregandoMais={carregandoMais}
              temMais={temMais}
              onFlag={acaoFlag}
              onExcluir={acaoExcluir}
              selecionados={selecionados}
              setSelecionados={setSelecionados}
              naoLidosPasta={pastaAtual?.naoLidos ?? 0}
              t={t}
              idioma={idioma}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5 bg-transparent hover:bg-border" />
          <ResizablePanel defaultSize={62} minSize={35} className="overflow-hidden">
            {selecionados.size > 0 ? (
              <MultiSelecaoContexto
                n={selecionados.size}
                onExcluir={() => {
                  acaoExcluir([...selecionados]);
                  setSelecionados(new Set());
                }}
                onLimpar={() => setSelecionados(new Set())}
                t={t}
              />
            ) : (
              <MessageDetail
                id={msgSel}
                userEmail={user.email}
                sinalizado={msgAtual?.sinalizado ?? false}
                onFlag={acaoFlag}
                onExcluir={acaoExcluir}
                onMudou={() => setRecargaPastas((n) => n + 1)}
                t={t}
                idioma={idioma}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>

        <AgendaPanel user={user} onEvento={setEventoSel} t={t} idioma={idioma} />
      </div>

      <EventoDialog id={eventoSel} userEmail={user.email} onClose={() => setEventoSel(null)} />
      <NovaMensagemModal aberto={novaAberta} onClose={() => setNovaAberta(false)} t={t} />
    </div>
  );
}
