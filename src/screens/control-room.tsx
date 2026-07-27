import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/reui/badge";
import {
  Filters,
  type Filter,
  type FilterFieldConfig,
  type FilterOperator,
  type FilterOption,
} from "@/components/reui/filters";
import {
  DateSelector,
  formatDateValue,
  DEFAULT_DATE_SELECTOR_I18N,
  type DateSelectorValue,
  type DateSelectorI18nConfig,
} from "@/components/reui/date-selector";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Frame, FrameHeader, FrameTitle } from "@/components/reui/frame";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useFotos, configurarDominioFotos } from "@/lib/fotos";
import { useVirtualizer } from "@tanstack/react-virtual";
import { preencher, useIdioma } from "@/lib/idioma";
import { useTemaEscuro } from "@/lib/tema";
import { usePersistedState } from "@/lib/persist";
import { tocarSomEscopo } from "@/lib/sons-notificacao";
import { useDebounce } from "@/hooks/use-debounce";
import { getDarkReaderInlineScripts } from "@/lib/darkReaderInject";
import { dobrarCitado, estiloDobra } from "@/lib/dobrar-citado";
import DOMPurify from "dompurify";
import { cn, comLoginHint } from "@/lib/utils";
import type {
  AnexoEmail,
  AppUser,
  EmailDetalhe,
  EmailItem,
  EventoAgenda,
  EventoDetalhe,
  InsightsRemetente,
  PastaEmail,
  SegurancaEmail,
} from "@/lib/types";
import {
  analisarLink,
  nivelAutenticacao,
  parseAuthResults,
  replyToDivergente,
  type AnaliseLink,
  type AvisoLink,
  type NivelAutenticacao,
  type ResultadoAutenticacao,
} from "@/lib/seguranca-leitor";
import {
  Archive,
  ArrowDownUp,
  AtSign,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ListFilter,
  ChevronRight,
  Download,
  ExternalLink,
  FilePen,
  Flag,
  FlagOff,
  FunnelX,
  Folder,
  FolderInput,
  FolderPlus,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PenSquare,
  Pencil,
  RefreshCw,
  Reply,
  ReplyAll,
  RotateCcw,
  Search,
  Send,
  Send as SendIcon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
  User,
  Video,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtalhos, isTypingTarget, ehModPrincipal } from "@/hooks/use-atalhos";
import { AtalhosAjuda } from "@/components/atalhos-ajuda";

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

// Zoom MANUAL do leitor (#76) — camada por cima do auto-fit do #57.
// O fator do usuário (1 = auto-fit puro) multiplica o zoom que o app calculou:
// `efetivo = base(auto-fit) × fator`. Piso/teto e passo consistentes entre
// teclado (CTRL +/−) e roda (CTRL+scroll). CTRL+0 volta ao auto-fit (fator 1).
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_PASSO = 0.1;
/** Clampa e arredonda pra 2 casas (evita drift de float ao somar 0.1). */
const clampZoom = (v: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 100) / 100));

function CorpoHtml({
  corpo,
  onAbrirLink,
}: {
  corpo: string;
  onAbrirLink?: (url: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(120);
  // Link-safety (#91): clique num link do corpo abre um modal de confirmação
  // com o DESTINO REAL + avisos, em vez de abrir direto. `null` = modal fechado.
  const [linkPendente, setLinkPendente] = useState<AnaliseLink | null>(null);
  // Zoom manual (#76): fator do USUÁRIO aplicado POR CIMA do auto-fit do #57.
  // GLOBAL e persistido (não por-mensagem): a preferência sobrevive a fechar/
  // reabrir o app e a trocar de mensagem e voltar (decisão da issue #76 — o
  // leitor tem UM nível de zoom, como o zoom de página de um navegador).
  const [fator, setFator] = usePersistedState("bridge.leitorZoom", 1);
  // Ref pro fator (lido dentro dos listeners do iframe sem re-bindar) e ref pra
  // função de reaplicar o zoom (chamada pelo efeito que reage à mudança de fator).
  const fatorRef = useRef(fator);
  const ajustarRef = useRef<() => void>(() => {});
  // Render ciente do tema do app (como leitores modernos). O baseline é SEMPRE
  // claro — dá ao Dark Reader um conjunto limpo de cores pra inverter. No modo
  // escuro, injetamos o Dark Reader real (como o MailVault) no <head> do srcDoc:
  // ele roda no load (sem flash) e o MutationObserver dele pega conteúdo tardio.
  const escuro = useTemaEscuro();
  const { t } = useIdioma();
  const rotuloAparado = t.controlRoom.conteudoAparado;

  const doc = useMemo(() => {
    // overflow:hidden garante ZERO scrollbar interna do iframe — nós ajustamos
    // a altura por fora; a largura encaixa via `zoom` (reflui o layout).
    const baseline =
      // O ROOT (viewport do iframe) rola no eixo X quando algum elemento largo
      // ainda estoura depois do zoom mínimo — ex.: a tabela "Saltos de Mensagem"
      // que o Exchange anexa a encaminhados (~880px fixos). Assim o excedente
      // vira SCROLL horizontal em vez de espremer/clipar o e-mail inteiro (#57).
      // overflow-y fica hidden: a altura é medida e aplicada por fora.
      `<style>:root{color-scheme:light}html{margin:0;padding:0;overflow-x:auto;overflow-y:hidden}` +
      `body{margin:0;background:#fff;color:#111;` +
      `font-family:system-ui,-apple-system,Segoe UI,sans-serif;` +
      // overflow-wrap:anywhere quebra strings longas (URLs/tokens sem espaço)
      // que, sozinhas, inflavam o scrollWidth.
      `font-size:14px;line-height:1.5;padding:6px;overflow-wrap:anywhere}` +
      `img{max-width:100%;height:auto}a{color:#7c3aed}` +
      // Botão "⋯" da dobra do citado/assinatura (#92) — CSS puro, sem script.
      estiloDobra(escuro) +
      `</style>`;
    const dr = escuro ? getDarkReaderInlineScripts() : "";
    // Sanitiza o HTML do e-mail (tira <script>, handlers on*, javascript: etc.)
    // ANTES de injetar. Como habilitamos allow-scripts pro Dark Reader rodar, um
    // e-mail malicioso poderia rodar script na nossa origem — o DOMPurify fecha
    // isso, mantendo tabelas/estilos/imagens do e-mail intactos.
    const corpoLimpo = DOMPurify.sanitize(corpo, { ADD_ATTR: ["target"] });
    // Dobra o histórico citado/assinatura DEPOIS do sanitize (senão o <details>
    // que criamos seria removido) e ANTES de virar srcDoc — o toggle é o
    // <details> nativo, então funciona também no tema claro, onde o sandbox
    // NÃO tem allow-scripts.
    const corpoDobrado = dobrarCitado(corpoLimpo, rotuloAparado);
    return (
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
      `<meta name="color-scheme" content="light">` +
      baseline +
      dr +
      `</head><body>${corpoDobrado}</body></html>`
    );
  }, [corpo, escuro, rotuloAparado]);

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
        const ideal = conteudo > disponivel && conteudo > 0 ? disponivel / conteudo : 1;
        // PISO DE LEGIBILIDADE (#57): nunca encolher abaixo de 0.75 (14px -> ~10.5px).
        // Um único elemento largo de baixo valor (a tabela "Saltos de Mensagem"
        // dos encaminhados, ~880px) não pode espremer o e-mail inteiro a um
        // tamanho ilegível. Se o piso bater, o excedente NÃO clipa: rola no eixo
        // X (overflow-x:auto no root) e continua acessível.
        const PISO = 0.75;
        const base = Math.max(PISO, ideal); // auto-fit calculado pelo app (#57)
        // Zoom manual (#76) por cima do auto-fit: base × fator do usuário.
        const efetivo = base * fatorRef.current;
        body.style.zoom = String(efetivo);
        // Se, na escala efetiva, o conteúdo ainda estoura a largura útil, haverá
        // scrollbar horizontal; reserva a altura dela pra não clipar a última linha.
        const rolaX = conteudo * efetivo > disponivel + 1;
        // altura VISÍVEL (pós-zoom) via bounding rect; setAltura só se mudou de
        // verdade (evita re-render à toa).
        const h = Math.ceil(body.getBoundingClientRect().height) + 4 + (rolaX ? 16 : 0);
        setAltura((a) => (Math.abs(a - h) > 1 ? h : a));
      } catch {
        /* srcDoc é same-origin; catch só por segurança */
      }
    };
    // Exposto pra fora do onLoad: o efeito de [fator] reaplica o zoom + re-mede.
    ajustarRef.current = ajustar;
    const onLoad = () => {
      ultimaLargura = iframe.clientWidth;
      ajustar();
      const d = iframe.contentDocument;
      d?.querySelectorAll("img").forEach((img) => {
        if (!img.complete) img.addEventListener("load", ajustar, { once: true });
      });
      // Dobra do citado/assinatura (#92): abrir/fechar o <details> muda a
      // altura (e pode mudar a largura -> zoom). O `toggle` NÃO borbulha, por
      // isso escutamos na fase de CAPTURA, no documento. Este listener é código
      // NOSSO (realm do app), então roda mesmo com o sandbox sem allow-scripts
      // — mesmo mecanismo já usado no clique dos links, logo abaixo.
      d?.addEventListener("toggle", ajustar, true);
      // Links do e-mail: o `target=_blank` não navega no Tauri (nada acontecia
      // ao clicar). Interceptamos o clique. Para http(s), NÃO abrimos direto:
      // link-safety (#91) — analisamos texto × href e abrimos um modal de
      // confirmação com o DESTINO REAL e os avisos (mismatch/encurtador/etc).
      // Este listener é código NOSSO (realm do app), capturado no documento do
      // iframe, então roda mesmo no tema claro (sandbox sem allow-scripts).
      // Outros esquemas (mailto/tel) seguem pro handler padrão do SO.
      d?.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
        const href = a?.href;
        if (!href) return;
        e.preventDefault();
        if (/^https?:/i.test(href)) {
          // `a.href` é a URL RESOLVIDA (absoluta); `a.textContent` é o texto
          // visível — a base do teste de mismatch texto × destino.
          setLinkPendente(analisarLink(a.textContent ?? "", href));
        } else {
          api.openUrl(href).catch(() => {});
        }
      });
      // Zoom manual (#76). Estes handlers são código NOSSO (realm do app),
      // capturados NO documento do iframe — então rodam mesmo com o sandbox sem
      // allow-scripts (tema claro), e ficam restritos ao leitor: nunca tocam a
      // lista/sidebar/UI do app. `preventDefault` bloqueia o zoom nativo do
      // WebView2/Chromium (CTRL+roda) e os atalhos nativos (CTRL +/−/0).
      // O `wheel` precisa de `passive:false` pra poder dar preventDefault.
      d?.addEventListener(
        "wheel",
        (e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          const passo = e.deltaY < 0 ? ZOOM_PASSO : -ZOOM_PASSO;
          setFator((f) => clampZoom(f + passo));
        },
        { passive: false },
      );
      d?.addEventListener("keydown", (e) => {
        if (!e.ctrlKey) return;
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          setFator((f) => clampZoom(f + ZOOM_PASSO));
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          setFator((f) => clampZoom(f - ZOOM_PASSO));
        } else if (e.key === "0") {
          e.preventDefault();
          setFator(1); // volta ao auto-fit do #57
        }
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

  // Reaplica o zoom quando o fator manual muda (teclado/roda/reset/persistido),
  // re-rodando a MESMA medição de altura do #57 pra não clipar nem sobrar espaço.
  useEffect(() => {
    fatorRef.current = fator;
    ajustarRef.current();
  }, [fator]);

  const zoomAlterado = fator !== 1;

  return (
    <div className="relative w-full">
      <iframe
        // Remonta o iframe quando o tema muda: alterar `sandbox` (add/remove
        // allow-scripts) num iframe JÁ montado não reaplica na mesma carga do
        // novo srcDoc, então o Dark Reader era bloqueado ao trocar claro→escuro
        // com o e-mail aberto (só pegava ao trocar de e-mail). Um `key` por tema
        // cria um iframe novo com o sandbox correto desde o início (#73).
        key={escuro ? "dark" : "light"}
        ref={ref}
        srcDoc={doc}
        // allow-scripts só no escuro: é o que o Dark Reader precisa pra rodar no
        // load. No claro mantemos o sandbox estrito (nenhum script do e-mail roda).
        sandbox={escuro ? "allow-same-origin allow-popups allow-scripts" : "allow-same-origin allow-popups"}
        title="e-mail"
        className="w-full border-0 bg-white"
        style={{ height: altura }}
      />
      {/* Indicador do nível de zoom manual (#76) + reset via UI. Só aparece
          quando o usuário mudou o zoom (fator ≠ auto-fit); some ao resetar.
          O % é relativo ao auto-fit (100% = o que o app calculou), como o zoom
          de página de um navegador. Fica sobreposto ao canto do leitor, sem
          empurrar o layout do e-mail. */}
      {zoomAlterado && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full border bg-background/90 py-0.5 pr-0.5 pl-2 shadow-sm backdrop-blur">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {Math.round(fator * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-full text-muted-foreground"
            onClick={() => setFator(1)}
            title={t.controlRoom.zoomResetar}
            aria-label={t.controlRoom.zoomResetar}
          >
            <RotateCcw />
          </Button>
        </div>
      )}
      <ModalLinkSeguro
        analise={linkPendente}
        onFechar={() => setLinkPendente(null)}
        onAbrir={(url) => {
          setLinkPendente(null);
          onAbrirLink?.(url);
        }}
        t={t}
      />
    </div>
  );
}

/** Texto localizado de cada aviso de link (#91). */
function textoAviso(t: ReturnType<typeof useIdioma>["t"], a: AvisoLink): string {
  switch (a) {
    case "mismatch":
      return t.controlRoom.segAvisoMismatch;
    case "encurtador":
      return t.controlRoom.segAvisoEncurtador;
    case "ip":
      return t.controlRoom.segAvisoIp;
    case "punycode":
      return t.controlRoom.segAvisoPunycode;
    case "inseguro":
      return t.controlRoom.segAvisoInseguro;
    case "redirecionamento":
      return t.controlRoom.segAvisoRedirecionamento;
  }
}

/**
 * Modal de confirmação de link (#91, parte a). Mostra o DESTINO REAL antes de
 * abrir e, quando há sinais de risco (mismatch/encurtador/IP/punycode/redirect/
 * http), lista os avisos num Alert. O botão de abrir fica destrutivo quando o
 * link é suspeito, pra o usuário pensar duas vezes.
 */
