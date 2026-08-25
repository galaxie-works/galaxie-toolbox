// #1019 (épico #1007) — o seam do MessageDetail, tirado do `control-room.tsx`.
//
// É o 4º dos cinco seams do enunciado, e o maior depois do MessageList. Vieram
// junto os cinco exclusivos (`DicaSomenteLeitura`, `LinhaPessoas`,
// `InsightsRemetentePopover`, `BadgeAutenticacao`, `PreviewEmailAninhado`) e
// três que a contagem crua diria que não vêm — `dataCurta`, `recencia` e
// `porMes` marcam zero usos no seam porque os usos moram DENTRO do popover de
// insights, que é exclusivo dele. Terceira vez que esse padrão aparece nesta US.
//
// A tabela de medição está no card, publicada antes de eu mover uma linha.

import { comZ } from "@/lib/data-email";
import { logErro } from "@/lib/log";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Badge } from "@/components/reui/badge";

import { PreviewAnexo } from "@/components/bridge/preview-anexo";
import { ehItemAttachment, ehPrevisualizavel, ehReferenceAttachment } from "@/lib/anexo-tipo";

import { Button } from "@/components/ui/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import { type FormatoSalvar } from "@/components/bridge/message-list";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortcutAccessibleLabel, formatShortcut } from "@/components/ui/shortcut";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
// #1060: catálogo declarativo dos atalhos do Bridge (fonte única) — os tooltips/
// aria-labels das ações icon-only leem daqui, a MESMA fonte da ajuda "?".
import {
  ATALHO_ENCAMINHAR,
  ATALHO_EXCLUIR,
  ATALHO_FECHAR_PREVIEW,
  ATALHO_IMPRIMIR,
  ATALHO_LER_NAO_LIDO,
  ATALHO_RESPONDER,
  ATALHO_RESPONDER_TODOS,
  ATALHO_SALVAR_COMO,
  ATALHO_SINALIZAR,
} from "@/components/atalhos-bridge";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ComporMensagem, type ComporMensagemHandle } from "@/components/compose/compor-mensagem";

import { PersonHoverCard } from "@/components/people/person-hover-card";
// Ícones animados das pastas de e-mail (#494) — lucide-animated via registry.

import { toast } from "sonner";
import { toastIcone, toastDownload } from "@/lib/toasts";
import * as api from "@/lib/api";

import { descricaoErroEnvio } from "@/lib/bridge-compose";
import { useFotos } from "@/lib/fotos";

import { preencher, useIdioma } from "@/lib/idioma";

import { useAppStore } from "@/store";

import { useUndoSend } from "@/hooks/use-undo-send";
import { CorpoMensagem } from "@/components/bridge/corpo-html";


import { cn, comLoginHint } from "@/lib/utils";
import type {
  AnexoEmail,
  EmailDetalhe,
} from "@/lib/types";
import {
  nivelAutenticacao,
  parseAuthResults,
  replyToDivergente,
  type NivelAutenticacao,
  type ResultadoAutenticacao,
} from "@/lib/seguranca-leitor";
import {
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Printer,
  RefreshCw,
  Reply,
  ReplyAll,
  Save,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
// #489: ícones de collapse do registry animate-ui (animados), por estado.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTypingTarget } from "@/hooks/use-atalhos";

/** #109 removeu o esconder-escopo em 400; a coleção canônica permanece vazia. */

/** Tooltip canônico (c-tooltip-4) para controles desabilitados em uma shared
 * mailbox. O `span` recebe o hover/foco porque botão nativo disabled não recebe
 * eventos; o componente Tooltip continua literal, sem provider local. */
function DicaSomenteLeitura({
  ativo,
  texto,
  children,
}: {
  ativo: boolean;
  texto: string;
  children: React.ReactNode;
}) {
  if (!ativo) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{texto}</TooltipContent>
    </Tooltip>
  );
}

