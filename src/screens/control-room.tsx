import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import * as AnimatedButton from "@/components/morphin/animated-border-button";
import SuccessIcon from "@/components/ui/icons/success";
import TrashIcon from "@/components/ui/icons/trash";
import { AnimatePresence, motion } from "motion/react";
import { TextMorph } from "torph/react";
import { toast } from "sonner";
import { toastIcone, toastDownload, toastMensagem } from "@/lib/toasts";
import * as api from "@/lib/api";
import { useVirtualizer } from "@tanstack/react-virtual";
import { preencher, useIdioma } from "@/lib/idioma";
import { useTemaEscuro } from "@/lib/tema";
import { usePersistedState } from "@/lib/persist";
import { getDarkReaderInlineScripts } from "@/lib/darkReaderInject";
import DOMPurify from "dompurify";
import { cn, comLoginHint } from "@/lib/utils";
import type {
  AnexoEmail,
  AppUser,
  EmailDetalhe,
  EmailItem,
  EventoAgenda,
  EventoDetalhe,
  PastaEmail,
} from "@/lib/types";
import {
  Archive,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FilePen,
  Flag,
  Forward,
  Inbox,
  Mail,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
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

// --- corpo (html/texto) do Graph -------------------------------------------

/**
 * Corpo HTML renderizado num IFRAME isolado (como Outlook/Gmail fazem). Motivos:
 * (1) o CSS do nosso app não mutila o layout do e-mail (e vice-versa);
 * (2) e-mails de largura fixa (tabelas 600px+) são ESCALADOS pra caber no painel
 *     em vez de cortar — não-responsividade é do remetente, mas mitigamos aqui.
 * O HTML é sanitizado (DOMPurify) e o `allow-scripts` (necessário pro Dark
 * Reader no tema escuro) só permite o DR — scripts do e-mail são removidos.
 */
function CorpoHtml({
  corpo,
  onAbrirLink,
}: {
  corpo: string;
  onAbrirLink?: (url: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(120);
  // Render ciente do tema do app (como leitores modernos). O baseline é SEMPRE
  // claro — dá ao Dark Reader um conjunto limpo de cores pra inverter. No modo
  // escuro, injetamos o Dark Reader real (como o MailVault) no <head> do srcDoc:
  // ele roda no load (sem flash) e o MutationObserver dele pega conteúdo tardio.
  const escuro = useTemaEscuro();

  const doc = useMemo(() => {
    // overflow:hidden garante ZERO scrollbar interna do iframe — nós ajustamos
    // a altura por fora; a largura encaixa via `zoom` (reflui o layout).
    const baseline =
      `<style>:root{color-scheme:light}html,body{margin:0;padding:0;overflow:hidden}` +
      `body{background:#fff;color:#111;` +
      `font-family:system-ui,-apple-system,Segoe UI,sans-serif;` +
      `font-size:14px;line-height:1.5;padding:6px}img{max-width:100%;height:auto}` +
      `a{color:#7c3aed}</style>`;
    const dr = escuro ? getDarkReaderInlineScripts() : "";
    // Sanitiza o HTML do e-mail (tira <script>, handlers on*, javascript: etc.)
    // ANTES de injetar. Como habilitamos allow-scripts pro Dark Reader rodar, um
    // e-mail malicioso poderia rodar script na nossa origem — o DOMPurify fecha
    // isso, mantendo tabelas/estilos/imagens do e-mail intactos.
    const corpoLimpo = DOMPurify.sanitize(corpo, { ADD_ATTR: ["target"] });
    return (
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
      `<meta name="color-scheme" content="light">` +
      baseline +
      dr +
      `</head><body>${corpoLimpo}</body></html>`
    );
  }, [corpo, escuro]);

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
      // Links do e-mail: o `target=_blank` não navega no Tauri (nada acontecia
      // ao clicar). Interceptamos o clique e abrimos http(s) no Navigator (aba
      // própria); outros esquemas (mailto/tel) vão pro handler padrão do SO.
      d?.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
        const href = a?.href;
        if (!href) return;
        e.preventDefault();
        if (/^https?:/i.test(href) && onAbrirLink) onAbrirLink(href);
        else api.openUrl(href).catch(() => {});
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
      // allow-scripts só no escuro: é o que o Dark Reader precisa pra rodar no
      // load. No claro mantemos o sandbox estrito (nenhum script do e-mail roda).
      sandbox={escuro ? "allow-same-origin allow-popups allow-scripts" : "allow-same-origin allow-popups"}
      title="e-mail"
      scrolling="no"
      className="w-full border-0 bg-white"
      style={{ height: altura }}
    />
  );
}

function CorpoMensagem({
  corpo,
  tipo,
  onAbrirLink,
}: {
  corpo: string;
  tipo: "html" | "text";
  onAbrirLink?: (url: string) => void;
}) {
  const { t } = useIdioma();
  if (!corpo.trim()) {
    return <p className="text-sm text-muted-foreground">{t.controlRoom.semCorpo}</p>;
  }
  if (tipo === "html") return <CorpoHtml corpo={corpo} onAbrirLink={onAbrirLink} />;
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

/**
 * Botão de exclusão no padrão destrutivo do app — o mesmo animated-border-button
 * do registry @morphin usado no "Remover biblioteca": parado → processando
 * (borda tracejada animada) → sucesso (verde, brevemente). `onExcluir` pode ser
 * async; `onConcluir` (opcional) roda após o flash de sucesso — usado pra limpar
 * a seleção sem cortar a animação. Cores dark vão no uso (o registry só tem claro).
 */
function BotaoExcluir({
  onExcluir,
  onConcluir,
  rotulo,
  rotuloProcessando,
  rotuloConcluido,
  size = "small",
  className,
}: {
  onExcluir: () => void | Promise<void>;
  onConcluir?: () => void;
  rotulo: string;
  rotuloProcessando: string;
  rotuloConcluido: string;
  size?: "medium" | "small" | "xsmall";
  className?: string;
}) {
  const [estado, setEstado] = useState<"parado" | "processando" | "sucesso">("parado");

  useEffect(() => {
    if (estado !== "sucesso" || !onConcluir) return;
    const id = setTimeout(onConcluir, 900);
    return () => clearTimeout(id);
  }, [estado, onConcluir]);

  async function run() {
    if (estado !== "parado") return;
    setEstado("processando");
    try {
      // Duração mínima pra a animação (borda tracejada) ser visível mesmo quando
      // a exclusão é otimista/instantânea — antes o botão sumia sem animar (#23).
      await Promise.all([
        Promise.resolve(onExcluir()),
        new Promise((r) => setTimeout(r, 650)),
      ]);
      setEstado("sucesso");
    } catch {
      setEstado("parado");
    }
  }

  return (
    <AnimatedButton.Root
      variant={estado === "sucesso" ? "success" : "error"}
      mode="animatedBorder"
      size={size}
      onClick={run}
      animateBorder={estado === "processando"}
      showAnimatedBorder={estado === "processando"}
      animatedBorderStyle={estado === "processando" ? "dashed" : "solid"}
      disabled={estado !== "parado"}
      className={cn(
        estado === "sucesso"
          ? "dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-300 dark:hover:bg-green-950/60 dark:hover:text-green-200"
          : "dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60",
        className
      )}
    >
      <AnimatePresence mode="popLayout">
        <motion.div
          key={estado === "sucesso" ? "sucesso" : "excluir"}
          initial={false}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.4, y: 10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <AnimatedButton.Icon
            as={estado === "sucesso" ? SuccessIcon : TrashIcon}
            className="size-4"
            aria-hidden
          />
        </motion.div>
      </AnimatePresence>
      <TextMorph>
        {estado === "sucesso"
          ? rotuloConcluido
          : estado === "processando"
            ? rotuloProcessando
            : rotulo}
      </TextMorph>
    </AnimatedButton.Root>
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
  onExcluir: () => void | Promise<void>;
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
            <BotaoExcluir
              size="medium"
              onExcluir={onExcluir}
              onConcluir={onLimpar}
              rotulo={t.controlRoom.excluirSelecionados}
              rotuloProcessando={t.controlRoom.excluindo}
              rotuloConcluido={t.controlRoom.excluidos}
            />
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

/** Falha ao carregar a agenda — distinta do "sem eventos", com o erro real e
 *  um retry. Antes uma falha do Graph era mascarada como mês vazio (#21). */
function AgendaErro({
  mensagem,
  onRetry,
  t,
}: {
  mensagem: string;
  onRetry: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  // Mensagem amigável na UI (o usuário não deve ver "/me/calendarView 429");
  // o detalhe técnico vai pro console pra diagnóstico. #41
  useEffect(() => {
    console.warn("[agenda] falha ao carregar:", mensagem);
  }, [mensagem]);
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia>
          <CalendarClock className="size-8 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>{t.controlRoom.agendaErroTitulo}</EmptyTitle>
        <EmptyDescription className="text-xs">
          {t.controlRoom.agendaErroDica}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> {t.controlRoom.atualizar}
        </Button>
      </EmptyContent>
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
        {colapsada ? (
          // Dot ancorado ao ÍCONE (não ao botão): com o ring na cor do card ele
          // fica dentro dos limites e o ScrollArea não corta (#37). Não-lido em
          // Lixeira/Junk é ruído → sem dot nessas pastas.
          <span className="relative">
            <Ico className="size-4 shrink-0 text-muted-foreground" />
            {contagem > 0 && p.tipo !== "deleteditems" && p.tipo !== "junkemail" && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-card" />
            )}
          </span>
        ) : (
          <>
            <Ico className="size-4 shrink-0 text-muted-foreground" />
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
          {/* chevron só quando a pasta realmente tem subpastas (childFolderCount > 0) */}
          {p.filhos > 0 ? (
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
  contFlagged,
  contAnexos,
  busca,
  setBusca,
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
  onExcluir: (ids: string[]) => void | Promise<void>;
  selecionados: Set<string>;
  setSelecionados: React.Dispatch<React.SetStateAction<Set<string>>>;
  naoLidosPasta: number;
  contFlagged: number | null;
  contAnexos: number | null;
  busca: string;
  setBusca: (v: string) => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const [aba, setAba] = useState<Aba>("todos");
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

  // A busca por TEXTO é server-side (o pai passa os resultados como `mensagens`);
  // aqui só aplicamos o filtro de aba (All/Unread/Flagged/Files) sobre a fonte.
  const filtrada = useMemo(() => {
    if (!mensagens) return [];
    return mensagens.filter((m) => {
      if (aba === "naoLidos" && m.lido) return false;
      if (aba === "sinalizados" && !m.sinalizado) return false;
      if (aba === "anexos" && !m.temAnexos) return false;
      return true;
    });
  }, [mensagens, aba]);

  const filtrando = busca.trim() !== "" || aba !== "todos";
  // Busca/filtro só enxergam os carregados; se não achou nada e há mais páginas,
  // carrega a próxima (progressivo) até aparecer resultado ou acabar.
  useEffect(() => {
    if (filtrando && filtrada.length === 0 && temMais && !carregandoMais) onCarregarMais();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrando, filtrada.length, temMais, carregandoMais]);

  // Virtualização da lista — só renderiza as linhas visíveis (+overscan), em vez
  // de montar todos os itens de `filtrada`. Altura fixa estimada por linha; o
  // measureElement corrige para a altura real (~84px) sem risco de sobreposição.
  const ROW_ALTURA = 76;
  const virtualizer = useVirtualizer({
    count: filtrada.length,
    getScrollElement: () => listaRef.current,
    estimateSize: () => ROW_ALTURA,
    overscan: 8,
    getItemKey: (i) => filtrada[i].id,
  });

  const comEstrela = mensagens?.filter((m) => m.sinalizado).length ?? 0;
  const comAnexo = mensagens?.filter((m) => m.temAnexos).length ?? 0;
  const abas: { id: Aba; label: string; n?: number }[] = [
    { id: "todos", label: t.controlRoom.abaTodos },
    // não lidos = total REAL da pasta (não só os carregados na lista)
    { id: "naoLidos", label: t.controlRoom.abaNaoLidos, n: naoLidosPasta },
    // Flagged/Files = total REAL da pasta (fallback pro carregado enquanto carrega)
    { id: "sinalizados", label: t.controlRoom.abaSinalizados, n: contFlagged ?? comEstrela },
    { id: "anexos", label: t.controlRoom.abaAnexos, n: contAnexos ?? comAnexo },
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
        // Com a lista virtualizada, o item pode não estar no DOM — usa o
        // scrollToIndex do virtualizer (align "auto" ≈ block:"nearest").
        virtualizer.scrollToIndex(prox);
      }
    } else if (e.key === "Delete") {
      const alvos = selecionados.size > 0 ? [...selecionados] : sel ? [sel] : [];
      if (alvos.length > 0) {
        e.preventDefault();
        onExcluir(alvos);
        // acaoExcluir não limpa mais a seleção (pro BotaoExcluir animar antes de
        // desmontar); no atalho, limpamos aqui.
        setSelecionados(new Set());
      }
    }
  }

  const idsFiltrados = filtrada.map((m) => m.id);
  const todosSel = idsFiltrados.length > 0 && idsFiltrados.every((id) => selecionados.has(id));
  // Em "modo seleção" (≥1 marcado): checkboxes sempre visíveis e as ações de
  // hover por linha somem — o usuário opera pela barra de seleção (#23).
  const haSelecao = selecionados.size > 0;

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
          <BotaoExcluir
            className="ml-auto"
            onExcluir={() => onExcluir([...selecionados])}
            onConcluir={() => setSelecionados(new Set())}
            rotulo={t.controlRoom.excluirSelecionados}
            rotuloProcessando={t.controlRoom.excluindo}
            rotuloConcluido={t.controlRoom.excluidos}
          />
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
              {a.n != null && a.n > 0 && (
                <Badge variant="primary-light" size="xs" radius="full">
                  {a.n}
                </Badge>
              )}
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
            // Pré-carga antecipada: ao passar de 90% da lista já busca a próxima
            // página, pra sempre haver buffer à frente (não espera bater no fim).
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight * 0.9) onCarregarMais();
          }}
        >
          <div className="px-2 py-1">
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vr) => {
                const m = filtrada[vr.index];
                if (!m) return null;
                const ativo = m.id === sel;
                const marcado = selecionados.has(m.id);
                return (
                  <div
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      paddingBottom: 2,
                      transform: `translateY(${vr.start}px)`,
                    }}
                  >
                    <Item
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
                          !marcado && !haSelecao && "opacity-0 group-hover/row:opacity-100"
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
                          {/* Slot de largura fixa pra data/ações: a data fica
                              `invisible` no hover (mantém o espaço) e as ações
                              entram em OVERLAY absoluto — assim o card NÃO muda
                              de tamanho ao passar o mouse (#45). Ações somem em
                              modo seleção (#23). */}
                          <div className="relative flex min-w-14 shrink-0 items-center justify-end self-stretch">
                            <span
                              className={cn(
                                "text-xs text-muted-foreground",
                                !haSelecao && "group-hover/row:invisible"
                              )}
                            >
                              {quandoCurto(m.recebido, idioma)}
                            </span>
                            {!haSelecao && (
                              <div
                                className="absolute top-1/2 right-0 hidden -translate-y-1/2 items-center gap-0.5 group-hover/row:flex"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => onFlag(m.id, !m.sinalizado)}
                                  className="grid size-6 place-items-center rounded bg-accent hover:bg-background"
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
                                  className="grid size-6 place-items-center rounded bg-accent text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={t.controlRoom.excluir}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className={cn("truncate text-sm", !m.lido && "font-medium")}>{m.assunto}</p>
                        <ItemDescription className="flex items-center gap-1">
                          <span className="min-w-0 flex-1 truncate">
                            {m.preview.replace(/\s*(?:…|\.\.\.)\s*$/, "")}
                          </span>
                          {m.temAnexos && <Paperclip className="size-3 shrink-0" />}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  </div>
                );
              })}
            </div>
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
  onMarcarLido,
  onAbrirLink,
  onMudou,
  t,
  idioma,
}: {
  id: string | null;
  userEmail?: string | null;
  sinalizado: boolean;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void;
  onMarcarLido: (id: string, lido: boolean) => void;
  onAbrirLink: (url: string) => void;
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
      const anexos = c?.getAnexos() ?? [];
      if (modo === "encaminhar") {
        await api.crEncaminhar(id, html, destinos, anexos);
        // salva os destinatários nos Contatos (best-effort, silencioso)
        api
          .crSalvarContatos(destinos.map((e) => ({ nome: e, email: e })))
          .catch(() => {});
      } else {
        await api.crResponder(id, html, modo === "responderTodos", anexos);
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

  const corpoInterno = (
    <div className="px-5 py-4">
      <CorpoMensagem corpo={det.corpo} tipo={det.corpoTipo} onAbrirLink={onAbrirLink} />
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
  );

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
            onClick={() => id && onMarcarLido(id, false)}
            aria-label={t.controlRoom.marcarNaoLido}
            title={t.controlRoom.marcarNaoLido}
          >
            <Mail className="size-4" />
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

      {/* Corpo do e-mail — sempre em altura cheia (sem compose espremido). */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-fina">{corpoInterno}</div>

      {/* Reply / Reply all / Forward num Sheet lateral (como o New Mail): não
          corta a toolbar do compose e deixa o e-mail original visível atrás. A
          citação do original vai no envio (fluxo do backend). */}
      <Sheet open={modo !== null} onOpenChange={(o) => !o && setModo(null)}>
        <SheetContent
          side="right"
          className="flex w-1/2 flex-col gap-0 p-0 sm:max-w-[50vw]"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-left">
              {modo === "encaminhar"
                ? t.controlRoom.encaminhar
                : modo === "responderTodos"
                  ? t.controlRoom.responderTodos
                  : t.controlRoom.responder}
            </SheetTitle>
          </SheetHeader>
          {/* Composer (editável) em cima + a mensagem original como referência
              read-only embaixo, como todo mailclient. O original NÃO faz parte
              do editor (edRef), então o getHtml() sai só com a resposta e o
              backend segue anexando a citação limpa do Graph — sem duplicar. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-[3] overflow-hidden">
              {modo && (
                <ComporMensagem
                  key={modo}
                  ref={comporRef}
                  mostrarDestinatarios={modo === "encaminhar"}
                  textos={textosCompose}
                />
              )}
            </div>
            <div className="flex min-h-0 flex-[2] flex-col border-t">
              <div className="flex shrink-0 items-center gap-2 bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
                <Reply className="size-3 shrink-0" />
                <span className="font-medium">{t.controlRoom.mensagemOriginal}</span>
                <span className="ml-auto truncate">
                  {det.de} · {new Date(comZ(det.recebido)).toLocaleString(idioma)}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-fina">
                <CorpoMensagem corpo={det.corpo} tipo={det.corpoTipo} onAbrirLink={onAbrirLink} />
              </div>
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
            <Button variant="ghost" onClick={() => setModo(null)} disabled={enviando}>
              {t.controlRoom.cancelar}
            </Button>
            <Button onClick={enviar} disabled={enviando}>
              {enviando ? <Spinner className="size-4" /> : <Send />}
              {t.controlRoom.enviar}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}

// ===========================================================================
// Painel 4 — calendário + agenda do dia (schedule-8)
// ===========================================================================

function AgendaPanel({
  user,
  onEvento,
  colapsada,
  onToggle,
  t,
  idioma,
}: {
  user: AppUser;
  onEvento: (id: string) => void;
  colapsada: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  void user;
  // Colapsado: tira o cálculo/rede — só a tira com o ícone pra reabrir.
  if (colapsada) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center rounded-xl border bg-card py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          title={t.controlRoom.agendaTitulo}
          aria-label={t.controlRoom.agendaTitulo}
        >
          <CalendarDays className="size-4 text-muted-foreground" />
        </Button>
      </div>
    );
  }
  return <AgendaConteudo onEvento={onEvento} onToggle={onToggle} t={t} idioma={idioma} />;
}

function AgendaConteudo({
  onEvento,
  onToggle,
  t,
  idioma,
}: {
  onEvento: (id: string) => void;
  onToggle: () => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const [dia, setDia] = useState<Date>(() => new Date());
  const [mesEventos, setMesEventos] = useState<EventoAgenda[] | null>(null);
  // Erro de carga separado do "vazio": sem isso, uma falha do Graph
  // (403 de escopo, rede, etc.) virava um mês "sem eventos" idêntico ao real,
  // mascarando o problema (#21). `recargaAgenda` re-dispara o fetch no retry.
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  const [recargaAgenda, setRecargaAgenda] = useState(0);

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
    setErroAgenda(null);
    api
      .crAgenda(mesIni, mesFim)
      .then((d) => {
        if (vivo) setMesEventos(d);
      })
      .catch((e) => {
        // Surface o erro real (ex.: "/me/calendarView retornou 403") em vez de
        // fingir "sem eventos".
        if (vivo) {
          setErroAgenda(String(e));
          setMesEventos([]);
        }
      });
    return () => {
      vivo = false;
    };
  }, [mesIni, mesFim, recargaAgenda]);

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

  // Dias que têm compromisso — pra marcar com um pontinho no calendário (o
  // schedule-8 antigo mostrava; o c-calendar-22 não, e sem isso o usuário não
  // acha os dias com evento e acha que "não carregou").
  const diasComEvento = useMemo(() => {
    const s = new Set<string>();
    for (const ev of mesEventos ?? []) {
      const d = new Date(comZ(ev.inicio));
      if (!Number.isNaN(d.getTime())) s.add(chaveDia(d));
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesEventos]);

  const rotuloDia = dia.toLocaleDateString(idioma, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Card className="flex h-full w-80 shrink-0 flex-col gap-0 overflow-hidden py-4">
      {/* Título genérico + colapsar (igual ao sidebar do mail). */}
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t.controlRoom.agendaTitulo}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          title={t.controlRoom.colapsar}
          aria-label={t.controlRoom.colapsar}
        >
          <PanelRightClose className="size-4" />
        </Button>
      </div>
      <CardContent className="px-4">
        <Calendar
          mode="single"
          selected={dia}
          month={dia}
          onMonthChange={setDia}
          onSelect={(d) => d && setDia(d)}
          showOutsideDays
          className="w-full bg-transparent p-0"
          formatters={{
            formatWeekdayName: (d) =>
              d.toLocaleDateString(idioma, { weekday: "short" }).slice(0, 3),
          }}
          modifiers={{ evento: (date: Date) => diasComEvento.has(chaveDia(date)) }}
          modifiersClassNames={{
            evento:
              "relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
          required
        />
      </CardContent>
      <CardFooter className="flex min-h-0 flex-1 flex-col items-start gap-3 border-t px-4! pt-3! pb-0!">
        <div className="flex w-full items-center justify-between px-1">
          <div className="text-sm font-medium capitalize">{rotuloDia}</div>
        </div>
        {/* Eventos do dia — rola por dentro; empty state do dia inalterado. */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto scrollbar-fina">
          {erroAgenda ? (
            <AgendaErro
              mensagem={erroAgenda}
              onRetry={() => setRecargaAgenda((n) => n + 1)}
              t={t}
            />
          ) : agenda === null ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : agenda.length === 0 ? (
            <AgendaVazia t={t} />
          ) : (
            <div className="flex w-full flex-col gap-2 pb-1">
              {agenda.map((ev) => {
                // Barra colorida = cor real da categoria do Outlook (se houver).
                const cor = ev.categorias?.[0] ? coresCat.get(ev.categorias[0]) : undefined;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onEvento(ev.id)}
                    style={cor ? ({ "--barra": cor } as React.CSSProperties) : undefined}
                    className={cn(
                      "relative w-full rounded-md bg-muted p-2 pl-6 text-left text-sm transition-colors hover:bg-muted/70",
                      "after:absolute after:inset-y-2 after:left-2 after:w-1 after:rounded-full",
                      cor ? "after:bg-[var(--barra)]" : "after:bg-primary"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{ev.assunto}</span>
                      {ev.online && <Video className="size-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ev.diaInteiro
                        ? t.controlRoom.diaInteiro
                        : faixaHora(ev.inicio, ev.fim, idioma)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
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
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-[30%] flex-col gap-0 p-0 sm:max-w-[30vw]">
        {!det ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="pr-6 text-left">{det.assunto}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-fina px-4 py-4 text-sm">
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
                  <CorpoMensagem corpo={det.corpo} tipo={det.corpoTipo} />
                </>
              )}
            </div>
            <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
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
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
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
      await api.crEnviarNovo(para, cc, cco, c?.getAssunto() ?? "", c?.getHtml() ?? "", c?.getAnexos() ?? []);
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

  // Sheet lateral (não modal-bloqueante) com ~50% da largura: assim dá pra
  // consultar/copiar de e-mails atrás enquanto compõe.
  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-1/2 flex-col gap-0 p-0 sm:max-w-[50vw]"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-left">{t.controlRoom.novaMensagem}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ComporMensagem key={String(aberto)} ref={comporRef} mostrarAssunto textos={textos} />
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={enviando}>
            {t.controlRoom.cancelar}
          </Button>
          <Button onClick={enviar} disabled={enviando}>
            {enviando ? <Spinner className="size-4" /> : <Send />}
            {t.controlRoom.enviar}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ===========================================================================
// Tela
// ===========================================================================

export function ControlRoomScreen({
  user,
  onAbrirLink,
}: {
  user: AppUser;
  onAbrirLink: (url: string) => void;
}) {
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
  // Colapsos persistem (o app guarda o estado que o usuário deixa).
  const [sidebarAberta, setSidebarAberta] = usePersistedState("bridge.sidebar", true);
  const [agendaAberta, setAgendaAberta] = usePersistedState("bridge.agenda", true);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [novaAberta, setNovaAberta] = useState(false);
  // Busca server-side ($search do Graph): resultados vêm do servidor (inclui
  // corpo), não do filtro local sobre o carregado.
  const [busca, setBusca] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<EmailItem[] | null>(null);
  const [temMaisBusca, setTemMaisBusca] = useState(false);
  // Contadores REAIS da pasta (não só o carregado) pras abas Flagged/Files.
  const [contFlagged, setContFlagged] = useState<number | null>(null);
  const [contAnexos, setContAnexos] = useState<number | null>(null);
  const proximoBuscaRef = useRef<string | null>(null);
  const carregandoMaisRef = useRef(false);
  // pasta atual (pra closures assíncronas que precisam do valor mais novo).
  const pastaSelRef = useRef(pastaSel);
  pastaSelRef.current = pastaSel;
  // Âncora de paginação: nº já buscado do servidor (skip). NÃO é mensagens.length
  // — a lista encolhe ao excluir, mas o skip do Graph continua avançando.
  const carregadosRef = useRef(0);
  // Ids excluídos de forma otimista: filtrados de qualquer fetch/append até o
  // Graph processar (evita a msg deletada "voltar" ao paginar/backfill).
  const deletadasRef = useRef<Set<string>>(new Set());
  const PAGINA = 50;

  // Junta páginas deduplicando por id e removendo o que foi excluído otimista.
  const juntar = (prev: EmailItem[], nova: EmailItem[]) => {
    const vistos = new Set(prev.map((m) => m.id));
    return [
      ...prev,
      ...nova.filter((m) => !vistos.has(m.id) && !deletadasRef.current.has(m.id)),
    ];
  };

  const primeiroNome = user.displayName.split(" ")[0];

  // pastas (recarrega as contagens junto com as ações e no refresh manual)
  useEffect(() => {
    let vivo = true;
    api.crMailFolders().then((p) => vivo && setPastas(p)).catch(() => vivo && setPastas([]));
    return () => {
      vivo = false;
    };
  }, [recarga, recargaPastas]);

  // Contadores reais das abas Flagged/Files (na pasta inteira, via $count).
  // Só refaz na TROCA de pasta / refresh manual — NÃO em cada recargaPastas
  // (o polling do delete bumpava recargaPastas e os refetch em rajada resolviam
  // fora de ordem, fazendo o count piscar 8↔15). Entre refetches, os ajustes
  // otimistas (flag/excluir) mantêm o número certo.
  useEffect(() => {
    let vivo = true;
    setContFlagged(null);
    setContAnexos(null);
    api.crContar(pastaSel, "flagged").then((n) => vivo && setContFlagged(n)).catch(() => {});
    api.crContar(pastaSel, "anexos").then((n) => vivo && setContAnexos(n)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, [pastaSel, recarga]);

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
  //
  // Aplicam a AMBAS as listas (pasta + resultados de busca) — quando a busca
  // está ativa o que aparece é `resultadosBusca`, então mutar só `mensagens`
  // não refletia na tela (QA #1).
  const mutarNasListas = (fn: (m: EmailItem) => EmailItem) => {
    setMensagens((prev) => prev?.map(fn) ?? prev);
    setResultadosBusca((prev) => prev?.map(fn) ?? prev);
  };
  const removerNasListas = (ids: Set<string>) => {
    setMensagens((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
    setResultadosBusca((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
  };

  // Marca lido/não-lido (otimista, nos dois sentidos): ajusta o ponto de
  // não-lido e a contagem da pasta na hora; PATCH isRead em background com
  // rollback. Usado pelo auto-mark ao abrir e pela ação manual de "não-lido".
  function acaoMarcarLido(id: string, lido: boolean) {
    const m =
      mensagens?.find((x) => x.id === id) ?? resultadosBusca?.find((x) => x.id === id);
    if (!m || m.lido === lido) return;
    const delta = lido ? -1 : 1; // lido → menos 1 não-lido; não-lido → mais 1
    mutarNasListas((x) => (x.id === id ? { ...x, lido } : x));
    setPastas((prev) =>
      prev?.map((p) =>
        p.id === pastaSel ? { ...p, naoLidos: Math.max(0, p.naoLidos + delta) } : p
      ) ?? prev
    );
    api.crMarcarLido(id, lido).catch(() => {
      mutarNasListas((x) => (x.id === id ? { ...x, lido: !lido } : x));
      setPastas((prev) =>
        prev?.map((p) =>
          p.id === pastaSel ? { ...p, naoLidos: Math.max(0, p.naoLidos - delta) } : p
        ) ?? prev
      );
    });
  }

  // Previewar a mensagem = lê-la (como em qualquer leitor): marca lido ao abrir.
  useEffect(() => {
    if (msgSel) acaoMarcarLido(msgSel, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgSel]);

  // Ajustes otimistas dos contadores reais das abas (Flagged/Files), pra não
  // ficarem estagnados enquanto o $count do servidor não reflete ainda
  // (QA #4 flag; QA #14 excluir e-mail com anexo).
  const ajustarContFlagged = (d: number) =>
    setContFlagged((c) => (c === null ? c : Math.max(0, c + d)));
  const ajustarContAnexos = (d: number) =>
    setContAnexos((c) => (c === null ? c : Math.max(0, c + d)));

  async function acaoFlag(id: string, novo: boolean) {
    // otimista: pinta o item já (nas duas listas) e mexe no count da aba
    mutarNasListas((m) => (m.id === id ? { ...m, sinalizado: novo } : m));
    ajustarContFlagged(novo ? 1 : -1);
    try {
      await api.crMarcarEmail(id, novo);
      toastIcone(
        novo ? t.controlRoom.flagAdicionada : t.controlRoom.flagRemovida,
        "",
        novo ? "marcado" : "desmarcado"
      );
    } catch (e) {
      // desfaz
      mutarNasListas((m) => (m.id === id ? { ...m, sinalizado: !novo } : m));
      ajustarContFlagged(novo ? -1 : 1);
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  async function acaoExcluir(ids: string[]) {
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    // Fonte = lista atualmente visível (pasta ou resultados de busca), pra
    // contar não-lidos certo e remover de onde o item de fato está (QA #1).
    const fonte = (busca.trim() !== "" ? resultadosBusca : mensagens) ?? [];
    const removidas = fonte.filter((m) => idsSet.has(m.id));
    const naoLidosFora = removidas.filter((m) => !m.lido).length;
    const anexosFora = removidas.filter((m) => m.temAnexos).length;

    // 1) OTIMISTA: tira da tela na hora (das duas listas) + marca como
    //    "deletada" (pro backfill não trazê-las de volta) + toast imediato.
    ids.forEach((id) => deletadasRef.current.add(id));
    removerNasListas(idsSet);
    // count real da aba Files reflete na hora (QA #14: senão piscava no refetch)
    if (anexosFora > 0) ajustarContAnexos(-anexosFora);
    if (msgSel && idsSet.has(msgSel)) setMsgSel(null);
    // NÃO limpamos a seleção aqui: o BotaoExcluir precisa ficar montado pra
    // completar a animação (processando → sucesso) e só então limpa via
    // onConcluir. Os outros gatilhos (atalho Delete) limpam explicitamente (#23).

    // 2) Contagens do sidebar já refletem: pasta atual −N (e −não lidos),
    //    Lixeira +N (a menos que a exclusão seja dentro da própria Lixeira).
    setPastas((prev) =>
      prev?.map((p) => {
        if (p.id === pastaSel && p.tipo !== "deleteditems") {
          return {
            ...p,
            total: Math.max(0, p.total - ids.length),
            naoLidos: Math.max(0, p.naoLidos - naoLidosFora),
          };
        }
        if (p.tipo === "deleteditems" && pastaSel !== "deleteditems") {
          return { ...p, total: p.total + ids.length };
        }
        return p;
      }) ?? prev
    );

    // 3) Toast imediato de confirmação.
    toast.success(
      ids.length > 1
        ? preencher(t.controlRoom.selecionadosExcluidos, { n: ids.length })
        : t.controlRoom.emailExcluido
    );

    // (o backfill acontece sozinho pelo efeito de buffer quando a lista encurta)

    // 4) Exclusão real em background + reconcile. Se algum falhar, avisa e
    //    recarrega a pasta pra ressincronizar (o item volta se não saiu).
    (async () => {
      // Enquanto a exclusão roda, vai atualizando as contagens (a Lixeira
      // "preenchendo") — e a lista da Lixeira se o usuário estiver vendo ela —
      // pra não ficar parado até o fim (o move é sequencial e pode demorar).
      const pulso = setInterval(() => {
        setRecargaPastas((x) => x + 1);
        if (pastaSelRef.current === "deleteditems") setRecarga((x) => x + 1);
      }, 2500);
      let ok: string[] = [];
      try {
        // Dentro da própria Lixeira = exclusão definitiva; senão move pra Lixeira.
        ok = await api.crExcluirEmails(ids, pastaSel === "deleteditems");
      } catch {
        ok = [];
      } finally {
        clearInterval(pulso);
      }
      const falharam = ids.filter((id) => !ok.includes(id));
      if (falharam.length > 0) {
        falharam.forEach((id) => deletadasRef.current.delete(id));
        toast.error(t.controlRoom.erroAcao);
        setRecarga((n) => n + 1); // ressincroniza lista + contagens do zero
      } else {
        setRecargaPastas((x) => x + 1); // reconcilia contagens reais
        if (pastaSelRef.current === "deleteditems") setRecarga((x) => x + 1);
      }
    })();
  }

  // mensagens da pasta (1ª página); auto-seleciona a primeira e semeia o
  // baseline do polling quando é a inbox.
  useEffect(() => {
    let vivo = true;
    setMensagens(null);
    setTemMais(false);
    setSelecionados(new Set());
    setBusca(""); // troca de pasta zera a busca
    carregandoMaisRef.current = false;
    carregadosRef.current = 0;
    deletadasRef.current = new Set();
    api
      .crFolderMensagens(pastaSel, 0)
      .then((ms) => {
        if (!vivo) return;
        carregadosRef.current = ms.length;
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

  // Pré-carga: busca a próxima página do servidor pela âncora (skip = já
  // buscado, não o tamanho da lista) e concatena deduplicando. Serve tanto pro
  // scroll (90%) quanto pro backfill pós-exclusão.
  async function carregarMais() {
    if (carregandoMaisRef.current || !temMais) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      const pagina = await api.crFolderMensagens(pastaSel, carregadosRef.current);
      carregadosRef.current += pagina.length; // avança pelo offset do servidor
      setMensagens((prev) => juntar(prev ?? [], pagina));
      setTemMais(pagina.length === PAGINA);
    } catch {
      /* silencioso */
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

  // Buffer: se a lista ficou curta (ex.: excluiu uma página inteira) e ainda há
  // mais no servidor, repõe automaticamente — o usuário nunca vê a lista vazia
  // com mensagens sobrando na pasta.
  useEffect(() => {
    if (mensagens && mensagens.length < PAGINA && temMais && !carregandoMaisRef.current) {
      carregarMais();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, temMais]);

  // Busca server-side com debounce (300ms). Vazio = mostra a pasta normal.
  const buscaAtiva = busca.trim() !== "";
  useEffect(() => {
    const termo = busca.trim();
    if (!termo) {
      setResultadosBusca(null);
      setTemMaisBusca(false);
      return;
    }
    const id = setTimeout(() => {
      setResultadosBusca(null); // null = mostra o spinner de carregando
      proximoBuscaRef.current = null;
      api
        .crBuscar(pastaSel, termo)
        .then((res) => {
          proximoBuscaRef.current = res.proximo;
          setResultadosBusca(res.itens.filter((m) => !deletadasRef.current.has(m.id)));
          setTemMaisBusca(res.proximo !== null);
        })
        .catch(() => {
          setResultadosBusca([]);
          setTemMaisBusca(false);
        });
    }, 300);
    return () => clearTimeout(id);
  }, [busca, pastaSel]);

  // Paginação dos resultados de busca via @odata.nextLink (o Graph não aceita
  // $skip com $search); dedup igual à pasta.
  async function carregarMaisBusca() {
    const termo = busca.trim();
    const proximo = proximoBuscaRef.current;
    if (carregandoMaisRef.current || !termo || !proximo) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      const res = await api.crBuscar(pastaSel, termo, proximo);
      proximoBuscaRef.current = res.proximo;
      setResultadosBusca((prev) => juntar(prev ?? [], res.itens));
      setTemMaisBusca(res.proximo !== null);
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

        {/* Lista e detalhe compartilham o espaço, com splitter arrastável.
            autoSaveId persiste a proporção que o usuário deixa. */}
        <ResizablePanelGroup
          autoSaveId="bridge.layout"
          direction="horizontal"
          className="min-w-0 flex-1 overflow-hidden"
        >
          <ResizablePanel defaultSize={38} minSize={24} maxSize={55} className="overflow-hidden">
            <MessageList
              titulo={tituloLista}
              mensagens={buscaAtiva ? resultadosBusca : mensagens}
              sel={msgSel}
              onSel={setMsgSel}
              onRefresh={() => setRecarga((n) => n + 1)}
              sidebarAberta={sidebarAberta}
              onToggleSidebar={() => setSidebarAberta((v) => !v)}
              pastaTipo={pastaAtual?.tipo ?? ""}
              onEsvaziar={esvaziarLixeira}
              onCarregarMais={buscaAtiva ? carregarMaisBusca : carregarMais}
              carregandoMais={carregandoMais}
              temMais={buscaAtiva ? temMaisBusca : temMais}
              onFlag={acaoFlag}
              onExcluir={acaoExcluir}
              selecionados={selecionados}
              setSelecionados={setSelecionados}
              naoLidosPasta={pastaAtual?.naoLidos ?? 0}
              contFlagged={buscaAtiva ? null : contFlagged}
              contAnexos={buscaAtiva ? null : contAnexos}
              busca={busca}
              setBusca={setBusca}
              t={t}
              idioma={idioma}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5 bg-transparent hover:bg-border" />
          <ResizablePanel defaultSize={62} minSize={35} className="overflow-hidden">
            {selecionados.size > 0 ? (
              <MultiSelecaoContexto
                n={selecionados.size}
                onExcluir={() => acaoExcluir([...selecionados])}
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
                onMarcarLido={acaoMarcarLido}
                onAbrirLink={onAbrirLink}
                onMudou={() => setRecargaPastas((n) => n + 1)}
                t={t}
                idioma={idioma}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>

        <AgendaPanel
          user={user}
          onEvento={setEventoSel}
          colapsada={!agendaAberta}
          onToggle={() => setAgendaAberta((v) => !v)}
          t={t}
          idioma={idioma}
        />
      </div>

      <EventoDialog id={eventoSel} userEmail={user.email} onClose={() => setEventoSel(null)} />
      <NovaMensagemModal aberto={novaAberta} onClose={() => setNovaAberta(false)} t={t} />
    </div>
  );
}