function ModalLinkSeguro({
  analise,
  onFechar,
  onAbrir,
  t,
}: {
  analise: AnaliseLink | null;
  onFechar: () => void;
  onAbrir: (url: string) => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const suspeito = analise?.suspeito ?? false;
  return (
    <Dialog open={analise !== null} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {suspeito ? (
              <TriangleAlert className="size-4 text-[color:var(--destructive)]" />
            ) : (
              <ShieldCheck className="size-4 text-[color:var(--success)]" />
            )}
            {t.controlRoom.segLinkTitulo}
          </DialogTitle>
          <DialogDescription>{t.controlRoom.segLinkDescricao}</DialogDescription>
        </DialogHeader>
        {analise && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t.controlRoom.segLinkDestino}
              </p>
              <p className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs break-all">
                {analise.href}
              </p>
            </div>
            {analise.textoLink && analise.textoLink !== analise.href && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t.controlRoom.segLinkTexto}
                </p>
                <p className="text-sm break-all">{analise.textoLink}</p>
              </div>
            )}
            {analise.avisos.length > 0 ? (
              <Alert variant={suspeito ? "destructive" : "warning"}>
                <TriangleAlert />
                <AlertTitle>{t.controlRoom.segLinkSuspeito}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {analise.avisos.map((a) => (
                      <li key={a}>{textoAviso(t, a)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-[color:var(--success)]" />
                {t.controlRoom.segLinkVerificado}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            {t.controlRoom.segLinkCancelar}
          </Button>
          <Button
            variant={suspeito ? "destructive" : "default"}
            onClick={() => analise && onAbrir(analise.href)}
          >
            <ExternalLink /> {t.controlRoom.segLinkAbrir}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/**
 * Ações do menu de contexto de PASTA (#89), por TIPO de pasta. Escopo aprovado
 * pelo PO na #71/S3:
 *  - "Marcar todas como lidas": inbox, junkemail e subpastas (child). Fora de
 *    drafts/sentitems, onde "não-lido" não faz sentido (ali a contagem é o
 *    total, #56).
 *  - "Esvaziar pasta": SÓ deleteditems e junkemail — as duas pastas em que
 *    apagar tudo de uma vez é operação normal do usuário.
 */
function podeMarcarTodasLidas(tipo: string): boolean {
  return tipo === "inbox" || tipo === "junkemail" || tipo === "child";
}
function podeEsvaziar(tipo: string): boolean {
  return tipo === "deleteditems" || tipo === "junkemail";
}

/**
 * CRUD de subpastas (#90), por TIPO de pasta. Decisão do PO na #71/S4: em pasta
 * well-known as ações inválidas **não aparecem** (esconder, não desabilitar).
 *  - "Criar subpasta": inbox, archive e custom — as três onde criar filha faz
 *    sentido (não em enviados/rascunhos/lixeira/lixo).
 *  - Renomear / Mover / Excluir: SÓ custom (`tipo === "child"`). Well-known é
 *    pasta do sistema: renomear ou apagar quebraria o próprio Outlook.
 */
function podeCriarSubpasta(tipo: string): boolean {
  return tipo === "inbox" || tipo === "archive" || tipo === "child";
}
function ehPastaCustom(tipo: string): boolean {
  return tipo === "child";
}

/**
 * A pasta + TODAS as descendentes já conhecidas. É o conjunto de destinos
 * PROIBIDOS do "Mover pasta…" (#90): mover uma pasta para dentro de si mesma ou
 * de uma filha criaria um ciclo — o Graph recusaria, mas barrar na UI evita a
 * viagem e não oferece uma opção que nunca vai funcionar.
 */
function subarvoreIds(
  id: string,
  subpastas: Record<string, PastaEmail[]>
): Set<string> {
  const out = new Set<string>([id]);
  const fila = [id];
  while (fila.length > 0) {
    const atual = fila.pop()!;
    for (const f of subpastas[atual] ?? []) {
      if (!out.has(f.id)) {
        out.add(f.id);
        fila.push(f.id);
      }
    }
  }
  return out;
}

/**
 * Pasta ACHATADA para o seletor de destino do "Mover para pasta…" (#88): a
 * árvore (raízes de `crMailFolders` + subpastas de `crSubpastas`) vira uma lista
 * plana, com a profundidade para indentar — o padrão do `MoveToFolderDropdown`
 * do MailVault. `caminho` é o nome completo ("Caixa de entrada / Clientes"):
 * alimenta a busca (achar "Clientes" pela pasta-mãe) e o title da linha.
 */
type PastaDestino = {
  id: string;
  rotulo: string;
  caminho: string;
  profundidade: number;
};

/** Achata a árvore de pastas em profundidade (pai antes dos filhos). */
function achatarPastas(
  raizes: PastaEmail[],
  subpastas: Record<string, PastaEmail[]>,
  t: ReturnType<typeof useIdioma>["t"],
  profundidade = 0,
  prefixo = ""
): PastaDestino[] {
  const out: PastaDestino[] = [];
  for (const p of raizes) {
    const rotulo = rotuloPasta(p.tipo, p.nome, t);
    const caminho = prefixo ? `${prefixo} / ${rotulo}` : rotulo;
    out.push({ id: p.id, rotulo, caminho, profundidade });
    const filhos = subpastas[p.id];
    if (filhos && filhos.length > 0) {
      out.push(...achatarPastas(filhos, subpastas, t, profundidade + 1, caminho));
    }
  }
  return out;
}

/**
 * Dialog de NOME de pasta (#90) — serve tanto "Criar subpasta" quanto
 * "Renomear": os dois pedem exatamente um texto, então é o mesmo `Dialog` do
 * registry (Radix) com títulos/rótulos diferentes, em vez de dois componentes
 * quase idênticos. Não é `AlertDialog` de propósito: AlertDialog é pra decisão
 * destrutiva (o "Excluir pasta" usa), não pra formulário.
 *
 * Validação, derivada no render (sem efeito): nome vazio e nome duplicado entre
 * as IRMÃS bloqueiam o botão de confirmar. `irmas` já vem sem a própria pasta no
 * caso do renomear — manter o nome atual não é "duplicado".
 *
 * O componente é montado só quando o dialog abre (`key` no chamador), então o
 * `useState` inicial já entra com o valor certo e sai limpo na próxima abertura.
 */
function DialogNomePasta({
  titulo,
  descricao,
  valorInicial,
  irmas,
  rotuloConfirmar,
  onConfirmar,
  onFechar,
  t,
}: {
  titulo: string;
  descricao: string;
  valorInicial: string;
  irmas: string[];
  rotuloConfirmar: string;
  onConfirmar: (nome: string) => void;
  onFechar: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const [nome, setNome] = useState(valorInicial);
  const [tocado, setTocado] = useState(false);

  const limpo = nome.trim();
  const duplicado =
    limpo !== "" &&
    irmas.some((n) => n.trim().toLowerCase() === limpo.toLowerCase());
  const podeConfirmar = limpo !== "" && !duplicado;
  const erro = duplicado
    ? t.controlRoom.nomePastaDuplicado
    : tocado && limpo === ""
      ? t.controlRoom.nomePastaVazio
      : null;

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <DialogContent className="max-w-sm!">
        <form
          onSubmit={(e) => {
            // Enter confirma (é um formulário de um campo só) — sem isso o
            // usuário teria que ir de mouse até o botão.
            e.preventDefault();
            if (podeConfirmar) onConfirmar(limpo);
          }}
        >
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="nome-pasta">{t.controlRoom.nomePastaRotulo}</Label>
            <Input
              id="nome-pasta"
              autoFocus
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setTocado(true);
              }}
              placeholder={t.controlRoom.nomePastaPlaceholder}
              aria-invalid={erro !== null}
              aria-describedby={erro ? "nome-pasta-erro" : undefined}
            />
            {erro !== null ? (
              <p id="nome-pasta-erro" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              {t.controlRoom.cancelar}
            </Button>
            <Button type="submit" disabled={!podeConfirmar}>
              {rotuloConfirmar}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FolderSidebar({
  pastas,
  subpastas,
  onCarregarSubpastas,
  sel,
  onSel,
  onNovo,
  onComposeOutlook,
  onMarcarTodasLidas,
  onEsvaziarPasta,
  arvore,
  arvoreCarregando,
  onAbrirArvore,
  onCriarSubpasta,
  onRenomearPasta,
  onExcluirPasta,
  onMoverPasta,
  colapsada,
  agendaAberta,
  onToggleAgenda,
  t,
}: {
  pastas: PastaEmail[] | null;
  subpastas: Record<string, PastaEmail[]>;
  onCarregarSubpastas: (id: string) => void;
  sel: string;
  onSel: (id: string) => void;
  onNovo: () => void;
  onComposeOutlook: () => void;
  onMarcarTodasLidas: (folderId: string) => void;
  onEsvaziarPasta: (folderId: string) => void;
  /** Árvore achatada COMPLETA (#88), reusada como destino do "Mover pasta…". */
  arvore: PastaDestino[];
  arvoreCarregando: boolean;
  onAbrirArvore: () => void;
  onCriarSubpasta: (paiId: string, nome: string) => void;
  onRenomearPasta: (id: string, nome: string, paiId?: string) => void;
  onExcluirPasta: (id: string, rotulo: string, paiId?: string) => void;
  onMoverPasta: (
    id: string,
    destino: string,
    rotuloDestino: string,
    paiId?: string
  ) => void;
  colapsada: boolean;
  agendaAberta: boolean;
  onToggleAgenda: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  // Pasta pendente de confirmação do "Esvaziar" — ação destrutiva nunca sai
  // direto do menu: passa pelo AlertDialog (DoD + padrão do app).
  const [aEsvaziar, setAEsvaziar] = useState<{ id: string; rotulo: string } | null>(
    null
  );
  // Mesma regra pro "Excluir pasta" (#90): destrutivo → AlertDialog.
  const [aExcluir, setAExcluir] = useState<{
    id: string;
    rotulo: string;
    paiId?: string;
  } | null>(null);
  // Dialog de nome, compartilhado por "Criar subpasta" e "Renomear" (#90).
  const [dialogNome, setDialogNome] = useState<
    | { modo: "criar"; paiId: string; rotulo: string; irmas: string[] }
    | { modo: "renomear"; id: string; rotulo: string; paiId?: string; irmas: string[] }
    | null
  >(null);
  const mail = (pastas ?? []).filter((p) => GRUPO_MAIL.includes(p.tipo));
  const outras = (pastas ?? []).filter((p) => !GRUPO_MAIL.includes(p.tipo));

  // Subpastas (childFolders): carregadas sob demanda ao expandir. O CACHE mora
  // no pai (#88) porque o submenu "Mover para pasta…" precisa da mesma árvore —
  // assim expandir no sidebar e abrir o submenu não buscam a mesma subpasta
  // duas vezes, e o que já foi carregado num lado aparece no outro.
  const filhos = subpastas;
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const alternarExpandir = (id: string) => {
    setExpandidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    onCarregarSubpastas(id);
  };

  // `paiId` (só nas subpastas) é o que permite ao menu de contexto saber quais
  // são as IRMÃS (validação de nome duplicado) e qual cache invalidar depois da
  // mutação (#90). Nas raízes é `undefined`.
  const Linha = (p: PastaEmail, paiId?: string) => {
    const ehFilho = paiId !== undefined;
    const Ico = ICONE_PASTA[p.tipo] ?? Inbox;
    const ativo = p.id === sel;
    // `contagem` é NÃO-LIDOS para inbox/junk/lixeira/custom; para drafts/sentitems
    // é o TOTAL de itens (não-lido não faz sentido em enviados/rascunhos).
    const contagemEhNaoLidos = p.tipo !== "drafts" && p.tipo !== "sentitems";
    const contagem = contagemEhNaoLidos ? p.naoLidos : p.total;
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
          // fica dentro dos limites e o ScrollArea não corta (#37). O dot é
          // indicador de NÃO-LIDO: só aparece onde `contagem` são não-lidos —
          // nunca em drafts/sentitems (ali é o total, #56); Lixeira/Junk são
          // ruído → também sem dot.
          <span className="relative">
            <Ico className="size-4 shrink-0 text-muted-foreground" />
            {contagem > 0 &&
              contagemEhNaoLidos &&
              p.tipo !== "deleteditems" &&
              p.tipo !== "junkemail" && (
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
    // Menu de contexto da PASTA (#89). Itens condicionais ao tipo; se a pasta
    // não oferece nenhuma ação (drafts/sentitems/archive), o trigger fica
    // desabilitado — nada abre, nem menu vazio (mesmo padrão do menu da ÁREA da
    // lista, #86). O ContextMenuTrigger do Radix já suprime o menu nativo.
    const marcarLidas = podeMarcarTodasLidas(p.tipo);
    const esvaziar = podeEsvaziar(p.tipo);
    // CRUD (#90): criar subpasta em inbox/archive/custom; renomear/mover/excluir
    // SÓ em custom — em well-known essas ações nem aparecem (decisão do PO).
    const criarSub = podeCriarSubpasta(p.tipo);
    const custom = ehPastaCustom(p.tipo);
    const semAcoes = !marcarLidas && !esvaziar && !criarSub && !custom;

    // Irmãs da pasta (para barrar nome duplicado antes de ir ao Graph): as
    // filhas do pai. Nas raízes, as próprias raízes.
    const irmas = (paiId ? (filhos[paiId] ?? []) : (pastas ?? [])).map((f) => f.nome);
    // Destinos válidos do "Mover pasta…": a árvore inteira MENOS a própria
    // pasta e suas descendentes (mover pra dentro de si mesma = ciclo).
    const proibidos = subarvoreIds(p.id, subpastas);
    const destinos = arvore.filter((d) => !proibidos.has(d.id));

    const comMenu = (conteudo: React.ReactNode) => (
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={semAcoes}>
          {conteudo}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {marcarLidas && (
            <ContextMenuItem className="gap-2" onClick={() => onMarcarTodasLidas(p.id)}>
              <MailOpen />
              {t.controlRoom.marcarTodasLidas}
            </ContextMenuItem>
          )}
          {marcarLidas && (criarSub || custom || esvaziar) && <ContextMenuSeparator />}
          {criarSub && (
            <ContextMenuItem
              className="gap-2"
              onClick={() => {
                // Garante as filhas em cache: sem elas não dá pra validar o
                // nome duplicado no cliente (o 409 do Graph é a rede embaixo).
                onCarregarSubpastas(p.id);
                setDialogNome({
                  modo: "criar",
                  paiId: p.id,
                  rotulo,
                  irmas: (filhos[p.id] ?? []).map((f) => f.nome),
                });
              }}
            >
              <FolderPlus />
              {t.controlRoom.criarSubpasta}
            </ContextMenuItem>
          )}
          {custom && (
            <ContextMenuItem
              className="gap-2"
              onClick={() =>
                setDialogNome({
                  modo: "renomear",
                  id: p.id,
                  rotulo,
                  paiId,
                  // Sem a própria pasta: manter o nome atual não é duplicata.
                  irmas: irmas.filter((n) => n !== p.nome),
                })
              }
            >
              <Pencil />
              {t.controlRoom.renomearPasta}
            </ContextMenuItem>
          )}
          {custom && (
            // Mesmo submenu do "Mover para pasta…" do #88 (árvore achatada +
            // busca), só com outro rótulo e outro alvo — não é uma segunda
            // implementação.
            <SubmenuMover
              alvos={[p.id]}
              pastas={destinos}
              carregando={arvoreCarregando}
              rotulo={t.controlRoom.moverPasta}
              onAbrir={onAbrirArvore}
              onMover={(ids, destino, rotuloDestino) =>
                onMoverPasta(ids[0], destino, rotuloDestino, paiId)
              }
              t={t}
            />
          )}
          {custom && <ContextMenuSeparator />}
          {custom && (
            <ContextMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setAExcluir({ id: p.id, rotulo, paiId })}
            >
              <Trash2 />
              {t.controlRoom.excluirPasta}
            </ContextMenuItem>
          )}
          {/* "Esvaziar" só existe em deleted/junk, que nunca têm criar/custom —
              o separador de cima (depois de "Marcar todas") já dá conta. */}
          {esvaziar && (
            <ContextMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setAEsvaziar({ id: p.id, rotulo })}
            >
              <Trash2 />
              {t.controlRoom.esvaziarPasta}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );

    if (colapsada) return <div key={p.id}>{comMenu(linhaBtn)}</div>;
    return (
      <div key={p.id}>
        {comMenu(
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
        )}
        {expandidas.has(p.id) &&
          (filhos[p.id] ?? []).map((c) => Linha({ ...c, tipo: "child" }, p.id))}
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

      {/* Agenda — ancorada no RODAPÉ do sidebar do BRIDGE (separador acima). A
          Agenda pertence ao Bridge, não ao app principal (#50). Selecionado ⟺
          card da Agenda visível; nasce fechada (menos requisições no startup). */}
      <Separator className={cn("shrink-0", colapsada && "w-6")} />
      <Button
        variant={agendaAberta ? "secondary" : "ghost"}
        onClick={onToggleAgenda}
        title={t.controlRoom.agendaTitulo}
        aria-label={t.controlRoom.agendaTitulo}
        className={cn(
          "shrink-0",
          colapsada ? "size-9 justify-center p-0" : "w-full justify-start gap-2.5",
          !agendaAberta && "text-muted-foreground"
        )}
      >
        <CalendarDays className="size-4 shrink-0" />
        {!colapsada && <span>{t.controlRoom.agendaTitulo}</span>}
      </Button>

      {/* Confirmação do "Esvaziar pasta": destrutiva e não desfazível, então
          nunca dispara direto do menu de contexto (#89). */}
      <AlertDialog
        open={aEsvaziar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAEsvaziar(null);
        }}
      >
        <AlertDialogContent className="max-w-sm!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preencher(t.controlRoom.esvaziarPastaTitulo, {
                pasta: aEsvaziar?.rotulo ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.esvaziarPastaDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.controlRoom.cancelar}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (aEsvaziar) onEsvaziarPasta(aEsvaziar.id);
                setAEsvaziar(null);
              }}
            >
              {t.controlRoom.esvaziarPastaConfirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação do "Excluir pasta" (#90). Destrutiva, então AlertDialog —
          mas REVERSÍVEL: o texto diz que a pasta vai pra Lixeira (decisão do PO
          na #71/D3), não que some pra sempre. */}
      <AlertDialog
        open={aExcluir !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAExcluir(null);
        }}
      >
        <AlertDialogContent className="max-w-sm!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preencher(t.controlRoom.excluirPastaTitulo, {
                pasta: aExcluir?.rotulo ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.excluirPastaDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.controlRoom.cancelar}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (aExcluir)
                  onExcluirPasta(aExcluir.id, aExcluir.rotulo, aExcluir.paiId);
                setAExcluir(null);
              }}
            >
              {t.controlRoom.excluirPastaConfirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de nome — "Criar subpasta" e "Renomear" (#90). Montado só quando
          abre (e com `key`), então o campo já nasce com o valor certo e não
          carrega o texto da abertura anterior. */}
      {dialogNome !== null ? (
        dialogNome.modo === "criar" ? (
          <DialogNomePasta
            key={`criar-${dialogNome.paiId}`}
            titulo={preencher(t.controlRoom.criarSubpastaTitulo, {
              pasta: dialogNome.rotulo,
            })}
            descricao={t.controlRoom.criarSubpastaDesc}
            valorInicial=""
            irmas={dialogNome.irmas}
            rotuloConfirmar={t.controlRoom.criar}
            onConfirmar={(nome) => {
              onCriarSubpasta(dialogNome.paiId, nome);
              setDialogNome(null);
            }}
            onFechar={() => setDialogNome(null)}
            t={t}
          />
        ) : (
          <DialogNomePasta
            key={`renomear-${dialogNome.id}`}
            titulo={preencher(t.controlRoom.renomearPastaTitulo, {
              pasta: dialogNome.rotulo,
            })}
            descricao={t.controlRoom.renomearPastaDesc}
            valorInicial={dialogNome.rotulo}
            irmas={dialogNome.irmas}
            rotuloConfirmar={t.controlRoom.salvar}
            onConfirmar={(nome) => {
              onRenomearPasta(dialogNome.id, nome, dialogNome.paiId);
              setDialogNome(null);
            }}
            onFechar={() => setDialogNome(null)}
            t={t}
          />
        )
      ) : null}
    </aside>
  );
}

// ===========================================================================
// Painel 2 — lista de mensagens
// ===========================================================================

// Filtro único da lista (dropdown estilo Outlook, #31). Os 4 primeiros são
// client-side (aplicados sobre a lista já carregada, como as antigas abas); os
// 3 últimos exigem o servidor (cr_filtrar) e são buscados pelo pai.
// Escopos que EXIGEM o servidor (não dá só na lista carregada) — resolvidos por
// `api.crFiltrar`. Modelados como o campo `scope` do filter-builder reui (#31).
type FiltroServidor = "tome" | "mentions" | "invites";

/**
 * Deriva o escopo de servidor ativo (1 por vez) da lista de filtros do builder.
 * O componente reui é um filter-builder multi-campo; só o campo `scope` vai ao
 * Graph. Se houver mais de um chip `scope` (allowMultiple), o primeiro manda —
 * os client-side (De/Status/Sinalizado/Anexos) combinam por cima com E (AND).
 */
function escopoDeFiltros(filtros: Filter<string>[]): FiltroServidor | null {
  const v = filtros.find((f) => f.field === "scope")?.values[0];
  return v === "tome" || v === "mentions" || v === "invites" ? v : null;
}

/**
 * Aplica os filtros client-side (De, Status, Sinalizado, Anexos) sobre um item,
 * combinados com E (AND). O campo `scope` é resolvido no servidor, então aqui é
 * ignorado. Honra os operadores is/is_not (selects) e contains/not_contains
 * (texto De).
 */
function passaFiltrosClient(m: EmailItem, filtros: Filter<string>[]): boolean {
  for (const f of filtros) {
    const v = f.values[0];
    if (f.field === "from") {
      const termo = String(v ?? "").trim().toLowerCase();
      if (!termo) continue;
      const contem = `${m.de} ${m.deEmail}`.toLowerCase().includes(termo);
      if (f.operator === "not_contains" ? contem : !contem) return false;
    } else if (f.field === "status") {
      if (v == null) continue;
      const bate = v === "unread" ? !m.lido : m.lido;
      if (f.operator === "is_not" ? bate : !bate) return false;
    } else if (f.field === "flagged") {
      if (v == null) continue;
      const bate = v === "yes" ? m.sinalizado : !m.sinalizado;
      if (f.operator === "is_not" ? bate : !bate) return false;
    } else if (f.field === "files") {
      if (v == null) continue;
      const bate = v === "yes" ? m.temAnexos : !m.temAnexos;
      if (f.operator === "is_not" ? bate : !bate) return false;
    } else if (f.field === "data") {
      // Intervalo de datas (#110): o valor é um DateSelectorValue serializado
      // (ISO) em values[0]. Reidrata, resolve o intervalo concreto e testa
      // `início ≤ recebido ≤ fim`. Seleção incompleta = sem restrição (passa).
      const dv = desserializarDataFiltro(v as string | undefined);
      if (!dv) continue;
      const range = resolveIntervaloData(dv);
      if (!range) continue;
      const quando = new Date(comZ(m.recebido)).getTime();
      if (Number.isNaN(quando)) return false;
      if (range.ini !== null && quando < range.ini) return false;
      if (range.fim !== null && quando > range.fim) return false;
    }
    // `scope` → servidor (crFiltrar), ignorado no client-side.
  }
  return true;
}

// --- Filtro de intervalo de datas (#110) -----------------------------------
// O DateSelector (reui) guarda a seleção num `DateSelectorValue` que contém
// Dates (não sobrevivem a JSON cru) e campos de período (mês/trimestre/ano). O
// filter-builder reui trabalha com `Filter<string>` e o localStorage serializa
// o array inteiro. Guardamos o valor como JSON com as datas em ISO em
// `values[0]` e reidratamos as Dates ao ler — mesmo shape `bridge.filtrosLista.v2`
// do #31.
function serializarDataFiltro(v: DateSelectorValue): string {
  return JSON.stringify(v, (_k, val) =>
    val instanceof Date ? val.toISOString() : val,
  );
}

function desserializarDataFiltro(
  s: string | undefined,
): DateSelectorValue | undefined {
  if (!s) return undefined;
  try {
    const raw = JSON.parse(s) as DateSelectorValue;
    return {
      ...raw,
      startDate: raw.startDate ? new Date(raw.startDate) : undefined,
      endDate: raw.endDate ? new Date(raw.endDate) : undefined,
    };
  } catch {
    return undefined;
  }
}

const inicioDoDia = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
const fimDoDia = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
const inicioDoMes = (ano: number, mes: number) =>
  new Date(ano, mes, 1, 0, 0, 0, 0).getTime();
// `new Date(ano, mes+1, 0)` = último dia do mês `mes` (0-indexado).
const fimDoMes = (ano: number, mes: number) =>
  new Date(ano, mes + 1, 0, 23, 59, 59, 999).getTime();

// Meses (0-indexados) que abrem/fecham cada período de um dado tipo/valor.
// month: value é o próprio mês; quarter: 0→jan..; half-year: 0→jan/1→jul; year.
function mesesDoPeriodo(
  period: DateSelectorValue["period"],
  value: number,
): { mesIni: number; mesFim: number } {
  switch (period) {
    case "quarter":
      return { mesIni: value * 3, mesFim: value * 3 + 2 };
    case "half-year":
      return { mesIni: value * 6, mesFim: value * 6 + 5 };
    case "year":
      return { mesIni: 0, mesFim: 11 };
    default: // "month"
      return { mesIni: value, mesFim: value };
  }
}

// Faixa-base [s, e] (epoch ms) coberta pela seleção, ignorando o operador. Os
// campos preenchidos espelham `formatDateValue`: day → startDate/endDate;
// month/quarter/half-year/year → year+unidade OU rangeStart/rangeEnd.
function faixaBaseData(v: DateSelectorValue): { s: number; e: number } | null {
  if (v.period === "day") {
    if (v.startDate && v.endDate) {
      return { s: inicioDoDia(v.startDate), e: fimDoDia(v.endDate) };
    }
    if (v.startDate) {
      return { s: inicioDoDia(v.startDate), e: fimDoDia(v.startDate) };
    }
    return null;
  }
  // Períodos calendáricos (mês/trimestre/semestre/ano).
  const unidade =
    v.period === "month"
      ? v.month
      : v.period === "quarter"
        ? v.quarter
        : v.period === "half-year"
          ? v.halfYear
          : 0; // "year" não usa unidade
  if (v.rangeStart && v.rangeEnd) {
    const ini = mesesDoPeriodo(v.period, v.rangeStart.value);
    const fim = mesesDoPeriodo(v.period, v.rangeEnd.value);
    return {
      s: inicioDoMes(v.rangeStart.year, ini.mesIni),
      e: fimDoMes(v.rangeEnd.year, fim.mesFim),
    };
  }
  if (v.year !== undefined && (v.period === "year" || unidade !== undefined)) {
    const { mesIni, mesFim } = mesesDoPeriodo(v.period, unidade ?? 0);
    return { s: inicioDoMes(v.year, mesIni), e: fimDoMes(v.year, mesFim) };
  }
  return null;
}

/**
 * Resolve o `DateSelectorValue` num intervalo concreto [ini, fim] (epoch ms,
 * inclusivo; `null` = ilimitado daquele lado), honrando o operador da seleção:
 * `is`/`between` = a faixa em si; `before` = tudo antes dela; `after` = tudo
 * depois. Retorna `null` quando a seleção está incompleta (o filtro não
 * restringe nada).
 */
function resolveIntervaloData(
  v: DateSelectorValue,
): { ini: number | null; fim: number | null } | null {
  const base = faixaBaseData(v);
  if (!base) return null;
  switch (v.operator) {
    case "before":
      return { ini: null, fim: base.s - 1 };
    case "after":
      return { ini: base.e + 1, fim: null };
    default: // "is" | "between"
      return { ini: base.s, fim: base.e };
  }
}

// i18n em português do DateSelector (o registry vem só em inglês). Trimestres
// (Q1–Q4) e semestres (H1–H2) ficam como no padrão — são notação de negócio
// usada também em BR e batem com o parser de linguagem natural do input.
const DATE_SELECTOR_I18N_PT: Partial<DateSelectorI18nConfig> = {
  selectDate: "Selecionar data",
  apply: "Aplicar",
  cancel: "Cancelar",
  clear: "Limpar",
  today: "Hoje",
  filterTypes: { is: "é", before: "antes", after: "depois", between: "entre" },
  periodTypes: {
    day: "Dia",
    month: "Mês",
    quarter: "Trimestre",
    halfYear: "Semestre",
    year: "Ano",
  },
  months: [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ],
  monthsShort: [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ],
  quarters: ["Q1", "Q2", "Q3", "Q4"],
  halfYears: ["H1", "H2"],
  weekdays: [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ],
  weekdaysShort: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
  placeholder: "Selecionar data...",
  rangePlaceholder: "Selecionar intervalo...",
};

/**
 * Campo "Data" do filter-builder reui (#110) como o `type: "custom"` do exemplo
 * `c-filters-6` do PO: um Dialog (modal) com o `DateSelector` literal do
 * registry. O valor vive serializado em `values[0]`; ao Aplicar, chama o
 * `onChange` do reui com a string ISO. O gatilho do chip mostra o intervalo
 * legível (ex.: "01/05/2025 - 10/05/2025") via `formatDateValue`.
 */
function SeletorDataFiltro({
  values,
  onChange,
  t,
  idioma,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const atual = desserializarDataFiltro(values?.[0]);
  const [aberto, setAberto] = useState(false);
  // `valorInicial` alimenta o DateSelector como valor de partida (semente),
  // ESTÁVEL enquanto o modal fica aberto. `rascunho` acumula o que o
  // DateSelector emite. NÃO realimentamos `rascunho` como `value`: o
  // DateSelector reidrata o estado interno a partir de `value` (efeito próprio)
  // e, se `value` mudasse a cada clique, ele zeraria a seleção do dia (o clique
  // no calendário nunca "grudava"). Semente estável + rascunho separado quebra
  // esse laço.
  const [valorInicial, setValorInicial] = useState<DateSelectorValue | undefined>(
    atual,
  );
  const [rascunho, setRascunho] = useState<DateSelectorValue | undefined>(atual);

  const ehPt = idioma === "pt-BR";
  const dsI18n = ehPt ? DATE_SELECTOR_I18N_PT : undefined;
  const fmt = ehPt ? "dd/MM/yyyy" : "MM/dd/yyyy";
  const rotulo = atual
    ? formatDateValue(
        atual,
        ehPt ? { ...DEFAULT_DATE_SELECTOR_I18N, ...DATE_SELECTOR_I18N_PT } : undefined,
        fmt,
      )
    : "";
  const texto = rotulo || t.controlRoom.filtroDataSelecione;

  // Ao abrir, semeia a partida e o rascunho com o valor persistido.
  useEffect(() => {
    if (aberto) {
      const v = desserializarDataFiltro(values?.[0]);
      setValorInicial(v);
      setRascunho(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const aplicar = () => {
    // Só persiste um intervalo REALMENTE resolvível (senão o chip fica vazio).
    const resolvivel = rascunho && resolveIntervaloData(rascunho) !== null;
    onChange(resolvivel ? [serializarDataFiltro(rascunho!)] : []);
    setAberto(false);
  };

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger className="outline-hidden">{texto}</DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.controlRoom.filtroDataTitulo}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.controlRoom.filtroDataDescricao}
          </DialogDescription>
        </DialogHeader>
        <DateSelector
          value={valorInicial}
          onChange={setRascunho}
          showInput
          label={t.controlRoom.filtroData}
          inputHint={t.controlRoom.filtroDataDica}
          i18n={dsI18n}
          dayDateFormat={fmt}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t.controlRoom.cancelar}</Button>
          </DialogClose>
          <Button onClick={aplicar}>{t.controlRoom.filtroAplicar}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Quando a mensagem aberta é marcada como lida (#95). Espelha as três opções do
// BehaviorSettings do MailVault: imediato (default, o comportamento histórico),
// após um atraso configurável, ou só manualmente pela ação de marcar lido.
type MarcarLidoModo = "imediato" | "atraso" | "manual";
const MARCAR_LIDO_MODOS: readonly MarcarLidoModo[] = ["imediato", "atraso", "manual"];
/**
 * Atrasos oferecidos no modo "após um atraso" (segundos). Poucos presets em vez
 * do slider 1-10s do MailVault: dentro de um DropdownMenu o Radix já usa as
 * setas pro roving focus (slider ficaria inoperável no teclado), e ninguém tem
 * opinião sobre 7s vs 8s — as três intenções reais são "rápido", "só se eu
 * ficar" e "nunca". (Recomendação da pesquisa de UX da #95.)
 */
const MARCAR_LIDO_ATRASOS = [2, 5, 10] as const;
const MARCAR_LIDO_ATRASO_PADRAO = 2;

// Linha da lista virtualizada: cabeçalho de grupo OU mensagem. Agrupar por
// período (+ grupo Flagged no topo) vira linhas planas pra não quebrar o
// react-virtual (#30).
type LinhaLista =
  | { tipo: "grupo"; chave: string; rotulo: string; n: number }
  | { tipo: "msg"; m: EmailItem };

/** Bucket de período estilo Outlook (#30): Hoje / Ontem / <mês do ano
 *  corrente> / <ano anterior> / Older. Ex.: em jul/2026 → Hoje, Ontem, Julho,
 *  Junho, ..., Janeiro, 2025, Older. A chave carrega o dado bruto; o rótulo é
 *  resolvido por idioma em `rotuloDePeriodo`. */
function periodoChave(recebido: string, agora: Date): string {
  const d = new Date(comZ(recebido));
  if (Number.isNaN(d.getTime())) return "older";
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((dia(agora) - dia(d)) / 86400000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  if (d.getFullYear() === agora.getFullYear()) return `mes-${d.getMonth()}`;
  if (d.getFullYear() === agora.getFullYear() - 1) return `ano-${d.getFullYear()}`;
  return "older";
}

/**
 * Submenu "Mover para pasta…" (#88) — a árvore de pastas ACHATADA (indentada
 * por profundidade) com BUSCA por nome, portando o padrão do
 * `MoveToFolderDropdown` do MailVault para o menu de contexto do Bridge.
 *
 * Montado com `ContextMenuSub`/`SubTrigger`/`SubContent` do @reui/context-menu
 * (Radix) e o `Input` do registry — o mesmo arranjo "campo de busca + separador
 * + lista rolável" que o @reui/filters usa na sua lista pesquisável.
 *
 * A pasta ATUAL não entra na lista (já vem filtrada do pai): mover para onde a
 * mensagem já está não é uma opção.
 *
 * Serve aos DOIS "mover" do Bridge: o de mensagens (#88, `alvos` = ids das
 * mensagens) e o de PASTA (#90, `alvos` = [id da pasta], com `rotulo` próprio e
 * a lista já sem a própria pasta/descendentes). Só muda o rótulo do gatilho — a
 * árvore achatada, a busca e o comportamento do menu são os mesmos.
 */
function SubmenuMover({
  alvos,
  pastas,
  carregando,
  rotulo,
  onAbrir,
  onMover,
  t,
}: {
  alvos: string[];
  pastas: PastaDestino[];
  carregando: boolean;
  /** Texto do gatilho; padrão é o "Mover para pasta…" das mensagens (#88). */
  rotulo?: string;
  onAbrir: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const [busca, setBusca] = useState("");
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pastas;
    // Busca no CAMINHO: digitar o nome da pasta-mãe também acha as filhas.
    return pastas.filter((p) => p.caminho.toLowerCase().includes(q));
  }, [pastas, busca]);

  return (
    <ContextMenuSub
      onOpenChange={(aberto) => {
        // Abrir o submenu é o gatilho pra completar a árvore (as subpastas são
        // lazy); fechar limpa a busca pra próxima abertura começar do zero.
        if (aberto) onAbrir();
        else setBusca("");
      }}
    >
      <ContextMenuSubTrigger className="gap-2">
        <FolderInput />
        {rotulo ?? t.controlRoom.moverPara}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-64 p-0">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t.controlRoom.moverBuscarPasta}
          aria-label={t.controlRoom.moverBuscarPasta}
          className="h-8 rounded-none border-0 bg-transparent! px-2 text-sm shadow-none focus-visible:border-border focus-visible:ring-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Escape/Tab seguem pro Radix (fecham o menu); o resto fica no
            // input — senão a navegação-por-digitação do menu roubaria as
            // letras e a busca nunca receberia texto.
            if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
          }}
        />
        <ContextMenuSeparator className="mx-0 my-0" />
        {filtradas.length === 0 ? (
          <p className="px-3 py-3 text-center text-sm text-muted-foreground">
            {carregando ? t.controlRoom.moverCarregandoPastas : t.controlRoom.moverSemPastas}
          </p>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {filtradas.map((p) => (
                <ContextMenuItem
                  key={p.id}
                  className="gap-2"
                  title={p.caminho}
                  onClick={() => onMover(alvos, p.id, p.rotulo)}
                >
                  {/* Indentação por profundidade = a hierarquia continua
                      legível mesmo com a árvore achatada (MailVault). */}
                  <Folder style={{ marginLeft: p.profundidade * 12 }} />
                  <span className="truncate">{p.rotulo}</span>
                </ContextMenuItem>
              ))}
            </div>
          </ScrollArea>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * Itens do menu de contexto de e-mail (#86). Fica compartilhado entre o menu da
 * LINHA e o menu da ÁREA da lista (botão direito fora das linhas) para que os
 * dois ofereçam exatamente as mesmas ações — inclusive as folder-aware (em
 * Itens Excluídos "Excluir" vira "Excluir permanentemente").
 *
 * `lido`/`sinalizado` são o estado do ALVO (a linha clicada ou, na seleção, o
 * estado comum dela): definem o rótulo e o valor novo aplicado a `alvos`.
 */
function ItensMenuEmail({
  alvos,
  lido,
  sinalizado,
  permanente,
  onMarcarLido,
  onFlag,
  onExcluir,
  pastasDestino,
  pastasCarregando,
  onAbrirMover,
  onMover,
  setSelecionados,
  t,
}: {
  alvos: string[];
  lido: boolean;
  sinalizado: boolean;
  permanente: boolean;
  onMarcarLido: (id: string, lido: boolean) => void;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void | Promise<void>;
  pastasDestino: PastaDestino[];
  pastasCarregando: boolean;
  onAbrirMover: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
  setSelecionados: React.Dispatch<React.SetStateAction<Set<string>>>;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  return (
    <>
      <ContextMenuItem
        className="gap-2"
        onClick={() => alvos.forEach((id) => onMarcarLido(id, !lido))}
      >
        {lido ? <Mail /> : <MailOpen />}
        {lido ? t.controlRoom.marcarNaoLido : t.controlRoom.marcarLido}
      </ContextMenuItem>
      <ContextMenuItem
        className="gap-2"
        onClick={() => alvos.forEach((id) => onFlag(id, !sinalizado))}
      >
        {sinalizado ? <FlagOff /> : <Flag />}
        {sinalizado ? t.controlRoom.removerSinal : t.controlRoom.sinalizar}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {/* "Mover para pasta…" (#88): submenu com a árvore achatada + busca. */}
      <SubmenuMover
        alvos={alvos}
        pastas={pastasDestino}
        carregando={pastasCarregando}
        onAbrir={onAbrirMover}
        onMover={onMover}
        t={t}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        className="gap-2"
        onClick={() => {
          onExcluir(alvos);
          // Tira da seleção o que foi excluído — senão a barra "N selected"
          // fica fantasma após excluir pelo menu de contexto (o atalho Delete
          // já limpava; o menu não) (rejeição do #86 pelo PO).
          setSelecionados((s) => {
            const n = new Set(s);
            alvos.forEach((id) => n.delete(id));
            return n;
          });
        }}
      >
        <Trash2 />
        {permanente ? t.controlRoom.excluirPermanente : t.controlRoom.excluir}
      </ContextMenuItem>
    </>
  );
}

function MessageList({
  titulo,
  mensagens,
  sel,
  onSel,
  onRefresh,
  sidebarAberta,
  onToggleSidebar,
  pastaId,
  pastaTipo,
  onEsvaziar,
  onCarregarMais,
  carregandoMais,
  temMais,
  onFlag,
  onExcluir,
  onMarcarLido,
  pastasDestino,
  pastasCarregando,
  onAbrirMover,
  onMover,
  selecionados,
  setSelecionados,
  naoLidosPasta,
  contFlagged,
  contAnexos,
  filtros,
  onFiltros,
  filtrosOcultos,
  busca,
  setBusca,
  ordenar,
  ordemDesc,
  onOrdenar,
  marcarLidoModo,
  marcarLidoAtraso,
  onMarcarLidoModo,
  onMarcarLidoAtraso,
  onResponder,
  onResponderTodos,
  onEncaminhar,
  onCompor,
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
  pastaId: string;
  pastaTipo: string;
  onEsvaziar: () => void;
  onCarregarMais: () => void;
  carregandoMais: boolean;
  temMais: boolean;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void | Promise<void>;
  onMarcarLido: (id: string, lido: boolean) => void;
  pastasDestino: PastaDestino[];
  pastasCarregando: boolean;
  onAbrirMover: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
  selecionados: Set<string>;
  setSelecionados: React.Dispatch<React.SetStateAction<Set<string>>>;
  naoLidosPasta: number;
  contFlagged: number | null;
  contAnexos: number | null;
  filtros: Filter<string>[];
  onFiltros: (fs: Filter<string>[]) => void;
  filtrosOcultos: Set<string>;
  busca: string;
  setBusca: (v: string) => void;
  ordenar: api.OrdenarMensagens;
  ordemDesc: boolean;
  onOrdenar: (ordenar: api.OrdenarMensagens, descendente: boolean) => void;
  marcarLidoModo: MarcarLidoModo;
  marcarLidoAtraso: number;
  onMarcarLidoModo: (m: MarcarLidoModo) => void;
  onMarcarLidoAtraso: (s: number) => void;
  // Atalhos de teclado (#28): ações que vivem no LEITOR (reply/forward via
  // handle imperativo) e no PAI (compor). MessageList só dispara a tecla.
  onResponder: () => void;
  onResponderTodos: () => void;
  onEncaminhar: () => void;
  onCompor: () => void;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const listaRef = useRef<HTMLDivElement>(null);
  // Busca (para o atalho "/" focar) e âncora do intervalo de Shift+clique (#28).
  const buscaRef = useRef<HTMLInputElement>(null);
  const ancoraRef = useRef<string | null>(null);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  const filtroServidor = escopoDeFiltros(filtros);
  const filtroGraph = filtroServidor !== null;

  // ESC limpa só a busca de texto (o filtro é global/persistido, controlado
  // pelo pai — não é resetado aqui).
  const limparBusca = () => {
    setBusca("");
  };

  const alternarSel = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // A busca por TEXTO e os filtros Graph são resolvidos pelo pai (que passa os
  // resultados como `mensagens`); aqui só aplicamos os filtros CLIENT-side
  // (Unread/Flagged/Files) sobre a fonte. "all" e os filtros Graph não filtram
  // mais nada aqui.
  const filtrada = useMemo(() => {
    if (!mensagens) return [];
    return mensagens.filter((m) => passaFiltrosClient(m, filtros));
  }, [mensagens, filtros]);

  // Agrupamento por período + grupo Flagged no topo (#30). Só quando ordenado
  // por DATA e fora de busca/filtro-Graph (período segue a ordem; em busca e nos
  // filtros Graph — ex.: "To me" via $search — o Graph ordena por relevância).
  // Colapso persiste (regra: o app guarda o estado do usuário).
  const AGRUPAR = ordenar === "data" && busca.trim() === "" && !filtroGraph;
  // O colapso persiste POR PASTA. A chave do grupo é o PERÍODO ("hoje",
  // "mes-5", "ano-2025", "older"…) e antes era guardada numa lista ÚNICA, comum
  // a todas as pastas: colapsar "Junho" na Inbox escondia também todo o "Junho"
  // de Itens Excluídos/Lixo Eletrônico — pastas de mail ANTIGO, onde quase tudo
  // cai nos períodos velhos. Com todos os grupos colapsados a lista renderiza
  // SÓ cabeçalhos (que não são linhas de e-mail), e aí o botão direito não
  // encontra nada pra abrir o menu de contexto — a causa do "não há menu de
  // contexto em Deleted e Junk" (#86). Guardar por pasta mantém o estado do
  // usuário sem vazar de uma pasta pra outra.
  const [colapsadosMapa, setColapsadosMapa] = usePersistedState<Record<string, string[]>>(
    "bridge.gruposColapsados.v2",
    {}
  );
  const colapsadosArr = useMemo(
    () => colapsadosMapa[pastaId] ?? [],
    [colapsadosMapa, pastaId]
  );
  const colapsados = useMemo(() => new Set(colapsadosArr), [colapsadosArr]);
  // Quantas linhas de MENSAGEM o último auto-preenchimento (#82) já tinha visto.
  // null = auto-preenchimento liberado (o usuário mexeu no colapso / rolou).
  const autoPreencheuRef = useRef<number | null>(null);
  const alternarColapso = (chave: string) => {
    autoPreencheuRef.current = null; // abrir/fechar grupo libera o auto-preenchimento
    setColapsadosMapa((mapa) => {
      const atual = mapa[pastaId] ?? [];
      return {
        ...mapa,
        [pastaId]: atual.includes(chave)
          ? atual.filter((c) => c !== chave)
          : [...atual, chave],
      };
    });
  };
  // Rótulo do período por idioma: hoje/ontem/older via strings; mês via nome
  // localizado (Intl, capitalizado); ano anterior via o número do ano (#30).
  const rotuloDePeriodo = useCallback(
    (chave: string): string => {
      if (chave === "hoje") return t.controlRoom.grupoHoje;
      if (chave === "ontem") return t.controlRoom.grupoOntem;
      if (chave === "older") return t.controlRoom.grupoAntigos;
      if (chave.startsWith("ano-")) return chave.slice(4);
      if (chave.startsWith("mes-")) {
        const idx = Number(chave.slice(4));
        const nome = new Date(2000, idx, 1).toLocaleDateString(idioma, {
          month: "long",
        });
        return nome.charAt(0).toUpperCase() + nome.slice(1);
      }
      return chave;
    },
    [t, idioma]
  );
  // Lista PLANA de linhas (headers + msgs) pra virtualizar — headers viram
  // linhas virtuais sem quebrar o react-virtual. Flagged são puxados pro topo
  // (não duplicam nos períodos). Grupo colapsado = só o header.
  const linhas = useMemo<LinhaLista[]>(() => {
    if (!AGRUPAR) return filtrada.map((m) => ({ tipo: "msg", m }) as LinhaLista);
    const out: LinhaLista[] = [];
    const agora = new Date();
    const flagged = filtrada.filter((m) => m.sinalizado);
    const resto = filtrada.filter((m) => !m.sinalizado);
    if (flagged.length > 0) {
      out.push({ tipo: "grupo", chave: "flagged", rotulo: t.controlRoom.grupoFlagged, n: flagged.length });
      if (!colapsados.has("flagged")) for (const m of flagged) out.push({ tipo: "msg", m });
    }
    let atual: string | null = null;
    let header: Extract<LinhaLista, { tipo: "grupo" }> | null = null;
    for (const m of resto) {
      const chave = periodoChave(m.recebido, agora);
      if (chave !== atual) {
        atual = chave;
        header = { tipo: "grupo", chave, rotulo: rotuloDePeriodo(chave), n: 0 };
        out.push(header);
      }
      if (header) header.n++;
      if (!colapsados.has(chave)) out.push({ tipo: "msg", m });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrada, AGRUPAR, colapsados, t, rotuloDePeriodo]);

  const filtrando = busca.trim() !== "" || filtros.length > 0;
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
    count: linhas.length,
    getScrollElement: () => listaRef.current,
    estimateSize: (i) => (linhas[i]?.tipo === "grupo" ? 32 : ROW_ALTURA),
    overscan: 8,
    getItemKey: (i) => {
      const l = linhas[i];
      return l ? (l.tipo === "grupo" ? `g:${l.chave}` : l.m.id) : i;
    },
  });

  // Avatares dos remetentes internos (#39): coleta os e-mails das linhas
  // VISÍVEIS (virtualizadas) e pede as fotos em lote (debounce + $batch no
  // cache). `getFoto` é lido na hora de renderizar cada linha.
  const { getFoto, pedirFotos } = useFotos();
  const itensVirtuais = virtualizer.getVirtualItems();
  // Assinatura estável do intervalo visível: evita re-disparar o efeito a cada
  // render (o array de itens virtuais tem identidade nova toda vez).
  const faixaVisivel = itensVirtuais.length
    ? `${itensVirtuais[0].index}-${itensVirtuais[itensVirtuais.length - 1].index}`
    : "";
  useEffect(() => {
    const emails: string[] = [];
    for (const vr of itensVirtuais) {
      const l = linhas[vr.index];
      if (l && l.tipo === "msg" && l.m.deEmail) emails.push(l.m.deEmail);
    }
    if (emails.length) pedirFotos(emails);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faixaVisivel, linhas, pedirFotos]);

  // Campos do filter-builder reui (#31), combináveis com E (AND) via
  // `allowMultiple`. Client-side (sobre a lista carregada): De, Status,
  // Sinalizado, Anexos. Servidor (via `crFiltrar`): Escopo — Para mim / Me
  // mencionam / Convites, 1 por vez. Nada de campo "view" único (que gerava o
  // submenu "Filtro >" redundante que o PO reprovou): com vários campos reais o
  // gatilho abre a LISTA de campos direto, como no exemplo da reui.
  const OP_TEXTO: FilterOperator[] = [
    { value: "contains", label: t.controlRoom.filtroOpContem },
    { value: "not_contains", label: t.controlRoom.filtroOpNaoContem },
  ];
  const OP_SELECT: FilterOperator[] = [
    { value: "is", label: t.controlRoom.filtroOperadorIs },
    { value: "is_not", label: t.controlRoom.filtroOpNaoE },
  ];
  // D6: escopos que o tenant rejeitou (400) somem (`filtrosOcultos`).
  const escopoOpcoes = (
    [
      { value: "tome", label: t.controlRoom.filtroToMe, icon: <User className="size-3.5" /> },
      { value: "mentions", label: t.controlRoom.filtroMentions, icon: <AtSign className="size-3.5" /> },
      { value: "invites", label: t.controlRoom.filtroInvites, icon: <CalendarCheck className="size-3.5" /> },
    ] as FilterOption<string>[]
  ).filter((o) => !filtrosOcultos.has(o.value as string));

  // Campos agrupados como no exemplo canônico do reui (`Pattern()` do
  // c-filters-5): um grupo "Básico" com os campos de texto e um grupo "Seleção"
  // com os campos de opção. A lista de campos flattena os grupos, mas manter a
  // estrutura de `group` casa 1:1 com o exemplo que o PO pediu.
  const filtroCampos: FilterFieldConfig<string>[] = [
    {
      group: t.controlRoom.filtroGrupoBasico,
      fields: [
        {
          key: "from",
          label: t.controlRoom.filtroDe,
          icon: <User className="size-3.5" />,
          type: "text",
          operators: OP_TEXTO,
          defaultOperator: "contains",
          placeholder: t.controlRoom.filtroDePlaceholder,
        },
      ],
    },
    {
      group: t.controlRoom.filtroGrupoSelecao,
      fields: [
        // Intervalo de datas (#110): campo `type: "custom"` com o DateSelector
        // do registry num modal (padrão do exemplo `c-filters-6` do PO). O
        // range é aplicado client-side (`passaFiltrosClient`) e combina por E
        // (AND) com os demais. Único operador ("é") — o modo real (é/antes/
        // depois/entre) mora no próprio DateSelectorValue.
        {
          key: "data",
          label: t.controlRoom.filtroData,
          icon: <CalendarDays className="size-3.5" />,
          type: "custom",
          operators: [
            { value: "is", label: t.controlRoom.filtroOperadorIs },
          ],
          defaultOperator: "is",
          customRenderer: ({ values, onChange }) => (
            <SeletorDataFiltro
              values={values}
              onChange={onChange}
              t={t}
              idioma={idioma}
            />
          ),
        },
        {
          key: "status",
          label: t.controlRoom.filtroStatus,
          icon: <Mail className="size-3.5" />,
          type: "select",
          searchable: false,
          operators: OP_SELECT,
          options: [
            { value: "unread", label: t.controlRoom.abaNaoLidos },
            { value: "read", label: t.controlRoom.filtroLidos },
          ],
        },
        {
          key: "flagged",
          label: t.controlRoom.abaSinalizados,
          icon: <Flag className="size-3.5" />,
          type: "select",
          searchable: false,
          operators: OP_SELECT,
          options: [
            { value: "yes", label: t.controlRoom.filtroSim },
            { value: "no", label: t.controlRoom.filtroNao },
          ],
        },
        {
          key: "files",
          label: t.controlRoom.abaAnexos,
          icon: <Paperclip className="size-3.5" />,
          type: "select",
          searchable: false,
          operators: OP_SELECT,
          options: [
            { value: "yes", label: t.controlRoom.filtroSim },
            { value: "no", label: t.controlRoom.filtroNao },
          ],
        },
        // Escopo só entra se houver ao menos uma opção não escondida (D6).
        ...(escopoOpcoes.length > 0
          ? [
              {
                key: "scope",
                label: t.controlRoom.filtroEscopo,
                icon: <ListFilter className="size-3.5" />,
                type: "select" as const,
                searchable: false,
                // Escopo é resolvido no servidor; só "é" faz sentido.
                operators: [
                  { value: "is", label: t.controlRoom.filtroOperadorIs },
                ],
                options: escopoOpcoes,
              },
            ]
          : []),
      ],
    },
  ];

  // Move a seleção ativa (↑/↓ e j/k) e rola o virtualizer até ela.
  const irPara = (idx: number) => {
    const alvo = filtrada[idx];
    if (!alvo) return;
    onSel(alvo.id);
    ancoraRef.current = alvo.id;
    // Com a lista virtualizada, o item pode não estar no DOM — usa o
    // scrollToIndex do virtualizer. O índice é o da lista PLANA (linhas),
    // que difere de `filtrada` quando há headers de grupo (#30).
    const vi = linhas.findIndex((l) => l.tipo === "msg" && l.m.id === alvo.id);
    if (vi >= 0) virtualizer.scrollToIndex(vi);
  };

  // Handler CENTRAL de atalhos (#28) — instalado no `window` via `useAtalhos`
  // (funciona mesmo sem a lista focada; antes o ESC/Ctrl+A/setas exigiam foco
  // no container). Respeita foco em campos de texto (`isTypingTarget`) e a
  // reserva do zoom do leitor (#76): NÃO captura Ctrl +/−/0.
  function aoTeclar(e: KeyboardEvent) {
    // #76: faixa do zoom do leitor é intocável aqui.
    if (ehModPrincipal(e) && ["+", "-", "=", "_", "0"].includes(e.key)) return;

    const digitando = isTypingTarget(e.target);

    // Ctrl/⌘+A: seleciona TUDO — inclusive sem nada selecionado antes (AC #28).
    // Em campo de texto, deixa o Ctrl+A nativo (selecionar o texto) passar.
    if (ehModPrincipal(e) && e.key.toLowerCase() === "a" && !e.shiftKey && !e.altKey) {
      if (digitando) return;
      if (idsFiltrados.length === 0) return;
      e.preventDefault();
      setSelecionados(new Set(idsFiltrados));
      return;
    }

    // "?" abre a ajuda dos atalhos (funciona mesmo sem lista); demais atalhos
    // de tecla única não disparam enquanto o usuário digita.
    if (e.key === "?" && !digitando) {
      e.preventDefault();
      setAjudaAberta((v) => !v);
      return;
    }
    if (digitando) return;

    // Esc unificado: fecha ajuda → limpa seleção → limpa busca.
    if (e.key === "Escape") {
      if (ajudaAberta) {
        setAjudaAberta(false);
        return;
      }
      if (selecionados.size > 0) {
        e.preventDefault();
        setSelecionados(new Set());
        ancoraRef.current = null;
        return;
      }
      if (busca) {
        e.preventDefault();
        limparBusca();
      }
      return;
    }

    // "/" foca a busca.
    if (e.key === "/") {
      e.preventDefault();
      buscaRef.current?.focus();
      return;
    }

    // "c" compõe nova mensagem (ação do pai).
    if (e.key.toLowerCase() === "c" && !ehModPrincipal(e) && !e.altKey) {
      e.preventDefault();
      onCompor();
      return;
    }

    if (filtrada.length === 0) return;
    const idxAtivo = filtrada.findIndex((m) => m.id === sel);

    // Navegação: ↑/↓ e j/k (MailVault).
    const desce = e.key === "ArrowDown" || e.key === "j";
    const sobe = e.key === "ArrowUp" || e.key === "k";
    if (desce || sobe) {
      e.preventDefault();
      const prox =
        idxAtivo === -1
          ? 0
          : desce
            ? Math.min(filtrada.length - 1, idxAtivo + 1)
            : Math.max(0, idxAtivo - 1);
      irPara(prox);
      return;
    }

    // Ações que dependem de UMA mensagem ativa (ou da seleção, no excluir).
    const ativoId = sel ?? (idxAtivo >= 0 ? filtrada[idxAtivo].id : null);
    const msgAtiva = ativoId ? filtrada.find((m) => m.id === ativoId) : undefined;

    // Delete exclui a seleção (se houver) ou a ativa.
    if (e.key === "Delete") {
      const alvos = selecionados.size > 0 ? [...selecionados] : ativoId ? [ativoId] : [];
      if (alvos.length > 0) {
        e.preventDefault();
        onExcluir(alvos);
        // acaoExcluir não limpa mais a seleção (pro BotaoExcluir animar antes de
        // desmontar); no atalho, limpamos aqui.
        setSelecionados(new Set());
        ancoraRef.current = null;
      }
      return;
    }

    // Atalhos de tecla única sem modificadores.
    if (ehModPrincipal(e) || e.altKey || e.shiftKey) return;
    switch (e.key.toLowerCase()) {
      case "r": // responder
        e.preventDefault();
        onResponder();
        return;
      case "a": // responder a todos
        e.preventDefault();
        onResponderTodos();
        return;
      case "f": // encaminhar
        e.preventDefault();
        onEncaminhar();
        return;
      case "x": // marcar/desmarcar a mensagem ativa
        if (ativoId) {
          e.preventDefault();
          alternarSel(ativoId);
          ancoraRef.current = ativoId;
        }
        return;
      case "u": // alterna lido/não-lido
        if (msgAtiva) {
          e.preventDefault();
          onMarcarLido(msgAtiva.id, !msgAtiva.lido);
        }
        return;
      case "s": // alterna sinalizado
        if (msgAtiva) {
          e.preventDefault();
          onFlag(msgAtiva.id, !msgAtiva.sinalizado);
        }
        return;
    }
  }
  useAtalhos(aoTeclar);

  // Clique na linha (#28): Shift+clique seleciona o INTERVALO entre a âncora e
  // o item clicado (sobre a ordem de exibição `idsFiltrados`, ignorando headers
  // de grupo); Ctrl/⌘+clique alterna; clique simples abre e vira a nova âncora.
  const aoClicarLinha = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey) {
      const ancora = ancoraRef.current;
      if (ancora && ancora !== id) {
        const i = idsExibidos.indexOf(ancora);
        const j = idsExibidos.indexOf(id);
        if (i >= 0 && j >= 0) {
          e.preventDefault();
          const [lo, hi] = i < j ? [i, j] : [j, i];
          const faixa = idsExibidos.slice(lo, hi + 1);
          setSelecionados((s) => {
            const n = new Set(s);
            for (const x of faixa) n.add(x);
            return n;
          });
          return;
        }
      }
      // Sem âncora válida → comporta como clique simples (fixa a âncora).
    }
    if (e.ctrlKey || e.metaKey) {
      alternarSel(id);
      ancoraRef.current = id;
      return;
    }
    onSel(id);
    ancoraRef.current = id;
  };

  // #82: com agrupamento (#30) + grupos colapsados, a lista pode ficar mais
  // CURTA que a área visível — e aí não dá pra rolar até os 90% que disparam o
  // carregar-mais, então os grupos ficam incompletos (o "buraco" entre períodos).
  // Este efeito carrega páginas até o conteúdo encher o viewport (ou acabar
  // `temMais`).
  //
  // ⚠️ REWORK (rejeição do PO: "Flagged some quando todos os grupos estão
  // colapsados"): a versão anterior só olhava a ALTURA. Com todos os grupos
  // colapsados a lista fica presa em ~10 linhas de header — altura que nunca
  // enche o viewport — então o efeito repaginava a pasta INTEIRA, página atrás
  // de página, sem nada mudar na tela. Cada página remontava `linhas`/o
  // virtualizer e a lista piscava/perdia as primeiras linhas (o header
  // "Flagged", que é a linha 0). Agora o efeito exige PROGRESSO: se o auto-load
  // anterior não aumentou o número de linhas de MENSAGEM visíveis (páginas
  // caindo todas dentro de grupos colapsados), ele para. Rolar ou abrir/fechar
  // um grupo libera de novo (`autoPreencheuRef = null`), então "grupo colapsado
  // não trava a carga" continua valendo.
  const linhasMsg = useMemo(
    () => linhas.reduce((n, l) => n + (l.tipo === "msg" ? 1 : 0), 0),
    [linhas]
  );
  useEffect(() => {
    const el = listaRef.current;
    if (!el || carregandoMais || !temMais) return;
    // +8 de folga (padding/borda). Se o conteúdo passa da área visível, o
    // gatilho de scroll (90%) já dá conta — solta o trava do auto-preenchimento.
    if (el.scrollHeight > el.clientHeight + 8) {
      autoPreencheuRef.current = null;
      return;
    }
    // Sem progresso desde o último auto-load → para (senão baixa a pasta toda).
    if (autoPreencheuRef.current !== null && linhasMsg <= autoPreencheuRef.current) return;
    autoPreencheuRef.current = linhasMsg;
    onCarregarMais();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas.length, linhasMsg, temMais, carregandoMais, colapsadosArr]);

  // #82: colapsar grupos ENCOLHE muito a lista virtual (de milhares de px para
  // ~10 linhas de header). Se o scroll estava além do novo fim, o browser prende
  // o `scrollTop` no máximo mas o virtualizer segue com o offset antigo e passa a
  // renderizar uma faixa de índices que não existe mais — some justamente o topo
  // da lista, onde fica o header "Flagged" (linha 0). Reancorar o virtualizer no
  // offset válido sempre que a lista encolhe garante o AC "Flagged aparece acima
  // de todos" mesmo com todos os grupos colapsados.
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    const max = Math.max(0, virtualizer.getTotalSize() - el.clientHeight);
    if (el.scrollTop > max) virtualizer.scrollToOffset(max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas.length, colapsadosArr]);

  const idsFiltrados = filtrada.map((m) => m.id);
  // Ordem de EXIBIÇÃO das mensagens (respeita agrupamento/Flagged-no-topo e
  // ignora headers e grupos colapsados): é o que o Shift+clique usa como
  // "itens compreendidos entre" — o intervalo segue o que o usuário vê (#28).
  const idsExibidos = useMemo(
    () => linhas.flatMap((l) => (l.tipo === "msg" ? [l.m.id] : [])),
    [linhas]
  );
  const todosSel = idsFiltrados.length > 0 && idsFiltrados.every((id) => selecionados.has(id));
  // Em "modo seleção" (≥1 marcado): checkboxes sempre visíveis e as ações de
  // hover por linha somem — o usuário opera pela barra de seleção (#23).
  const haSelecao = selecionados.size > 0;
  // Em Itens Excluídos o "Excluir" já é DEFINITIVO (acaoExcluir é folder-aware).
  const excluirPermanente = pastaTipo === "deleteditems";
  // Mensagens da seleção: alimentam o menu de contexto da ÁREA da lista (botão
  // direito fora das linhas). Estado comum = "todas lidas/sinalizadas?", que
  // define o rótulo e o valor novo aplicado ao lote.
  const msgsSelecionadas = useMemo(
    () => (mensagens ?? []).filter((m) => selecionados.has(m.id)),
    [mensagens, selecionados]
  );
  const selTodasLidas =
    msgsSelecionadas.length > 0 && msgsSelecionadas.every((m) => m.lido);
  const selTodasSinalizadas =
    msgsSelecionadas.length > 0 && msgsSelecionadas.every((m) => m.sinalizado);

  // Rótulos das opções de ordenação (chave → string i18n) (#32).
  const rotuloOrdena: Record<api.OrdenarMensagens, string> = {
    data: t.controlRoom.ordenaData,
    remetente: t.controlRoom.ordenaRemetente,
    assunto: t.controlRoom.ordenaAssunto,
  };

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-3 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label={t.nav.alternarMenu}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5" aria-label={t.controlRoom.ordenarPor}>
                <ArrowDownUp className="size-3.5" />
                <span className="hidden text-xs sm:inline">{rotuloOrdena[ordenar]}</span>
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>{t.controlRoom.ordenarPor}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={ordenar}
                onValueChange={(v) => onOrdenar(v as api.OrdenarMensagens, ordemDesc)}
              >
                {(["data", "remetente", "assunto"] as const).map((o) => (
                  <DropdownMenuRadioItem key={o} value={o}>
                    {rotuloOrdena[o]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={ordemDesc ? "desc" : "asc"}
                onValueChange={(v) => onOrdenar(ordenar, v === "desc")}
              >
                <DropdownMenuRadioItem value="desc">
                  {t.controlRoom.ordemDecrescente}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="asc">
                  {t.controlRoom.ordemCrescente}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Preferências de LEITURA (#95): quando a mensagem aberta vira lida.
              Mora aqui, no cluster de preferências do cabeçalho da lista, pelo
              mesmo motivo da ordenação: é chrome permanente (a toolbar do leitor
              só existe com mensagem aberta) e evita um segundo lugar de
              preferências no Bridge. Mesmo padrão visual do menu vizinho
              (Label + RadioGroup); trigger só-ícone como o refresh, e NÃO a
              engrenagem `Settings` — essa já significa "tela Configurações" do
              Toolbox no sidebar.
              As opções são uma escala única (ao abrir → 2s → 5s → 10s) em vez de
              "modo + atraso" em dois controles: sem UI condicional, sem estado
              escondido, e o RadioGroup do Radix já dá role/aria + setas. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t.controlRoom.prefLeitura}>
                <SlidersHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t.controlRoom.prefMarcarLidoTitulo}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={
                  marcarLidoModo === "atraso"
                    ? `atraso:${marcarLidoAtraso}`
                    : marcarLidoModo
                }
                onValueChange={(v) => {
                  if (v.startsWith("atraso:")) {
                    onMarcarLidoAtraso(Number(v.slice("atraso:".length)));
                    onMarcarLidoModo("atraso");
                  } else {
                    onMarcarLidoModo(v as MarcarLidoModo);
                  }
                }}
              >
                <DropdownMenuRadioItem value="imediato">
                  {t.controlRoom.prefMarcarLidoImediato}
                </DropdownMenuRadioItem>
                {MARCAR_LIDO_ATRASOS.map((s) => (
                  <DropdownMenuRadioItem key={s} value={`atraso:${s}`}>
                    {preencher(t.controlRoom.prefMarcarLidoAtraso, { n: s })}
                  </DropdownMenuRadioItem>
                ))}
                {/* "Manualmente" não é um ponto da escala de tempo: é desligar
                    o automatismo. Daí o separador. */}
                <DropdownMenuSeparator />
                <DropdownMenuRadioItem value="manual">
                  {t.controlRoom.prefMarcarLidoManual}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label={t.controlRoom.atualizar}>
            <RefreshCw />
          </Button>
        </div>
      </div>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={buscaRef}
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
        <div className="flex items-start gap-2.5 px-3 pb-2">
          {/* Filtro da lista (#31) com o @reui/filters — variante RADIX,
              instalada do registry (`@reui/filters` em style `radix-nova`) e
              usada literal, como FILTER-BUILDER multi-campo. Montagem espelha o
              exemplo canônico do reui (`Pattern()` do c-filters-5): trigger
              `<Button variant="outline"><ListFilter/> Filtro>` com atalho "F",
              campos agrupados (Básico/Seleção), e um botão "Limpar" separado
              que aparece só quando há filtro ativo. O gatilho abre a lista de
              campos direto (De, Status, Sinalizado, Anexos, Escopo); cada um
              vira um chip `campo · operador · valor`, combináveis com E
              (`allowMultiple`). Sem `size="sm"` → os inputs seguem o `h-9`
              padrão do app (bug de altura do input de texto, reprovado antes).
              `onChange` recebe o array completo → persistido no pai. */}
          <Filters<string>
            filters={filtros}
            fields={filtroCampos}
            onChange={onFiltros}
            enableShortcut
            shortcutKey="f"
            shortcutLabel="F"
            trigger={
              <Button variant="outline">
                <ListFilter />
                {t.controlRoom.filtroLabel}
              </Button>
            }
            i18n={{
              addFilter: t.controlRoom.filtroLabel,
              searchFields: t.controlRoom.filtroBuscarCampo,
              select: t.controlRoom.filtroSelecione,
            }}
          />
          {filtros.length > 0 && (
            <Button variant="outline" onClick={() => onFiltros([])}>
              <FunnelX />
              {t.controlRoom.filtroLimpar}
            </Button>
          )}
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
        // Menu de contexto da ÁREA da lista: o botão direito FORA das linhas
        // (espaço vazio abaixo da última mensagem, cabeçalho de grupo) também
        // precisa responder — em pastas curtas como Itens Excluídos/Lixo
        // Eletrônico boa parte do painel é área vazia e o usuário nunca acerta
        // uma linha (#86). Age sobre a SELEÇÃO; sem seleção não há alvo, então
        // o trigger fica desabilitado (nada abre, nem menu vazio).
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={!haSelecao}>
        <div
          ref={listaRef}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto scrollbar-fina outline-none"
          onScroll={(e) => {
            // Pré-carga antecipada: ao passar de 90% da lista já busca a próxima
            // página, pra sempre haver buffer à frente (não espera bater no fim).
            const el = e.currentTarget;
            // rolar = interação do usuário: libera o auto-preenchimento (#82)
            autoPreencheuRef.current = null;
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
                const linha = linhas[vr.index];
                if (!linha) return null;
                // Cabeçalho de grupo (Flagged / período) como linha virtual (#30).
                if (linha.tipo === "grupo") {
                  const colapsado = colapsados.has(linha.chave);
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
                        transform: `translateY(${vr.start}px)`,
                      }}
                    >
                      {/* Cabeçalho de grupo = @reui/c-collapsible-6 LITERAL
                          (`pnpm dlx shadcn@latest add @reui/c-collapsible-6`,
                          style `radix-nova`): Frame > Collapsible >
                          CollapsibleTrigger > FrameHeader > FrameTitle +
                          chevron com `in-data-[state=open]:rotate-90`, na mesma
                          composição do bloco instalado em
                          `src/components/examples/c-collapsible-6.tsx` (#30).

                          Duas adaptações, obrigatórias por ser LINHA de lista
                          virtualizada e não card solto:
                          1. `variant="ghost"` + `bg-transparent`: o Frame é um
                             card (borda + fundo); numa linha de lista ele viraria
                             uma caixa por grupo. Ghost tira a borda e o fundo, o
                             componente continua sendo o do registry.
                          2. Sem `CollapsibleContent`/`FramePanel`: o conteúdo do
                             grupo são as MENSAGENS, que são outras linhas
                             virtuais do react-virtual — o colapso emite/omite
                             essas linhas via `colapsados`, não desmontando um
                             painel (senão a virtualização quebra). */}
                      <Frame
                        dense
                        spacing="sm"
                        variant="ghost"
                        className="w-full bg-transparent"
                      >
                        <Collapsible
                          open={!colapsado}
                          onOpenChange={() => alternarColapso(linha.chave)}
                        >
                          <CollapsibleTrigger className="flex w-full">
                            <FrameHeader className="flex grow flex-row items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground">
                              <ChevronRight
                                aria-hidden="true"
                                className="size-3.5 shrink-0 transition-transform in-data-[state=open]:rotate-90"
                              />
                              {linha.chave === "flagged" && (
                                <Flag className="size-3 shrink-0 fill-red-500 text-red-500" />
                              )}
                              <FrameTitle className="text-xs font-semibold uppercase tracking-wide">
                                {linha.rotulo}
                              </FrameTitle>
                              <span className="font-normal opacity-70">{linha.n}</span>
                            </FrameHeader>
                          </CollapsibleTrigger>
                        </Collapsible>
                      </Frame>
                    </div>
                  );
                }
                const m = linha.m;
                const ativo = m.id === sel;
                const marcado = selecionados.has(m.id);
                // Foto do remetente interno (#39); ausente → iniciais.
                const foto = m.foto ?? getFoto(m.deEmail);
                // Ações do menu de contexto valem para a seleção quando o item
                // clicado faz parte dela; senão, só para o próprio item (#86).
                const alvos =
                  selecionados.has(m.id) && selecionados.size > 0
                    ? [...selecionados]
                    : [m.id];
                return (
                  <div
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    // O menu da LINHA e o menu da ÁREA são dois triggers do
                    // Radix aninhados e o trigger não interrompe a propagação:
                    // sem isso o clique na linha abriria os DOIS. A linha tem
                    // prioridade (alvo mais específico).
                    onContextMenu={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      paddingBottom: 2,
                      transform: `translateY(${vr.start}px)`,
                    }}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                    <Item
                      size="sm"
                      data-msgid={m.id}
                      onClick={(e) => aoClicarLinha(e, m.id)}
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
                          {foto && <AvatarImage src={foto} alt="" />}
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
                            <Flag
                              className={cn(
                                "size-3.5 shrink-0 fill-red-500 text-red-500",
                                // No hover as ações (incl. o botão de flag) entram
                                // no slot da data; esconder o indicador persistente
                                // evita a flag DUPLICADA (#63). Em modo seleção não
                                // há ações, então o indicador permanece.
                                !haSelecao && "group-hover/row:hidden"
                              )}
                            />
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
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-56">
                        <ItensMenuEmail
                          alvos={alvos}
                          lido={m.lido}
                          sinalizado={m.sinalizado}
                          permanente={excluirPermanente}
                          onMarcarLido={onMarcarLido}
                          onFlag={onFlag}
                          onExcluir={onExcluir}
                          pastasDestino={pastasDestino}
                          pastasCarregando={pastasCarregando}
                          onAbrirMover={onAbrirMover}
                          onMover={onMover}
                          setSelecionados={setSelecionados}
                          t={t}
                        />
                      </ContextMenuContent>
                    </ContextMenu>
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
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ItensMenuEmail
              alvos={[...selecionados]}
              lido={selTodasLidas}
              sinalizado={selTodasSinalizadas}
              permanente={excluirPermanente}
              onMarcarLido={onMarcarLido}
              onFlag={onFlag}
              onExcluir={onExcluir}
              pastasDestino={pastasDestino}
              pastasCarregando={pastasCarregando}
              onAbrirMover={onAbrirMover}
              onMover={onMover}
              setSelecionados={setSelecionados}
              t={t}
            />
          </ContextMenuContent>
        </ContextMenu>
      )}

      {/* Ajuda dos atalhos ("?") — documentação viva do keymap (#28). */}
      <AtalhosAjuda aberto={ajudaAberta} onOpenChange={setAjudaAberta} t={t} />
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

// --- Insights do remetente (#94) --------------------------------------------
// Popover acionado por CLIQUE no nome do remetente (padrão Gmail/Outlook: o
// contact-card mora atrás do identificador da pessoa). Escolhido por ser o
// MENOS INTRUSIVO — insights são secundários e não podem competir com o corpo
// nem roubar espaço permanente do leitor (um painel fixo faria isso). A busca é
// LAZY: só dispara ao abrir o popover, não ao abrir o e-mail — poupa as ~4
// chamadas Graph quando o usuário não pede. Estados: skeleton (carregando),
// "primeiro contato" (vazio, positivo), e erro discreto com "tentar de novo"
// (nunca derruba o leitor). Decisão embasada em pesquisa de UX (AGENTS §3.1).

/** Data curta ("12 mar 2023") ciente do idioma. */
function dataCurta(iso: string, idioma: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(idioma, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Recência relativa ("há 3 dias", "hoje") via Intl.RelativeTimeFormat. */
function recencia(iso: string, idioma: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  const dias = Math.round((Date.now() - d.getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(idioma, { numeric: "auto" });
  if (dias <= 0) return rtf.format(0, "day");
  if (dias < 45) return rtf.format(-dias, "day");
  const meses = Math.round(dias / 30);
  if (meses < 18) return rtf.format(-meses, "month");
  return rtf.format(-Math.round(dias / 365), "year");
}

/** Frequência aproximada de e-mails/mês, do 1º contato até o último. */
function porMes(total: number, primeiro?: string | null, ultimo?: string | null): number {
  if (!primeiro || total <= 0) return 0;
  const ini = new Date(comZ(primeiro)).getTime();
  const fim = ultimo ? new Date(comZ(ultimo)).getTime() : Date.now();
  const meses = Math.max(1, (fim - ini) / (30 * 86_400_000));
  return Math.max(1, Math.round(total / meses));
}

function InsightsRemetentePopover({
  nome,
  email,
  t,
  idioma,
}: {
  nome: string;
  email: string;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<"idle" | "carregando" | "ok" | "erro">("idle");
  const [dados, setDados] = useState<InsightsRemetente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  // E-mail (+ tentativa) já solicitado — evita refetch a cada reabertura mas
  // permite o "tentar de novo". NÃO metemos `estado` nas deps do efeito de
  // busca: como o efeito seta `estado`, isso faria a limpeza cancelar a própria
  // chamada em voo (ficava preso no skeleton).
  const pedidoRef = useRef<string | null>(null);

  // Troca de remetente → esquece o cache e fecha.
  useEffect(() => {
    pedidoRef.current = null;
    setEstado("idle");
    setDados(null);
    setAberto(false);
  }, [email]);

  // Busca lazy: só quando o popover abre (ou o usuário pede "tentar de novo").
  useEffect(() => {
    if (!aberto || !email) return;
    const chave = `${email}#${tentativa}`;
    if (pedidoRef.current === chave) return; // já buscado neste e-mail/tentativa
    pedidoRef.current = chave;
    let vivo = true;
    setEstado("carregando");
    api
      .crInsightsRemetente(email)
      .then((d) => {
        if (!vivo) return;
        setDados(d);
        setEstado("ok");
      })
      .catch(() => {
        if (vivo) setEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [aberto, email, tentativa]);

  const rec = dados?.recebidos ?? 0;
  const env = dados?.enviados;
  const total = rec + (env ?? 0);
  const vazio =
    estado === "ok" && rec === 0 && (env == null || env === 0) && !dados?.primeiro;

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        // Fechou no meio do carregamento → permite refazer ao reabrir.
        if (!o && estado === "carregando") {
          pedidoRef.current = null;
          setEstado("idle");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={preencher(t.controlRoom.insightsAbrir, { nome })}
          aria-haspopup="dialog"
        >
          <span className="underline-offset-2 group-hover:underline">{nome}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80" aria-live="polite">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          {t.controlRoom.insightsTitulo}
        </p>

        {estado === "carregando" && (
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}

        {estado === "erro" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t.controlRoom.insightsErro}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTentativa((n) => n + 1)}
            >
              <RefreshCw /> {t.controlRoom.insightsTentar}
            </Button>
          </div>
        )}

        {estado === "ok" && vazio && (
          <p className="text-sm text-muted-foreground">
            {t.controlRoom.insightsPrimeiroContato}
          </p>
        )}

        {estado === "ok" && !vazio && dados && (
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t.controlRoom.insightsRecebidos}</dt>
              <dd className="font-medium tabular-nums">{rec}</dd>
            </div>
            {env != null && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t.controlRoom.insightsEnviados}</dt>
                <dd className="font-medium tabular-nums">{env}</dd>
              </div>
            )}
            {dados.primeiro && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t.controlRoom.insightsPrimeiro}</dt>
                <dd className="font-medium">{dataCurta(dados.primeiro, idioma)}</dd>
              </div>
            )}
            {dados.ultimo && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t.controlRoom.insightsUltimo}</dt>
                <dd className="font-medium">{recencia(dados.ultimo, idioma)}</dd>
              </div>
            )}
            {porMes(total, dados.primeiro, dados.ultimo) > 0 && (
              <>
                <Separator className="my-1" />
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t.controlRoom.insightsFrequencia}</dt>
                  <dd className="font-medium tabular-nums">
                    {preencher(t.controlRoom.insightsPorMes, {
                      n: porMes(total, dados.primeiro, dados.ultimo),
                    })}
                  </dd>
                </div>
              </>
            )}
          </dl>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Badge de autenticação do remetente (#91, parte b). Cor/ícone conforme o
 * veredito SPF/DKIM/DMARC; o tooltip detalha cada mecanismo. Verde = autenticado,
 * amarelo = parcial, vermelho = falha, cinza = sem dados.
 */
function BadgeAutenticacao({
  nivel,
  resultado,
  t,
}: {
  nivel: NivelAutenticacao;
  resultado: ResultadoAutenticacao;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const cfg = {
    autenticado: {
      variant: "success-light" as const,
      Icone: ShieldCheck,
      rotulo: t.controlRoom.segAutAutenticado,
      dica: t.controlRoom.segAutTooltipAutenticado,
    },
    parcial: {
      variant: "warning-light" as const,
      Icone: ShieldAlert,
      rotulo: t.controlRoom.segAutParcial,
      dica: t.controlRoom.segAutTooltipParcial,
    },
    falhou: {
      variant: "destructive-light" as const,
      Icone: ShieldX,
      rotulo: t.controlRoom.segAutFalhou,
      dica: t.controlRoom.segAutTooltipFalhou,
    },
    indisponivel: {
      variant: "secondary" as const,
      Icone: Shield,
      rotulo: t.controlRoom.segAutIndisponivel,
      dica: t.controlRoom.segAutTooltipIndisponivel,
    },
  }[nivel];
  const est = (v: string | null) => (v ?? "—");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <Badge variant={cfg.variant} size="sm" className="shrink-0 gap-1">
              <cfg.Icone />
              {cfg.rotulo}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{cfg.dica}</p>
          <p className="mt-1 font-mono text-[0.65rem] opacity-80">
            SPF: {est(resultado.spf)} · DKIM: {est(resultado.dkim)} · DMARC:{" "}
            {est(resultado.dmarc)}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Handle imperativo do leitor (#28): os atalhos r/a/f abrem o Sheet de resposta
// chamando estas funções — a UI de reply/forward já existe, só ligamos a tecla.
export interface MessageDetailHandle {
  responder: () => void;
  responderTodos: () => void;
  encaminhar: () => void;
}

const MessageDetail = forwardRef<
  MessageDetailHandle,
  {
    id: string | null;
    userEmail?: string | null;
    sinalizado: boolean;
    lido: boolean;
    onFlag: (id: string, novo: boolean) => void;
    onExcluir: (ids: string[]) => void;
    onMarcarLido: (id: string, lido: boolean) => void;
    onAbrirLink: (url: string) => void;
    onMudou: () => void;
    t: ReturnType<typeof useIdioma>["t"];
    idioma: string;
  }
>(function MessageDetail(
  {
    id,
    userEmail,
    sinalizado,
    lido,
    onFlag,
    onExcluir,
    onMarcarLido,
    onAbrirLink,
    onMudou,
    t,
    idioma,
  },
  ref
) {
  const [det, setDet] = useState<EmailDetalhe | null>(null);
  // Segurança do leitor (#91): Reply-To + headers de autenticação. Best-effort,
  // carregado à parte do corpo pra não atrasar a leitura.
  const [seg, setSeg] = useState<SegurancaEmail | null>(null);
  const [modo, setModo] = useState<null | "responder" | "responderTodos" | "encaminhar">(null);
  const [enviando, setEnviando] = useState(false);
  const comporRef = useRef<ComporMensagemHandle>(null);
  // Avatar do remetente interno (#39).
  const { getFoto, pedirFotos } = useFotos();

  // Atalhos r/a/f: só fazem sentido com uma mensagem aberta (`id`). Abrir o
  // Sheet reusa exatamente o mesmo `setModo` dos botões da toolbar.
  useImperativeHandle(
    ref,
    () => ({
      responder: () => id && setModo("responder"),
      responderTodos: () => id && setModo("responderTodos"),
      encaminhar: () => id && setModo("encaminhar"),
    }),
    [id]
  );

  useEffect(() => {
    if (!id) {
      setDet(null);
      setSeg(null);
      return;
    }
    let vivo = true;
    setDet(null);
    setSeg(null);
    setModo(null);
    api.crEmailCorpo(id).then((d) => vivo && setDet(d)).catch(() => {});
    // Segurança (#91) em paralelo; falha silenciosa (badge some, sem quebrar).
    api.crEmailSeguranca(id).then((s) => vivo && setSeg(s)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, [id]);

  // Deriva veredito de autenticação (SPF/DKIM/DMARC) e divergência de Reply-To
  // a partir dos headers brutos — lógica pura, testada em seguranca-leitor.ts.
  const auth = useMemo(
    () => (seg ? parseAuthResults(seg.autenticacao, seg.receivedSpf) : null),
    [seg],
  );
  const nivelAuth = useMemo(() => (auth ? nivelAutenticacao(auth) : null), [auth]);
  const divergencia = useMemo(
    () => (seg && det ? replyToDivergente(det.deEmail, seg.replyTo) : null),
    [seg, det],
  );

  // Pede a foto do remetente quando o detalhe carrega.
  useEffect(() => {
    if (det?.deEmail) pedirFotos([det.deEmail]);
  }, [det?.deEmail, pedirFotos]);

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
          {/* Botão de lido/não-lido: ALTERNA (#95). Antes era só "marcar como
              não lido" — o que bastava quando o app marcava lido sozinho ao
              abrir. Nos modos "após atraso"/"manual" a mensagem pode continuar
              não-lida no leitor, então o botão precisa marcar LIDO também. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => id && onMarcarLido(id, !lido)}
            aria-label={lido ? t.controlRoom.marcarNaoLido : t.controlRoom.marcarLido}
            title={lido ? t.controlRoom.marcarNaoLido : t.controlRoom.marcarLido}
          >
            {lido ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
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
          <Button variant="ghost" size="icon-sm" onClick={abrirOutlook} aria-label={t.controlRoom.abrirOutlook}>
            <ExternalLink />
          </Button>
        </div>
      </div>

      {/* Cabeçalho do e-mail */}
      <div className="border-b px-5 py-4">
        <h1 className="text-base font-semibold">{det.assunto}</h1>
        <div className="mt-3 flex items-start gap-3">
          <Avatar>
            {getFoto(det.deEmail) && (
              <AvatarImage src={getFoto(det.deEmail)!} alt="" />
            )}
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
              {det.deEmail ? (
                <InsightsRemetentePopover
                  nome={det.de}
                  email={det.deEmail}
                  t={t}
                  idioma={idioma}
                />
              ) : (
                <span className="text-sm font-medium">{det.de}</span>
              )}
              {det.deEmail && (
                <span className="truncate text-xs text-muted-foreground">&lt;{det.deEmail}&gt;</span>
              )}
              {/* Badge de autenticação do remetente (#91, parte b). */}
              {nivelAuth && auth && (
                <BadgeAutenticacao nivel={nivelAuth} resultado={auth} t={t} />
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
        {/* Alerta de Reply-To divergente (#91, parte c) — discreto, abaixo do
            cabeçalho, só quando as respostas iriam para outro endereço. */}
        {divergencia?.divergente && (
          <Alert variant="warning" className="mt-3">
            <TriangleAlert />
            <AlertTitle>{t.controlRoom.segReplyToTitulo}</AlertTitle>
            <AlertDescription>
              {preencher(t.controlRoom.segReplyToDescricao, {
                enderecos: divergencia.enderecos.join(", "),
                de: det.deEmail,
              })}
            </AlertDescription>
          </Alert>
        )}
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
});

// ===========================================================================
// Painel 4 — calendário + agenda do dia (schedule-8)
// ===========================================================================

function AgendaConteudo({
  onEvento,
  t,
  idioma,
}: {
  onEvento: (id: string) => void;
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
      {/* Só o título — o toggle de visibilidade agora é o item do sidebar (#50). */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{t.controlRoom.agendaTitulo}</span>
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
  // Avatares dos participantes internos (#39).
  const { getFoto, pedirFotos } = useFotos();

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

  // Pede as fotos dos participantes quando o detalhe carrega.
  useEffect(() => {
    if (det?.participantes.length) pedirFotos(det.participantes.map((p) => p.email));
  }, [det, pedirFotos]);

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
                    {det.participantes.map((p) => {
                      const foto = p.foto ?? getFoto(p.email);
                      return (
                        <div
                          key={p.email || p.nome}
                          className="flex items-center gap-2 rounded-full bg-muted/60 py-1 pr-3 pl-1"
                        >
                          <Avatar size="sm">
                            {foto && <AvatarImage src={foto} alt="" />}
                            <AvatarFallback>{p.iniciais}</AvatarFallback>
                          </Avatar>
                          <span className="text-xs">{p.nome}</span>
                        </div>
                      );
                    })}
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
  // Fotos de contatos (#39): só buscamos avatar de remetente do MESMO domínio do
  // tenant (o do usuário logado). Configura o domínio do cache aqui.
  useEffect(() => {
    configurarDominioFotos(user.email);
  }, [user.email]);
  // Visibilidade do card da Agenda — controlada pelo item no RODAPÉ do sidebar
  // de pastas do Bridge (a Agenda pertence ao Bridge, não ao app principal).
  // Nasce FECHADA (chave nova, reseta persistidos antigos) pra fazer menos
  // requisições no startup — só carrega quando o usuário abre (#50).
  const [agendaAberta, setAgendaAberta] = usePersistedState("bridge.agendaVisivel", false);
  const [pastas, setPastas] = useState<PastaEmail[] | null>(null);
  const [pastaSel, setPastaSel] = useState("inbox");
  // Coalescing da troca de pasta (#87): a SELEÇÃO (`pastaSel`) muda na hora — o
  // sidebar já destaca a pasta clicada e o cabeçalho troca de nome —, mas as
  // CARGAS de rede (mensagens + contadores) seguem `pastaCarga`, a versão
  // debounced. Clicar 5 pastas em 1s NÃO dispara 5 cargas: só a pasta em que o
  // usuário parou é buscada. Debounce curto (180ms) pra não pesar ao navegar
  // rápido sem atrasar perceptivelmente uma troca isolada.
  const DEBOUNCE_PASTA_MS = 180;
  const pastaCarga = useDebounce(pastaSel, DEBOUNCE_PASTA_MS);
  const [mensagens, setMensagens] = useState<EmailItem[] | null>(null);
  const [msgSel, setMsgSel] = useState<string | null>(null);
  const [eventoSel, setEventoSel] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  // recargaPastas atualiza SÓ as contagens do sidebar, sem recarregar a lista
  // (ações como excluir/responder não devem zerar o lazy load nem o scroll).
  const [recargaPastas, setRecargaPastas] = useState(0);
  // Colapsos persistem (o app guarda o estado que o usuário deixa).
  const [sidebarAberta, setSidebarAberta] = usePersistedState("bridge.sidebar", true);
  // Ordenação da lista (persistida): campo + direção → $orderby no Graph (#32).
  const [ordenar, setOrdenar] = usePersistedState<api.OrdenarMensagens>(
    "bridge.ordenar",
    "data"
  );
  const [ordemDesc, setOrdemDesc] = usePersistedState("bridge.ordemDesc", true);
  // Migração: sorts removidos do escopo (tamanho/importancia/flag — #60) que
  // ficaram no localStorage voltam pra "data", evitando estado inconsistente.
  useEffect(() => {
    if (!["data", "remetente", "assunto"].includes(ordenar as string)) setOrdenar("data");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Preferência de "marcar como lido" (#95), persistida: o app sempre guarda o
  // estado que o usuário deixa. Default = "imediato" (comportamento histórico).
  const [marcarLidoModo, setMarcarLidoModo] = usePersistedState<MarcarLidoModo>(
    "bridge.marcarLidoModo",
    "imediato"
  );
  const [marcarLidoAtraso, setMarcarLidoAtraso] = usePersistedState<number>(
    "bridge.marcarLidoAtraso",
    MARCAR_LIDO_ATRASO_PADRAO
  );
  // localStorage é editável por fora (e pode ter sobra de versões antigas):
  // valor inválido volta ao padrão em vez de virar um timer NaN/eterno.
  useEffect(() => {
    if (!MARCAR_LIDO_MODOS.includes(marcarLidoModo)) setMarcarLidoModo("imediato");
    if (!MARCAR_LIDO_ATRASOS.includes(marcarLidoAtraso as (typeof MARCAR_LIDO_ATRASOS)[number]))
      setMarcarLidoAtraso(MARCAR_LIDO_ATRASO_PADRAO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [novaAberta, setNovaAberta] = useState(false);
  // Handle do leitor para os atalhos r/a/f (#28) abrirem o Sheet de resposta.
  const detalheRef = useRef<MessageDetailHandle>(null);
  // Busca server-side ($search do Graph): resultados vêm do servidor (inclui
  // corpo), não do filtro local sobre o carregado.
  const [busca, setBusca] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<EmailItem[] | null>(null);
  const [temMaisBusca, setTemMaisBusca] = useState(false);
  // Contadores REAIS da pasta (não só o carregado) pras abas Flagged/Files.
  const [contFlagged, setContFlagged] = useState<number | null>(null);
  const [contAnexos, setContAnexos] = useState<number | null>(null);
  // Filtro da lista (#31): dropdown Outlook-like, single-select. Persistido
  // global (D3) — sobrevive ao restart — mas resetado visualmente ao TROCAR de
  // pasta (efeito abaixo). Os 3 filtros Graph (tome/mentions/invites) buscam no
  // servidor via cr_filtrar; os 4 client-side são aplicados no MessageList.
  // Filtros do builder (#31), multi-condição (AND). Chave nova (`.v2`) porque o
  // shape mudou de string única ("all"/…) para array de `Filter` — reusar a
  // chave antiga quebraria o parse do valor persistido. Global + persistido;
  // resetado na troca de pasta (D3).
  const [filtros, setFiltros] = usePersistedState<Filter<string>[]>(
    "bridge.filtrosLista.v2",
    []
  );
  const filtroServidor = escopoDeFiltros(filtros);
  const filtroGraph = filtroServidor !== null;
  const [resultadosFiltro, setResultadosFiltro] = useState<EmailItem[] | null>(null);
  const [temMaisFiltro, setTemMaisFiltro] = useState(false);
  const proximoFiltroRef = useRef<string | null>(null);
  // D6: escopos Graph que o tenant rejeitou (400) — escondidos silenciosamente.
  const [filtrosOcultos, setFiltrosOcultos] = useState<Set<string>>(new Set());
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

  // Cache de SUBPASTAS (childFolders), compartilhado pelo sidebar (expandir) e
  // pelo submenu "Mover para pasta…" (#88). Carrega sob demanda e memoriza; o
  // ref evita pedir duas vezes a mesma pasta (o sidebar e o submenu podem pedir
  // quase ao mesmo tempo).
  const [subpastas, setSubpastas] = useState<Record<string, PastaEmail[]>>({});
  const subpastasPedidasRef = useRef<Set<string>>(new Set());
  const carregarSubpastas = useCallback((id: string) => {
    if (subpastasPedidasRef.current.has(id)) return;
    subpastasPedidasRef.current.add(id);
    api
      .crSubpastas(id)
      .then((cs) => setSubpastas((f) => ({ ...f, [id]: cs })))
      .catch(() => setSubpastas((f) => ({ ...f, [id]: [] })));
  }, []);

  // O submenu "Mover para…" precisa da árvore INTEIRA (não só do que o usuário
  // expandiu no sidebar). Ao abrir pela primeira vez, `pedirArvore` liga e este
  // efeito pede as subpastas que faltam; como ele depende de `subpastas`, cada
  // lote que chega dispara o nível seguinte — a árvore se completa sozinha, sem
  // recursão manual e sem buscar nada antes do usuário precisar.
  const [pedirArvore, setPedirArvore] = useState(false);
  const conhecidas = useMemo(
    () => [...(pastas ?? []), ...Object.values(subpastas).flat()],
    [pastas, subpastas]
  );
  // Pastas que declaram filhos (childFolderCount > 0) mas ainda não voltaram.
  const arvorePendentes = useMemo(
    () => conhecidas.filter((p) => p.filhos > 0 && subpastas[p.id] === undefined),
    [conhecidas, subpastas]
  );
  useEffect(() => {
    if (!pedirArvore) return;
    for (const p of arvorePendentes) carregarSubpastas(p.id);
  }, [pedirArvore, arvorePendentes, carregarSubpastas]);

  // Árvore achatada COMPLETA: base dos dois "mover". O de MENSAGENS (#88) tira
  // a pasta atual (mover pra onde a mensagem já está não é opção); o de PASTA
  // (#90) tira a própria pasta e as descendentes, mas isso depende de qual pasta
  // foi clicada — quem filtra é o sidebar.
  const arvorePastas = useMemo(
    () => achatarPastas(pastas ?? [], subpastas, t),
    [pastas, subpastas, t]
  );
  const pastasDestino = useMemo(
    () => arvorePastas.filter((p) => p.id !== pastaSel),
    [arvorePastas, pastaSel]
  );

  // Contadores reais das abas Flagged/Files (na pasta inteira). Só refaz na
  // TROCA de pasta / refresh manual — NÃO em cada recargaPastas (o polling do
  // delete bumpava recargaPastas e os refetch em rajada resolviam fora de ordem,
  // fazendo o count piscar 8↔15). Entre refetches, os ajustes otimistas
  // (flag/excluir) mantêm o número certo.
  //
  // Zera na troca de pasta / refresh (mostra o skeleton), mas NÃO na troca de
  // ORDENAÇÃO: reordenar recarrega a lista, não muda os contadores da pasta —
  // zerar ali só faria piscar null→n à toa. Segue `pastaCarga` (debounced): na
  // navegação rápida não pisca a cada clique, só na pasta final.
  useEffect(() => {
    setContFlagged(null);
    setContAnexos(null);
  }, [pastaCarga, recarga]);

  // #87 — foreground-first + $batch: os contadores das abas são FUNDO. Só
  // disparam DEPOIS que a lista visível carrega (`mensagens !== null`), pra carga
  // inicial gastar o pool primeiro na pasta que o usuário vê. `crContadores` junta
  // Flagged + Files num único `$batch` do Graph (1 request em vez de 2 `$count`).
  // O `contadoresKeyRef` evita refazer a chamada quando o foreground recicla por
  // OUTRA razão (troca de ordenação recarrega a lista, mas os contadores da pasta
  // não mudam) — só (re)busca quando a pasta ou o refresh (recarga) mudam.
  const foregroundPronto = mensagens !== null;
  const contadoresKeyRef = useRef<string>("");
  useEffect(() => {
    if (!foregroundPronto) return; // espera a lista (foreground) antes do fundo
    const chave = `${pastaCarga}|${recarga}`;
    if (contadoresKeyRef.current === chave) return; // já buscado p/ esta pasta
    contadoresKeyRef.current = chave;
    let vivo = true;
    api
      .crContadores(pastaCarga)
      .then((c) => {
        if (!vivo) return;
        setContFlagged(c.flagged);
        setContAnexos(c.anexos);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [pastaCarga, recarga, foregroundPronto]);

  // Detecção central de e-mails novos na Inbox: compara o topo da lista com o
  // último visto e dispara o toast rico (c-sonner-9). Chamada tanto pelo poll
  // (usuário parado) QUANTO ao recarregar a lista da inbox (refresh manual).
  // Antes o refresh só resetava o baseline sem avisar — por isso o toast "não
  // aparecia" ao dar refresh depois de receber um e-mail (#43).
  const ultimoVistoRef = useRef<string | null>(null);
  const notificarNovos = useCallback(
    (ms: EmailItem[]) => {
      if (ms.length === 0) return;
      // Baseline = o MAIOR recebido da lista, não ms[0]: com a inbox ordenável
      // (#32) o topo pode não ser o mais recente (ordem ≠ data / ascendente),
      // o que geraria toast espúrio/ausente no poll seguinte (#54).
      const maxRecebido = ms.reduce(
        (mx, m) => (m.recebido > mx ? m.recebido : mx),
        ms[0].recebido
      );
      const anterior = ultimoVistoRef.current;
      ultimoVistoRef.current = maxRecebido;
      if (anterior === null) return; // baseline: não avisa no 1º carregamento
      const novos = ms.filter((m) => m.recebido > anterior && !m.lido);
      // #48: toca o som configurado para "E-mails recebidos" uma vez por lote
      // (nada se o usuário escolheu "Não tocar nada").
      if (novos.length > 0) tocarSomEscopo("emailRecebido");
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
    },
    // idioma/t só mudam ao trocar idioma; setters são estáveis.
    [idioma, t]
  );

  // Poll leve da Inbox a cada 15 min (pega e-mail novo enquanto o usuário está
  // parado). No mount NÃO chamamos — o efeito de mensagens já busca a inbox e
  // semeia o baseline; um fetch duplo aqui competia e o Graph estrangulava (429).
  useEffect(() => {
    let vivo = true;
    const INTERVALO = 15 * 60 * 1000;
    const iv = setInterval(async () => {
      try {
        const msgs = await api.crFolderMensagens("inbox");
        if (vivo) notificarNovos(msgs);
      } catch {
        /* silencioso: é só o aviso de novos e-mails */
      }
    }, INTERVALO);
    return () => {
      vivo = false;
      clearInterval(iv);
    };
  }, [notificarNovos]);

  // Recarrega o que a mutação de uma PASTA invalidou: as contagens do sidebar
  // sempre; a LISTA só quando a pasta mexida é a que está aberta (senão a lista
  // perderia scroll/páginas à toa).
  function recarregarAposPasta(folderId: string) {
    if (folderId === pastaSelRef.current) setRecarga((x) => x + 1);
    else setRecargaPastas((x) => x + 1);
  }

  // Esvazia uma pasta (Lixeira / Lixo Eletrônico). Chamado pelo botão do
  // cabeçalho da lista e pelo menu de contexto da pasta (#89) — este último já
  // passou pelo AlertDialog de confirmação.
  async function esvaziarPasta(folderId: string) {
    const aviso = toast.loading(t.controlRoom.esvaziandoPasta);
    try {
      const n = await api.crEsvaziarPasta(folderId);
      toast.success(preencher(t.controlRoom.pastaEsvaziada, { n }), { id: aviso });
      recarregarAposPasta(folderId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { id: aviso, description: String(e) });
    }
  }

  // Marca como lidas todas as não lidas de uma pasta (#89). Pode demorar (loop
  // de PATCH no Graph), então mostra toast de progresso.
  async function marcarPastaLida(folderId: string) {
    const aviso = toast.loading(t.controlRoom.marcandoTodasLidas);
    try {
      const n = await api.crMarcarPastaLida(folderId);
      if (n === 0) toast.info(t.controlRoom.nenhumaNaoLida, { id: aviso });
      else toast.success(preencher(t.controlRoom.todasMarcadasLidas, { n }), { id: aviso });
      recarregarAposPasta(folderId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { id: aviso, description: String(e) });
    }
  }

  // ---- CRUD de subpastas (#90) --------------------------------------------
  // Toda mutação de pasta invalida DUAS coisas: as contagens/lista de raízes
  // (`recargaPastas` → refaz `crMailFolders`) e o cache de subpastas do(s) pai(s)
  // afetado(s) — que é memoizado e não voltaria sozinho.
  const recarregarSubpastas = useCallback(
    (...ids: (string | undefined)[]) => {
      for (const id of ids) {
        if (!id) continue;
        // Solta a trava de "já pedi" e limpa o cache, senão `carregarSubpastas`
        // devolveria a lista velha (sem a pasta nova / com a que saiu).
        subpastasPedidasRef.current.delete(id);
        setSubpastas((f) => {
          const n = { ...f };
          delete n[id];
          return n;
        });
        carregarSubpastas(id);
      }
      setRecargaPastas((x) => x + 1);
    },
    [carregarSubpastas]
  );

  async function criarSubpasta(paiId: string, nome: string) {
    const aviso = toast.loading(t.controlRoom.criandoSubpasta);
    try {
      const nova = await api.crCriarSubpasta(paiId, nome);
      toast.success(preencher(t.controlRoom.subpastaCriada, { pasta: nova.nome }), {
        id: aviso,
      });
      recarregarSubpastas(paiId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { id: aviso, description: String(e) });
    }
  }

  async function renomearPasta(id: string, nome: string, paiId?: string) {
    const aviso = toast.loading(t.controlRoom.renomeandoPasta);
    try {
      const nova = await api.crRenomearPasta(id, nome);
      toast.success(preencher(t.controlRoom.pastaRenomeada, { pasta: nova.nome }), {
        id: aviso,
      });
      recarregarSubpastas(paiId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { id: aviso, description: String(e) });
    }
  }

  async function excluirPasta(id: string, rotulo: string, paiId?: string) {
    const aviso = toast.loading(t.controlRoom.excluindoPasta);
    try {
      // `true` = foi pra Lixeira (reversível, o caminho normal); `false` = o
      // backend teve que cair no DELETE definitivo. O toast diz qual foi.
      const paraLixeira = await api.crExcluirPasta(id);
      toast.success(
        preencher(
          paraLixeira
            ? t.controlRoom.pastaExcluida
            : t.controlRoom.pastaExcluidaDefinitiva,
          { pasta: rotulo }
        ),
        { id: aviso }
      );
      // A pasta saiu do pai e (quando vai pra lixeira) virou filha de
      // deleteditems — os dois caches precisam voltar do Graph.
      recarregarSubpastas(paiId, "deleteditems");
      // Estava aberta? O id morreu junto: cai na inbox em vez de ficar numa
      // pasta fantasma com a lista vazia.
      if (pastaSelRef.current === id) setPastaSel("inbox");
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { id: aviso, description: String(e) });
    }
  }

  async function moverPasta(
    id: string,
    destino: string,
    rotuloDestino: string,
    paiId?: string
  ) {
    const aviso = toast.loading(t.controlRoom.movendoPasta);
    try {
      const nova = await api.crMoverPasta(id, destino);
      toast.success(preencher(t.controlRoom.pastaMovida, { pasta: rotuloDestino }), {
        id: aviso,
      });
      recarregarSubpastas(paiId, destino);
      // O move do Graph devolve a pasta com id NOVO: se ela estava selecionada,
      // seguir com o id antigo deixaria a lista quebrada.
      if (pastaSelRef.current === id) setPastaSel(nova.id);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { id: aviso, description: String(e) });
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
    setResultadosFiltro((prev) => prev?.map(fn) ?? prev);
  };
  const removerNasListas = (ids: Set<string>) => {
    setMensagens((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
    setResultadosBusca((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
    setResultadosFiltro((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
  };

  // Marca lido/não-lido (otimista, nos dois sentidos): ajusta o ponto de
  // não-lido e a contagem da pasta na hora; PATCH isRead em background com
  // rollback. Usado pelo auto-mark ao abrir e pela ação manual de "não-lido".
  function acaoMarcarLido(id: string, lido: boolean) {
    const m =
      mensagens?.find((x) => x.id === id) ??
      resultadosBusca?.find((x) => x.id === id) ??
      resultadosFiltro?.find((x) => x.id === id);
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

  // `acaoMarcarLido` é recriada a cada render (fecha sobre mensagens/pastas). O
  // timer do modo "atraso" dispara MUITO depois do render que o agendou, então
  // guardamos sempre a versão mais nova num ref: o callback atrasado lê o estado
  // atual (inclusive o guard `m.lido === lido`, que evita contar duas vezes se o
  // usuário marcou lido na mão antes do tempo).
  const marcarLidoRef = useRef(acaoMarcarLido);
  useEffect(() => {
    marcarLidoRef.current = acaoMarcarLido;
  });

  // Previewar a mensagem = lê-la (como em qualquer leitor) — mas AGORA conforme
  // a preferência do usuário (#95):
  //  - "imediato": marca lido assim que a mensagem é selecionada (default);
  //  - "atraso":   marca lido depois de N segundos DE LEITURA. O cleanup do
  //                efeito cancela o timer quando o usuário troca de mensagem
  //                antes do tempo (ou sai da tela / muda a preferência), então
  //                passar por cima de várias mensagens não marca nenhuma;
  //  - "manual":   não marca nada — só a ação explícita de marcar lido marca.
  useEffect(() => {
    if (!msgSel || marcarLidoModo === "manual") return;
    if (marcarLidoModo === "imediato") {
      marcarLidoRef.current(msgSel, true);
      return;
    }
    const timer = window.setTimeout(
      () => marcarLidoRef.current(msgSel, true),
      Math.max(1, marcarLidoAtraso) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [msgSel, marcarLidoModo, marcarLidoAtraso]);

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
    const fonte =
      (filtroGraph
        ? resultadosFiltro
        : busca.trim() !== ""
          ? resultadosBusca
          : mensagens) ?? [];
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

  /**
   * Move e-mails para outra pasta (#88) — mesmo desenho otimista do
   * `acaoExcluir` (que também é um move, pra Lixeira): some da lista na hora,
   * contadores das pastas ORIGEM e DESTINO ajustados, toast imediato e, no
   * fundo, o POST /messages/{id}/move em série. Se algum falhar, avisa e
   * recarrega a pasta pra ressincronizar (o item volta se não saiu).
   */
  async function acaoMover(ids: string[], destino: string, rotuloDestino: string) {
    if (ids.length === 0 || !destino || destino === pastaSel) return;
    const idsSet = new Set(ids);
    // Fonte = lista visível (pasta, busca ou filtro Graph), como no excluir.
    const fonte =
      (filtroGraph
        ? resultadosFiltro
        : busca.trim() !== ""
          ? resultadosBusca
          : mensagens) ?? [];
    const movidas = fonte.filter((m) => idsSet.has(m.id));
    const naoLidosFora = movidas.filter((m) => !m.lido).length;
    const anexosFora = movidas.filter((m) => m.temAnexos).length;
    const flaggedFora = movidas.filter((m) => m.sinalizado).length;

    // 1) OTIMISTA: tira da tela e marca como "saiu daqui" (mesmo registro que o
    //    excluir usa) pra o backfill/paginação não trazer as mensagens de volta.
    ids.forEach((id) => deletadasRef.current.add(id));
    removerNasListas(idsSet);
    if (anexosFora > 0) ajustarContAnexos(-anexosFora);
    if (flaggedFora > 0) ajustarContFlagged(-flaggedFora);
    if (msgSel && idsSet.has(msgSel)) setMsgSel(null);
    setSelecionados((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    });

    // 2) Contadores do sidebar: origem −N, destino +N (só se o destino for uma
    //    pasta do sidebar — subpasta não aparece lá e não tem o que ajustar).
    setPastas((prev) =>
      prev?.map((p) => {
        if (p.id === pastaSel) {
          return {
            ...p,
            total: Math.max(0, p.total - ids.length),
            naoLidos: Math.max(0, p.naoLidos - naoLidosFora),
          };
        }
        if (p.id === destino) {
          return { ...p, total: p.total + ids.length, naoLidos: p.naoLidos + naoLidosFora };
        }
        return p;
      }) ?? prev
    );

    // 3) Toast imediato de confirmação.
    toast.success(
      ids.length > 1
        ? preencher(t.controlRoom.selecionadosMovidos, {
            n: ids.length,
            pasta: rotuloDestino,
          })
        : preencher(t.controlRoom.emailMovido, { pasta: rotuloDestino })
    );

    // 4) Move de verdade em background + reconcile.
    let ok: string[] = [];
    try {
      ok = await api.crMoverEmails(ids, destino);
    } catch {
      ok = [];
    }
    const falharam = ids.filter((id) => !ok.includes(id));
    if (falharam.length > 0) {
      falharam.forEach((id) => deletadasRef.current.delete(id));
      toast.error(t.controlRoom.erroAcao);
      setRecarga((n) => n + 1); // ressincroniza lista + contagens do zero
    } else {
      setRecargaPastas((x) => x + 1); // reconcilia as contagens reais
    }
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
      .crFolderMensagens(pastaCarga, 0, ordenar, ordemDesc)
      .then((ms) => {
        if (!vivo) return;
        carregadosRef.current = ms.length;
        setMensagens(ms);
        // mantém a mensagem já selecionada se ela existir na lista nova (ex.:
        // clicar "Responder" num toast já selecionou a msg antes do fetch);
        // senão pega a primeira.
        setMsgSel((cur) => (cur && ms.some((m) => m.id === cur) ? cur : (ms[0]?.id ?? null)));
        setTemMais(ms.length === PAGINA);
        // Inbox: detecta e avisa e-mails novos (também no refresh manual). SÓ
        // quando a lista está em DATA-DESC — aí `ms` está com o mais novo no
        // topo e o baseline (max recebido) é confiável. Em outra ordem (ex.:
        // data-asc), a 1ª página não contém o mais novo, o baseline ficaria
        // baixo e o poll seguinte dispararia toast espúrio (#54). Nesses casos
        // o poll (que SEMPRE busca date-desc) mantém o baseline sozinho. #43
        if (pastaCarga === "inbox" && ordenar === "data" && ordemDesc) notificarNovos(ms);
      })
      .catch(() => vivo && setMensagens([]));
    return () => {
      vivo = false;
    };
    // notificarNovos é estável (useCallback [idioma,t]); fora das deps de
    // propósito pra não recarregar a lista ao trocar idioma. ordenar/ordemDesc
    // ENTRAM: trocar a ordenação re-busca a lista já ordenada pelo Graph (#32).
    // pastaCarga (debounced) no lugar de pastaSel: coalesce a troca rápida (#87).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastaCarga, recarga, ordenar, ordemDesc]);

  // Pré-carga: busca a próxima página do servidor pela âncora (skip = já
  // buscado, não o tamanho da lista) e concatena deduplicando. Serve tanto pro
  // scroll (90%) quanto pro backfill pós-exclusão.
  async function carregarMais() {
    if (carregandoMaisRef.current || !temMais) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      const pagina = await api.crFolderMensagens(
        pastaCarga,
        carregadosRef.current,
        ordenar,
        ordemDesc
      );
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
    // Com um filtro Graph ativo NÃO fazemos $search no servidor: o texto é
    // aplicado client-side por cima do resultado do filtro (D2).
    if (!termo || filtroGraph) {
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
  }, [busca, pastaSel, filtroGraph]);

  // Reset visual do filtro ao TROCAR de pasta (#31 / D3): um filtro Graph da
  // Inbox não faz sentido carregar pra Enviados. Só reseta em troca REAL — no
  // 1º render mantém o valor persistido (não zera o que veio do localStorage).
  const filtroPastaRef = useRef(pastaSel);
  useEffect(() => {
    if (filtroPastaRef.current !== pastaSel) {
      filtroPastaRef.current = pastaSel;
      setFiltros([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastaSel]);

  // Filtros que EXIGEM o servidor (tome/mentions/invites): busca via cr_filtrar
  // e pagina pela continuação (nextLink), igual à busca. Fora deles, limpa.
  useEffect(() => {
    if (!filtroGraph) {
      setResultadosFiltro(null);
      setTemMaisFiltro(false);
      proximoFiltroRef.current = null;
      return;
    }
    let vivo = true;
    setResultadosFiltro(null); // null = spinner
    proximoFiltroRef.current = null;
    const escopo = filtroServidor;
    api
      .crFiltrar(pastaSel, escopo!)
      .then((res) => {
        if (!vivo) return;
        proximoFiltroRef.current = res.proximo;
        setResultadosFiltro(res.itens.filter((m) => !deletadasRef.current.has(m.id)));
        setTemMaisFiltro(res.proximo !== null);
      })
      .catch((e) => {
        if (!vivo) return;
        // D6: tenant sem suporte (HTTP 400) → esconde a opção e remove o chip de
        // escopo, silenciosamente. Outros erros só deixam a lista vazia.
        const msg = String(e);
        if ((escopo === "mentions" || escopo === "invites") && msg.includes("400")) {
          setFiltrosOcultos((s) => new Set(s).add(escopo));
          setFiltros((fs) => fs.filter((f) => f.field !== "scope"));
        }
        setResultadosFiltro([]);
        setTemMaisFiltro(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroServidor, filtroGraph, pastaSel, recarga]);

  // Paginação do filtro Graph via @odata.nextLink; dedup igual à busca.
  async function carregarMaisFiltro() {
    const proximo = proximoFiltroRef.current;
    if (carregandoMaisRef.current || !filtroGraph || !proximo) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      const res = await api.crFiltrar(pastaSel, filtroServidor!, proximo);
      proximoFiltroRef.current = res.proximo;
      setResultadosFiltro((prev) => juntar(prev ?? [], res.itens));
      setTemMaisFiltro(res.proximo !== null);
    } catch {
      /* silencioso */
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

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

  // Fonte da lista mostrada, por precedência: filtro Graph (com o texto da busca
  // aplicado client-side por cima — D2) > busca de texto server-side > pasta.
  const textoBuscaLower = busca.trim().toLowerCase();
  const fonteLista = useMemo<EmailItem[] | null>(() => {
    if (filtroGraph) {
      if (!resultadosFiltro) return null; // spinner enquanto o filtro carrega
      if (!textoBuscaLower) return resultadosFiltro;
      return resultadosFiltro.filter(
        (m) =>
          m.assunto.toLowerCase().includes(textoBuscaLower) ||
          m.de.toLowerCase().includes(textoBuscaLower) ||
          m.preview.toLowerCase().includes(textoBuscaLower)
      );
    }
    return buscaAtiva ? resultadosBusca : mensagens;
  }, [filtroGraph, resultadosFiltro, textoBuscaLower, buscaAtiva, resultadosBusca, mensagens]);
  const onCarregarMaisLista = filtroGraph
    ? carregarMaisFiltro
    : buscaAtiva
      ? carregarMaisBusca
      : carregarMais;
  const temMaisLista = filtroGraph ? temMaisFiltro : buscaAtiva ? temMaisBusca : temMais;

  const pastaAtual = pastas?.find((p) => p.id === pastaSel);
  const tituloLista = pastaAtual ? rotuloPasta(pastaAtual.tipo, pastaAtual.nome, t) : "";
  const msgAtual =
    fonteLista?.find((m) => m.id === msgSel) ?? mensagens?.find((m) => m.id === msgSel);

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
          subpastas={subpastas}
          onCarregarSubpastas={carregarSubpastas}
          sel={pastaSel}
          onSel={setPastaSel}
          onNovo={novoEmailModal}
          onComposeOutlook={composeOutlook}
          onMarcarTodasLidas={marcarPastaLida}
          onEsvaziarPasta={esvaziarPasta}
          arvore={arvorePastas}
          arvoreCarregando={arvorePendentes.length > 0}
          onAbrirArvore={() => setPedirArvore(true)}
          onCriarSubpasta={criarSubpasta}
          onRenomearPasta={renomearPasta}
          onExcluirPasta={excluirPasta}
          onMoverPasta={moverPasta}
          colapsada={!sidebarAberta}
          agendaAberta={agendaAberta}
          onToggleAgenda={() => setAgendaAberta((v) => !v)}
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
              mensagens={fonteLista}
              sel={msgSel}
              onSel={setMsgSel}
              onRefresh={() => setRecarga((n) => n + 1)}
              sidebarAberta={sidebarAberta}
              onToggleSidebar={() => setSidebarAberta((v) => !v)}
              pastaId={pastaSel}
              pastaTipo={pastaAtual?.tipo ?? ""}
              onEsvaziar={() => esvaziarPasta(pastaSel)}
              onCarregarMais={onCarregarMaisLista}
              carregandoMais={carregandoMais}
              temMais={temMaisLista}
              onFlag={acaoFlag}
              onExcluir={acaoExcluir}
              onMarcarLido={acaoMarcarLido}
              pastasDestino={pastasDestino}
              pastasCarregando={arvorePendentes.length > 0}
              onAbrirMover={() => setPedirArvore(true)}
              onMover={acaoMover}
              selecionados={selecionados}
              setSelecionados={setSelecionados}
              naoLidosPasta={pastaAtual?.naoLidos ?? 0}
              contFlagged={contFlagged}
              contAnexos={contAnexos}
              filtros={filtros}
              onFiltros={setFiltros}
              filtrosOcultos={filtrosOcultos}
              busca={busca}
              setBusca={setBusca}
              ordenar={ordenar}
              ordemDesc={ordemDesc}
              onOrdenar={(o, desc) => {
                setOrdenar(o);
                setOrdemDesc(desc);
              }}
              marcarLidoModo={marcarLidoModo}
              marcarLidoAtraso={marcarLidoAtraso}
              onMarcarLidoModo={setMarcarLidoModo}
              onMarcarLidoAtraso={setMarcarLidoAtraso}
              onResponder={() => detalheRef.current?.responder()}
              onResponderTodos={() => detalheRef.current?.responderTodos()}
              onEncaminhar={() => detalheRef.current?.encaminhar()}
              onCompor={() => setNovaAberta(true)}
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
                ref={detalheRef}
                id={msgSel}
                userEmail={user.email}
                sinalizado={msgAtual?.sinalizado ?? false}
                lido={msgAtual?.lido ?? false}
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

        {/* Card da Agenda no MESMO lugar de sempre (lado direito). Agora quem
            controla a visibilidade é o item do sidebar esquerdo (#50): visível =
            renderiza; escondido = some e a lista+detalhe ocupam a largura toda. */}
        {agendaAberta && (
          <AgendaConteudo onEvento={setEventoSel} t={t} idioma={idioma} />
        )}
      </div>

      <EventoDialog id={eventoSel} userEmail={user.email} onClose={() => setEventoSel(null)} />
      <NovaMensagemModal aberto={novaAberta} onClose={() => setNovaAberta(false)} t={t} />
    </div>
  );
}