function LinhaPessoas({
  rotulo,
  nomes,
  emails,
}: {
  rotulo: string;
  nomes: string[];
  /** E-mails alinhados 1:1 com `nomes` (#515). "" = sem e-mail → texto simples. */
  emails: string[];
}) {
  if (nomes.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">{rotulo}:</span>{" "}
      {nomes.map((nome, i) => {
        const email = emails[i]?.trim();
        return (
          <span key={`${nome}-${i}`}>
            {i > 0 && ", "}
            {/* #515: cada destinatário com e-mail abre o PersonHoverCard. */}
            {email ? (
              <PersonHoverCard email={email} fallback={{ nome, email }}>
                <span className="cursor-default underline-offset-2 hover:underline">
                  {nome}
                </span>
              </PersonHoverCard>
            ) : (
              nome
            )}
          </span>
        );
      })}
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
  const aberto = useAppStore((s) => s.insightsAberto);
  const estado = useAppStore((s) => s.insightsEstado);
  const dados = useAppStore((s) => s.insightsDados);
  const abrirInsights = useAppStore((s) => s.abrirInsights);
  const fecharInsights = useAppStore((s) => s.fecharInsights);
  const tentarNovamenteInsights = useAppStore(
    (s) => s.tentarNovamenteInsights,
  );

  const rec = dados?.recebidos ?? 0;
  const env = dados?.enviados;
  const total = rec + (env ?? 0);
  const vazio =
    estado === "ok" && rec === 0 && (env == null || env === 0) && !dados?.primeiro;

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        if (o) void abrirInsights(email);
        else fecharInsights();
      }}
    >
      <PersonHoverCard email={email} fallback={{ nome, email }}>
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
      </PersonHoverCard>
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
              onClick={() => void tentarNovamenteInsights(email)}
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
  // Tooltip canônico (#98): SEM TooltipProvider local — o provider único do app
  // (delay/animação/seta padronizados) vive em src/main.tsx. Texto humano é o
  // principal; a linha crua SPF/DKIM/DMARC fica discreta e secundária, e só
  // aparece quando há dados (evita a "sopa" de traços no nível indisponível).
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">
          <Badge variant={cfg.variant} size="sm" className="shrink-0 gap-1">
            <cfg.Icone />
            {cfg.rotulo}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{cfg.dica}</p>
        {nivel !== "indisponivel" && (
          <p className="mt-1.5 font-mono text-[0.65rem] opacity-70">
            <span className="mr-1 font-sans opacity-80">
              {t.controlRoom.segAutDetalhesTecnicos}:
            </span>
            SPF {est(resultado.spf)} · DKIM {est(resultado.dkim)} · DMARC{" "}
            {est(resultado.dmarc)}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Handle imperativo do leitor (#28): os atalhos r/a/f abrem o Sheet de resposta
// chamando estas funções — a UI de reply/forward já existe, só ligamos a tecla.
export interface MessageDetailHandle {
  responder: () => void;
  responderTodos: () => void;
  encaminhar: () => void;
  /** #636: abre o menu "..." (Mais ações) do leitor — o alvo do atalho F12. */
  abrirMaisAcoes: () => void;
}

/**
 * Reader aninhado de um e-mail embutido (itemAttachment / `.msg`, #191): busca a
 * mensagem via `cr_ler_anexo_email` e renderiza com o MESMO `CorpoMensagem`
 * (pipeline sandbox), header e a lista de anexos aninhados. Corrige o erro atual
 * de itemAttachment (que não tem `contentBytes`).
 */
function PreviewEmailAninhado({
  anexo,
  messageId,
  mailbox,
  onFechar,
  onAbrirLink,
}: {
  anexo: AnexoEmail;
  messageId: string;
  mailbox?: string;
  onFechar: () => void;
  onAbrirLink: (url: string) => void;
}) {
  const { t } = useIdioma();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [det, setDet] = useState<EmailDetalhe | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    api
      .crLerAnexoEmail(messageId, anexo.id, mailbox)
      .then((d) => {
        if (vivo) setDet(d);
      })
      .catch((e) => {
        if (vivo) setErro(String(e));
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [messageId, anexo.id, mailbox]);

  // #549: Esc fecha ESTE preview de anexo com PRECEDÊNCIA sobre o clear-selection
  // da lista (padrão Outlook: Esc fecha o painel aberto primeiro). Como o listener
  // só existe enquanto o preview está montado e roda em CAPTURE + consome o evento
  // (stopImmediatePropagation), ele ganha do handler de lista (bubble via useAtalhos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTypingTarget(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onFechar();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onFechar]);

  return (
    <div
      className="mt-3 overflow-hidden rounded-lg border bg-card"
      role="region"
      aria-label={anexo.nome}
    >
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <Mail className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {det?.assunto || anexo.nome}
        </span>
        {/* #549: fechar preview de anexo ganha atalho Esc → ShortcutTooltip
            (antes não tinha tooltip nenhum). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onFechar}
              aria-label={shortcutAccessibleLabel(
                t.controlRoom.previewFechar,
                ATALHO_FECHAR_PREVIEW
              )}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <ShortcutTooltip
              label={t.controlRoom.previewFechar}
              shortcut={ATALHO_FECHAR_PREVIEW}
            />
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-24">
        {carregando ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : erro ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertTitle>{t.controlRoom.previewErro}</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          </div>
        ) : det ? (
          <div className="px-4 py-3">
            <div className="mb-2 text-xs">
              <p className="font-medium">{det.de || det.deEmail}</p>
              {det.para.length > 0 && (
                <p className="truncate text-muted-foreground">
                  {t.controlRoom.para}: {det.para.join(", ")}
                </p>
              )}
            </div>
            <CorpoMensagem
              corpo={det.corpo}
              tipo={det.corpoTipo}
              onAbrirLink={onAbrirLink}
            />
            {det.anexos.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {det.anexos.map((a, i) => (
                  <span
                    key={a.id || i}
                    className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                  >
                    <Paperclip className="size-3" />
                    <span className="max-w-40 truncate">{a.nome}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MessageDetail = forwardRef<
  MessageDetailHandle,
  {
    id: string | null;
    userEmail?: string | null;
    mailbox: string;
    envioBloqueado: boolean;
    sinalizado: boolean;
    lido: boolean;
    onFlag: (id: string, novo: boolean) => void;
    onExcluir: (ids: string[]) => void;
    onMarcarLido: (id: string, lido: boolean) => void;
    onSalvarComo: (ids: string[], formato: FormatoSalvar) => void;
    onImprimir: (ids: string[]) => void;
    onAbrirLink: (url: string) => void;
    onMudou: () => void;
    t: ReturnType<typeof useIdioma>["t"];
    idioma: string;
  }
>(function MessageDetail(
  {
    id,
    userEmail,
    mailbox,
    envioBloqueado,
    sinalizado,
    lido,
    onFlag,
    onExcluir,
    onMarcarLido,
    onSalvarComo,
    onImprimir,
    onAbrirLink,
    onMudou,
    t,
    idioma,
  },
  ref
) {
  const det = useAppStore((s) => s.leitorDetalhe);
  // Segurança do leitor (#91): Reply-To + headers de autenticação. Best-effort,
  // carregado à parte do corpo pra não atrasar a leitura.
  const seg = useAppStore((s) => s.leitorSeguranca);
  const composeModo = useAppStore((s) => s.composeModo);
  const modo = composeModo === "novo" ? null : composeModo;
  const composeGeracao = useAppStore((s) => s.composeGeracao);
  const abrirCompose = useAppStore((s) => s.abrirCompose);
  const fecharCompose = useAppStore((s) => s.fecharCompose);
  const carregarLeitor = useAppStore((s) => s.carregarLeitor);
  const limparLeitor = useAppStore((s) => s.limparLeitor);
  const setSidebarAberta = useAppStore((s) => s.setSidebarAberta);
  const comporRef = useRef<ComporMensagemHandle>(null);
  // Anexo em pré-visualização (#188); null = nenhum aberto.
  const [previewAtual, setPreviewAtual] = useState<AnexoEmail | null>(null);
  // E-mail embutido (itemAttachment) aberto no reader aninhado (#191).
  const [anexoEmail, setAnexoEmail] = useState<AnexoEmail | null>(null);
  // #636: menu "..." (Mais ações) do leitor — controlado pra o F12 abrir via ref.
  const [maisAberto, setMaisAberto] = useState(false);
  // Fecha preview/reader aninhado ao trocar de e-mail (não vaza o anterior).
  useEffect(() => {
    setPreviewAtual(null);
    setAnexoEmail(null);
  }, [id]);
  // #496: abrir preview colapsa o sidebar (mais espaço) — gatilho TRANSIENTE
  // (ação do usuário), NUNCA reativo a estado persistente (P0 do webview). Ao
  // fechar, o sidebar PERMANECE colapsado (sem re-expandir → evita reflow).
  const abrirPreview = (a: AnexoEmail) => {
    setPreviewAtual(a);
    setSidebarAberta(false);
  };
  const textosUndoSend = useMemo(
    () => ({
      tituloPendente: (segundos: number) =>
        preencher(t.controlRoom.envioPendente, { n: segundos }),
      descricaoPendente: t.controlRoom.envioPendenteDescricao,
      rotuloDesfazer: t.controlRoom.desfazerEnvio,
      envioCancelado: t.controlRoom.envioCancelado,
      enviando: t.controlRoom.enviandoAgora,
    }),
    [t]
  );
  const {
    agendar: agendarUndoSend,
    estado: estadoUndoSend,
    ocupado: envioOcupado,
  } = useUndoSend(textosUndoSend);
  // Avatar do remetente interno (#39).
  const { getFoto, pedirFotos } = useFotos();

  // Atalhos r/a/f: só fazem sentido com uma mensagem aberta (`id`). Abrir o
  // Sheet reusa exatamente a mesma ação do compose-slice usada pela toolbar.
  useImperativeHandle(
    ref,
    () => ({
      responder: () =>
        id && !envioBloqueado && abrirCompose("responder", mailbox),
      responderTodos: () =>
        id && !envioBloqueado && abrirCompose("responderTodos", mailbox),
      encaminhar: () =>
        id && !envioBloqueado && abrirCompose("encaminhar", mailbox),
      abrirMaisAcoes: () => {
        if (id) setMaisAberto(true);
      },
    }),
    [id, envioBloqueado, mailbox, abrirCompose]
  );

  useEffect(() => {
    // Trocar/fechar a mensagem invalida qualquer rascunho de resposta ligado
    // ao leitor anterior, preservando o reset que antes vivia no reader-slice.
    fecharCompose();
    if (!id) {
      limparLeitor();
      return;
    }
    void carregarLeitor({ id, mailbox });
  }, [id, mailbox, carregarLeitor, limparLeitor, fecharCompose]);

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
      const caminho = await api.crBaixarAnexo(id, anexo.id, mailbox);
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

  // Ação explícita "Abrir no Windows" (#188 rework): baixa e abre no app padrão.
  async function abrirAnexoNoWindows(anexo: AnexoEmail) {
    if (!id) return;
    try {
      const caminho = await api.crBaixarAnexo(id, anexo.id, mailbox);
      await api.abrirCaminho(caminho);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  // Anexo de referência (#191): busca o link de destino e abre no Navigator,
  // sem baixar bytes.
  async function abrirAnexoLink(anexo: AnexoEmail) {
    if (!id) return;
    try {
      const url = await api.crAnexoLink(id, anexo.id, mailbox);
      onAbrirLink(url);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  const abrirOutlook = () =>
    det?.webLink && api.abrirAppInterno("outlook", comLoginHint(det.webLink, userEmail), "Outlook");

  function enviar() {
    if (!id || envioBloqueado || envioOcupado) return;
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
    const anexos = c?.getAnexos() ?? [];
    const modoAgendado = modo;

    agendarUndoSend({
      enviar: async () => {
        if (modoAgendado === "encaminhar") {
          await api.crEncaminhar(id, html, destinos, anexos, mailbox);
          // Salva os destinatários nos Contatos: best-effort para o USUÁRIO
          // (#1075 RB46-d) — sem toast, porque ele pediu para encaminhar, não
          // para gravar contatos. Mas o resultado passa a ser registrado.
          api
            .crSalvarContatos(destinos.map((e) => ({ nome: e, email: e })))
            .then(api.registrarFalhasDeContato)
            .catch((e) => logErro("contatos:salvar", e));
        } else {
          await api.crResponder(
            id,
            html,
            modoAgendado === "responderTodos",
            anexos,
            mailbox
          );
        }
      },
      onConcluido: () => {
        toastIcone(
          t.controlRoom.enviado,
          t.controlRoom.enviadoDescricao,
          "enviado"
        );
        fecharCompose();
        onMudou();
      },
      onErro: (erro) => {
        toast.error(t.controlRoom.erroEnvio, {
          description: descricaoErroEnvio(erro, mailbox, t),
        });
      },
    });
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
            {det.anexos.map((a, i) => {
              // Tipo do anexo (#188 rework + #191): roteia clique/ícone/menu.
              const ref = ehReferenceAttachment(a);
              const item = ehItemAttachment(a);
              const previsivel = ehPrevisualizavel(a);
              const rotuloAcao = previsivel
                ? t.controlRoom.previewCtxVer
                : t.controlRoom.abrirArquivo;
              return (
                // Clique roteia por tipo: referência → link; e-mail embutido →
                // reader aninhado; previsível → preview; senão baixa. Right-click
                // abre o menu de contexto.
                <Tooltip key={a.id || i}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            ref
                              ? abrirAnexoLink(a)
                              : item
                                ? setAnexoEmail(a)
                                : previsivel
                                  ? abrirPreview(a)
                                  : baixarAnexo(a)
                          }
                          className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                          aria-label={`${rotuloAcao}: ${a.nome}`}
                        >
                          <Paperclip className="size-3.5 text-muted-foreground" />
                          <span className="max-w-40 truncate">{a.nome}</span>
                          {ref ? (
                            <ExternalLink className="size-3.5 text-muted-foreground" />
                          ) : item ? (
                            <Mail className="size-3.5 text-muted-foreground" />
                          ) : previsivel ? (
                            <Eye className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Download className="size-3.5 text-muted-foreground" />
                          )}
                        </button>
                      </TooltipTrigger>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {ref ? (
                        <ContextMenuItem onSelect={() => abrirAnexoLink(a)}>
                          <ExternalLink /> {t.controlRoom.abrirArquivo}
                        </ContextMenuItem>
                      ) : item ? (
                        <ContextMenuItem onSelect={() => setAnexoEmail(a)}>
                          <Mail /> {t.controlRoom.abrirArquivo}
                        </ContextMenuItem>
                      ) : (
                        <>
                          {previsivel && (
                            <ContextMenuItem onSelect={() => abrirPreview(a)}>
                              <Eye /> {t.controlRoom.previewCtxVer}
                            </ContextMenuItem>
                          )}
                          <ContextMenuItem onSelect={() => baixarAnexo(a)}>
                            <Download /> {t.controlRoom.previewSalvar}
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => abrirAnexoNoWindows(a)}
                          >
                            <ExternalLink /> {t.controlRoom.previewAbrirWindows}
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                  <TooltipContent>{rotuloAcao}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          {anexoEmail && id && (
            <PreviewEmailAninhado
              anexo={anexoEmail}
              messageId={id}
              mailbox={mailbox}
              onFechar={() => setAnexoEmail(null)}
              onAbrirLink={onAbrirLink}
            />
          )}
        </>
      )}
    </div>
  );

  return (
    // #640: `data-print-area` = alvo do `@media print` (index.css). Ao imprimir
    // (ShowPrintUI na main), a UI do app some e só este painel (cabeçalho + corpo)
    // sai — sem sidebar/lista/toolbar. A toolbar e a barra de resize levam
    // `print:hidden` (não são conteúdo do e-mail).
    <section
      data-print-area
      className="flex h-full min-w-0 flex-col rounded-xl border bg-card"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b px-3 py-2 print:hidden">
        <DicaSomenteLeitura
          ativo={envioBloqueado}
          texto={t.controlRoom.caixaEnvioRelogin}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => abrirCompose("responder", mailbox)}
            disabled={envioBloqueado}
            aria-label={shortcutAccessibleLabel(
              t.controlRoom.responder,
              ATALHO_RESPONDER
            )}
          >
            <Reply /> {t.controlRoom.responder}
            <Kbd>{formatShortcut(ATALHO_RESPONDER)}</Kbd>
          </Button>
        </DicaSomenteLeitura>
        <DicaSomenteLeitura
          ativo={envioBloqueado}
          texto={t.controlRoom.caixaEnvioRelogin}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => abrirCompose("responderTodos", mailbox)}
            disabled={envioBloqueado}
            aria-label={shortcutAccessibleLabel(
              t.controlRoom.responderTodos,
              ATALHO_RESPONDER_TODOS
            )}
          >
            <ReplyAll /> {t.controlRoom.responderTodos}
            <Kbd>{formatShortcut(ATALHO_RESPONDER_TODOS)}</Kbd>
          </Button>
        </DicaSomenteLeitura>
        <DicaSomenteLeitura
          ativo={envioBloqueado}
          texto={t.controlRoom.caixaEnvioRelogin}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => abrirCompose("encaminhar", mailbox)}
            disabled={envioBloqueado}
            aria-label={shortcutAccessibleLabel(
              t.controlRoom.encaminhar,
              ATALHO_ENCAMINHAR
            )}
          >
            <Forward /> {t.controlRoom.encaminhar}
            <Kbd>{formatShortcut(ATALHO_ENCAMINHAR)}</Kbd>
          </Button>
        </DicaSomenteLeitura>
        <div className="ml-auto flex items-center gap-1">
          {/* Sinalizar do leitor (#102): atalho S → ShortcutTooltip com Kbd. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => id && onFlag(id, !sinalizado)}
                aria-label={shortcutAccessibleLabel(
                  t.controlRoom.sinalizar,
                  ATALHO_SINALIZAR
                )}
              >
                <Flag className={cn("size-4", sinalizado && "fill-red-500 text-red-500")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <ShortcutTooltip
                label={t.controlRoom.sinalizar}
                shortcut={ATALHO_SINALIZAR}
              />
            </TooltipContent>
          </Tooltip>
          {/* Botão de lido/não-lido: ALTERNA (#95). Antes era só "marcar como
              não lido" — o que bastava quando o app marcava lido sozinho ao
              abrir. Nos modos "após atraso"/"manual" a mensagem pode continuar
              não-lida no leitor, então o botão precisa marcar LIDO também.
              #102: atalho U → ShortcutTooltip; label acompanha o estado (o
              texto muda entre marcar lido/não-lido). Substitui o `title`. */}
          {(() => {
            const rotuloLido = lido
              ? t.controlRoom.marcarNaoLido
              : t.controlRoom.marcarLido;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => id && onMarcarLido(id, !lido)}
                    aria-label={shortcutAccessibleLabel(
                      rotuloLido,
                      ATALHO_LER_NAO_LIDO
                    )}
                  >
                    {lido ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <ShortcutTooltip
                    label={rotuloLido}
                    shortcut={ATALHO_LER_NAO_LIDO}
                  />
                </TooltipContent>
              </Tooltip>
            );
          })()}
          {/* Excluir do leitor (#102): atalho Delete → ShortcutTooltip com Kbd. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => id && onExcluir([id])}
                aria-label={shortcutAccessibleLabel(
                  t.controlRoom.excluir,
                  ATALHO_EXCLUIR
                )}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <ShortcutTooltip
                label={t.controlRoom.excluir}
                shortcut={ATALHO_EXCLUIR}
              />
            </TooltipContent>
          </Tooltip>
          {/* Abrir no Outlook (#102): ação sem atalho → Tooltip simples. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={abrirOutlook} aria-label={t.controlRoom.abrirOutlook}>
                <ExternalLink />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.controlRoom.abrirOutlook}</TooltipContent>
          </Tooltip>
          {/* #636: "..." (Mais ações) na ponta direita → Salvar como… / Imprimir.
              Controlado (`maisAberto`) pra o atalho F12 abrir via ref. Tooltip
              documenta a tecla nativa de context-menu (Menu / Shift+F10); os
              itens têm seu próprio kbd (F12 / Ctrl+P). */}
          <DropdownMenu open={maisAberto} onOpenChange={setMaisAberto}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t.controlRoom.maisAcoes}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex items-center gap-2 text-sm">
                  {t.controlRoom.maisAcoes}
                  <KbdGroup>
                    <Kbd>Menu</Kbd>
                    <Kbd>Shift+F10</Kbd>
                  </KbdGroup>
                </div>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Save />
                  {t.controlRoom.salvarComo}
                  <DropdownMenuShortcut>
                    {formatShortcut(ATALHO_SALVAR_COMO)}
                  </DropdownMenuShortcut>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => id && onSalvarComo([id], "pdf")}
                  >
                    <FileText />
                    {t.controlRoom.salvarPdf}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => id && onSalvarComo([id], "eml")}
                  >
                    <Mail />
                    {t.controlRoom.salvarEml}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                className="gap-2"
                onClick={() => id && onImprimir([id])}
              >
                <Printer />
                {t.controlRoom.imprimir}
                <DropdownMenuShortcut>
                  {formatShortcut(ATALHO_IMPRIMIR)}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* #496: split e-mail ↔ card de preview lateral. O painel do e-mail fica
          SEMPRE montado (order=1) → sem remount do corpo/iframe ao abrir/fechar
          o preview (nada de piscar). A largura do preview persiste via autoSaveId. */}
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="bridge.preview"
        className="min-h-0 flex-1"
      >
        <ResizablePanel order={1} minSize={30} className="flex min-w-0 flex-col">
      {/* Cabeçalho do e-mail */}
      <div className="border-b px-5 py-4">
        <h1 className="text-base font-semibold">{det.assunto}</h1>
        <div className="mt-3 flex items-start gap-3">
          {(() => {
            const avatar = (
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
            );
            // #478 rework: o avatar do remetente também abre o PersonHoverCard
            // (o nome ao lado já abre, via InsightsRemetentePopover) — consistência.
            return det.deEmail ? (
              <PersonHoverCard
                email={det.deEmail}
                fallback={{ nome: det.de, email: det.deEmail }}
              >
                {avatar}
              </PersonHoverCard>
            ) : (
              avatar
            );
          })()}
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
              <LinhaPessoas
                rotulo={t.controlRoom.para}
                nomes={det.para}
                emails={det.paraEmails}
              />
              <LinhaPessoas
                rotulo={t.controlRoom.ccLabel}
                nomes={det.cc}
                emails={det.ccEmails}
              />
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
        </ResizablePanel>
        {previewAtual && id && (
          <>
            <ResizableHandle withHandle className="print:hidden" />
            <ResizablePanel
              order={2}
              minSize={25}
              defaultSize={40}
              // #532: sem a cadeia de altura (flex/min-h-0/flex-col) o painel não
              // dava altura DEFINIDA ao card (h-full), então o corpo do preview
              // (flex-1 overflow-auto) crescia até o conteúdo e o overflow-hidden
              // do painel cortava embaixo (PDF/xlsx/imagem). Espelha o order=1.
              // #640: `print:hidden` — o preview de anexo não entra no impresso.
              className="flex min-h-0 min-w-0 flex-col overflow-hidden print:hidden"
            >
              {/* #496: preview num card à direita, fora do corpo do e-mail. */}
              <PreviewAnexo
                anexo={previewAtual}
                messageId={id}
                mailbox={mailbox}
                onSalvar={() => baixarAnexo(previewAtual)}
                onFechar={() => setPreviewAtual(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Reply / Reply all / Forward num Sheet lateral (como o New Mail): não
          corta a toolbar do compose e deixa o e-mail original visível atrás. A
          citação do original vai no envio (fluxo do backend). */}
      <Sheet
        open={modo !== null}
        onOpenChange={(o) => !o && !envioOcupado && fecharCompose()}
      >
        <SheetContent
          side="right"
          showCloseButton={!envioOcupado}
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
            <SheetDescription className="sr-only">
              {t.controlRoom.composeRespostaDescricao}
            </SheetDescription>
          </SheetHeader>
          {/* Composer (editável) em cima + a mensagem original como referência
              read-only embaixo, como todo mailclient. O original NÃO faz parte
              do editor (edRef), então o getHtml() sai só com a resposta e o
              backend segue anexando a citação limpa do Graph — sem duplicar. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                "min-h-0 flex-[3] overflow-hidden transition-opacity",
                envioOcupado && "opacity-60"
              )}
              aria-busy={envioOcupado}
              inert={envioOcupado ? true : undefined}
            >
              {modo && (
                <ComporMensagem
                  key={composeGeracao}
                  ref={comporRef}
                  mostrarDestinatarios={modo === "encaminhar"}
                  contextoAssinatura="resposta"
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
            <Button
              variant="ghost"
              onClick={fecharCompose}
              disabled={envioOcupado}
            >
              {t.controlRoom.cancelar}
            </Button>
            <Button onClick={enviar} disabled={envioOcupado}>
              {envioOcupado ? <Spinner className="size-4" /> : <Send />}
              {estadoUndoSend.fase === "pendente"
                ? preencher(t.controlRoom.envioPendente, {
                    n: estadoUndoSend.segundosRestantes,
                  })
                : estadoUndoSend.fase === "enviando"
                  ? t.controlRoom.enviandoAgora
                  : t.controlRoom.enviar}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
});



// ===========================================================================
// Tela
// ===========================================================================
