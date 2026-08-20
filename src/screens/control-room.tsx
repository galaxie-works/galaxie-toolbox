import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BridgeHeaderIcon } from "@/components/ui/icons/marca-anim";
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
import { BridgeSplit } from "@/components/bridge/bridge-split";
import { FolderSidebar } from "@/components/bridge/folder-sidebar";
import { MessageList, type FormatoSalvar } from "@/components/bridge/message-list";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ComporMensagem, type ComporMensagemHandle } from "@/components/compose/compor-mensagem";
import { NovaMensagemModal } from "@/components/compose/nova-mensagem-modal";
import { AgendaView } from "@/components/agenda/agenda-view";

import { PeopleView } from "@/components/people/people-view";
import { UniversalSearch } from "@/components/universal-search";
import { PersonHoverCard } from "@/components/people/person-hover-card";
// Ícones animados das pastas de e-mail (#494) — lucide-animated via registry.

import { toast } from "sonner";
import { toastIcone, toastDownload, toastMensagem } from "@/lib/toasts";
import * as api from "@/lib/api";
import { surfaceSuportada } from "@/lib/capabilities-surface";
import { CAIXA_PROPRIA, descricaoErroEnvio } from "@/lib/bridge-compose";
import { useFotos, configurarDominioFotos, configurarEscopoFotos } from "@/lib/fotos";

import { preencher, useIdioma } from "@/lib/idioma";

import { recursoOrgDisponivel } from "@/lib/tier";
import { useAppStore } from "@/store";
import { escopoDeFiltros } from "@/store/filters-slice";
import { tocarSomEscopo } from "@/lib/sons-notificacao";
import { useDebounce } from "@/hooks/use-debounce";
import { useUndoSend } from "@/hooks/use-undo-send";
import { CorpoMensagem } from "@/components/bridge/corpo-html";
import { EventoDialog } from "@/components/bridge/evento-dialog";
import { BotaoExcluir, IlustracaoCards, type PastaDestino } from "@/components/bridge/message-shared";
import { rotuloPasta } from "@/lib/pastas-email";
import { cn, comLoginHint } from "@/lib/utils";
import type {
  AnexoEmail,
  AppUser,
  EmailDetalhe,
  EmailItem,
  PastaEmail,
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
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTypingTarget } from "@/hooks/use-atalhos";

/** #109 removeu o esconder-escopo em 400; a coleção canônica permanece vazia. */
const FILTROS_OCULTOS = new Set<string>();

import { comZ, quandoCurto } from "@/lib/data-email";
import { logErro } from "@/lib/log";


// #640 (re-spec): a impressão saiu do front. O `window.print()` de um iframe cai
// no diálogo LEGADO do Windows (Win32); o PO quer o PREVIEW do Chromium. Isso só
// vem do COM nativo `ICoreWebView2_16::ShowPrintUI(BROWSER)`, feito no backend
// (`cr_imprimir_email`, reusa `compor_html` + a engine de janela do #639). O front
// agora só dispara o comando — ver `imprimir()` no ControlRoomScreen.

// --- empty states (reui c-empty-15 / c-empty-20) ---------------------------

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

function descricaoErroEscrita(
  erro: unknown,
  t: ReturnType<typeof useIdioma>["t"]
) {
  const detalhe = String(erro);
  return /\b403\b|sem permissão|permission/i.test(detalhe)
    ? t.controlRoom.caixaSemPermissaoEscrita
    : detalhe;
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


// ===========================================================================
// Painel 1 — pastas
// ===========================================================================

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
 * Dialog "Adicionar caixa compartilhada" (#111). Valida o endereço na hora via
 * `api.crValidarCaixa` (GET /users/{addr}/mailFolders/inbox no backend): 200
 * adiciona; 403 → "você não tem acesso a essa caixa"; 404 → "endereço não
 * encontrado"; precisa_relogin → "faça login novamente" (escopo Mail.Read.Shared
 * novo na SCOPES, ainda fora do token da sessão atual).
 */
function DialogAdicionarCaixa({
  existentes,
  avisoRelogin,
  onAdicionada,
  onFechar,
  t,
}: {
  existentes: string[];
  /** Token atual sem Mail.Read.Shared: mostra o aviso de relogin já ao abrir. */
  avisoRelogin: boolean;
  onAdicionada: (endereco: string) => void;
  onFechar: () => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const [endereco, setEndereco] = useState("");
  const [validando, setValidando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const limpo = endereco.trim().toLowerCase();
  // Validação de forma no cliente (o backend revalida): reduz idas ao Graph.
  const pareceEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);

  async function confirmar() {
    if (!pareceEmail) {
      setErro(t.controlRoom.caixaEnderecoInvalido);
      return;
    }
    if (existentes.includes(limpo)) {
      setErro(t.controlRoom.caixaJaAdicionada);
      return;
    }
    setValidando(true);
    setErro(null);
    try {
      const r = await api.crValidarCaixa(limpo);
      if (r.status === "ok") {
        onAdicionada(r.endereco);
        toast.success(preencher(t.controlRoom.caixaAdicionada, { addr: r.endereco }));
        onFechar();
      } else if (r.status === "sem_acesso") {
        setErro(t.controlRoom.caixaSemAcesso);
      } else if (r.status === "nao_encontrado") {
        setErro(t.controlRoom.caixaNaoEncontrada);
      } else {
        setErro(t.controlRoom.caixaRelogin);
      }
    } catch {
      setErro(t.controlRoom.caixaErro);
    } finally {
      setValidando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !validando) onFechar();
      }}
    >
      <DialogContent className="max-w-sm!">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!validando) confirmar();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.controlRoom.caixaDialogTitulo}</DialogTitle>
            <DialogDescription>{t.controlRoom.caixaDialogDesc}</DialogDescription>
          </DialogHeader>
          {avisoRelogin ? (
            <Alert variant="warning" className="mt-2">
              <TriangleAlert />
              <AlertDescription>{t.controlRoom.caixaRelogin}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2 py-4">
            <Label htmlFor="caixa-endereco">{t.controlRoom.caixaEnderecoRotulo}</Label>
            <Input
              id="caixa-endereco"
              type="email"
              autoFocus
              value={endereco}
              onChange={(e) => {
                setEndereco(e.target.value);
                setErro(null);
              }}
              placeholder={t.controlRoom.caixaEnderecoPlaceholder}
              disabled={validando}
              aria-invalid={erro !== null}
              aria-describedby={erro ? "caixa-endereco-erro" : undefined}
            />
            {erro !== null ? (
              <p id="caixa-endereco-erro" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onFechar}
              disabled={validando}
            >
              {t.controlRoom.cancelar}
            </Button>
            <Button type="submit" disabled={!pareceEmail || validando}>
              {validando ? (
                <>
                  <Spinner className="size-4" /> {t.controlRoom.caixaValidando}
                </>
              ) : (
                t.controlRoom.caixaAdicionarConfirmar
              )}
            </Button>
          </DialogFooter>
        </form>
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

const MessageDetail = forwardRef<
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
            <ResizableHandle
              withHandle
              className="mx-1.5 bg-transparent hover:bg-border print:hidden"
            />
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

export function ControlRoomScreen({
  user,
  onAbrirLink,
  onGrantPeopleAccess,
  onReauthenticate,
  ativo = true,
  emAba = false,
}: {
  user: AppUser;
  onAbrirLink: (url: string) => void;
  onGrantPeopleAccess: () => void;
  onReauthenticate: () => void;
  /** #454: Bridge é a tela ATIVA? Repassado ao MessageList pra só instalar o
   * atalho global de teclado quando o Bridge está em primeiro plano (ele fica
   * montado/escondido em keep-alive). */
  ativo?: boolean;
  /** #868: hospedada numa ABA interna do Navigator? A aba já dá a identidade
   * (ícone + nome "Bridge"), então o hero redundante (ícone + título + subtítulo)
   * do content area some — regra do host de aba, generaliza o que o #854 fez no
   * Files. Render standalone (default `false`) mantém o hero do #490. */
  emAba?: boolean;
}) {
  const { idioma, t } = useIdioma();
  // Fotos de contatos (#39): só buscamos avatar de remetente do MESMO domínio do
  // tenant (o do usuário logado). Configura o domínio do cache aqui.
  // #712 (PS6 follow-on): fotos de remetentes internos são feature de ORG — no
  // tier pessoal/uncontracted desliga o domínio (null) → tudo cai nas iniciais.
  useEffect(() => {
    configurarDominioFotos(recursoOrgDisponivel(user) ? user.email : null);
  }, [user]);
  const bridgeView = useAppStore((s) => s.bridgeView);
  const setBridgeView = useAppStore((s) => s.setBridgeView);
  // Caixas compartilhadas (#111): lista de endereços adicionados (persistida) +
  // qual está ativa. A #112 usa este endereço em todas as leituras do Graph;
  // `me` continua sendo o default e a seleção ativa segue só nesta sessão.
  // Caixas compartilhadas migradas pro mailbox slice (#125). Chave
  // `bridge.caixasCompartilhadas` preservada; seletor assina só este campo.
  const caixasCompartilhadas = useAppStore((s) => s.caixasCompartilhadas);
  const setCaixasCompartilhadas = useAppStore((s) => s.setCaixasCompartilhadas);
  // Cache de sessão por pasta (#108): restaurar mensagens+paginação ao voltar
  // pra uma pasta em vez de refetch. Ações são estáveis (Zustand); a leitura do
  // cache é feita via getState() dentro do efeito pra NÃO re-disparar a carga a
  // cada escrita no cache (não entra nas deps do efeito).
  const setCachePasta = useAppStore((s) => s.setCachePasta);
  const atualizarCachePasta = useAppStore((s) => s.atualizarCachePasta);
  const limparCachePasta = useAppStore((s) => s.limparCachePasta);
  // Carga de mailbox/lista (#155): estado de sessão nas slices canônicas. Só a
  // lista de caixas compartilhadas persiste; os dados abaixo ficam fora do
  // partialize e não duplicam fonte no root do control-room.
  const caixaAtiva = useAppStore((s) => s.caixaAtiva);
  const setCaixaAtiva = useAppStore((s) => s.setCaixaAtiva);
  const pastas = useAppStore((s) => s.pastas);
  const setPastas = useAppStore((s) => s.setPastas);
  const subpastas = useAppStore((s) => s.subpastas);
  const setSubpastas = useAppStore((s) => s.setSubpastas);
  const recargaPastas = useAppStore((s) => s.recargaPastas);
  const setRecargaPastas = useAppStore((s) => s.setRecargaPastas);
  const pastaSel = useAppStore((s) => s.pastaSel);
  const setPastaSel = useAppStore((s) => s.setPastaSel);
  const mensagens = useAppStore((s) => s.mensagens);
  const setMensagens = useAppStore((s) => s.setMensagens);
  const caixaDados = useAppStore((s) => s.caixaDados);
  const setCaixaDados = useAppStore((s) => s.setCaixaDados);
  const recarga = useAppStore((s) => s.listaRecarga);
  const setRecarga = useAppStore((s) => s.setListaRecarga);
  const temMais = useAppStore((s) => s.temMais);
  const setTemMais = useAppStore((s) => s.setTemMais);
  const carregandoMais = useAppStore((s) => s.carregandoMais);
  const setCarregandoMais = useAppStore((s) => s.setCarregandoMais);
  const [adicionarCaixaAberto, setAdicionarCaixaAberto] = useState(false);
  // O token atual traz Mail.Read.Shared? Falso ⇒ sinaliza relogin (escopo novo
  // na SCOPES; sem consent admin — já concedido, ver AGENTS.md §1.1).
  const [sharedEscopoOk, setSharedEscopoOk] = useState(true);
  const [sharedEnvioEscopoOk, setSharedEnvioEscopoOk] = useState(false);
  useEffect(() => {
    let vivo = true;
    api
      .crMailSharedDisponivel()
      .then((ok) => {
        if (vivo) setSharedEscopoOk(ok);
      })
      .catch(() => {
        /* falha ao checar leitura/escrita: não trava a UI, assume ok */
      });
    api
      .crMailSendSharedDisponivel()
      .then((ok) => {
        if (vivo) setSharedEnvioEscopoOk(ok);
      })
      .catch(() => {
        /* envio compartilhado permanece bloqueado sem confirmação do escopo */
      });
    return () => {
      vivo = false;
    };
  }, []);
  const caixaCompartilhadaAtiva = caixaAtiva !== CAIXA_PROPRIA;
  // Coalescing da troca de pasta (#87): a SELEÇÃO (`pastaSel`) muda na hora — o
  // sidebar já destaca a pasta clicada e o cabeçalho troca de nome —, mas as
  // CARGAS de rede (mensagens + contadores) seguem `pastaCarga`, a versão
  // debounced. Clicar 5 pastas em 1s NÃO dispara 5 cargas: só a pasta em que o
  // usuário parou é buscada. Debounce curto (180ms) pra não pesar ao navegar
  // rápido sem atrasar perceptivelmente uma troca isolada.
  const DEBOUNCE_PASTA_MS = 180;
  const pastaCarga = useDebounce(pastaSel, DEBOUNCE_PASTA_MS);
  // Seleção/ativa/âncora migradas para o selection slice (#128). São estado de
  // sessão e permanecem fora da persistência.
  const msgSel = useAppStore((s) => s.msgSel);
  const setMsgSel = useAppStore((s) => s.setMensagemAtiva);
  // #604: caminho canônico de abrir mensagem (mesmo do clique na lista — seta
  // msgSel + ancoraSelecao). Usado pelo clique no corpo do toast de e-mail novo.
  const selecionarMensagem = useAppStore((s) => s.selecionarMensagem);
  const selecionados = useAppStore((s) => s.selecionados);
  const limparSelecao = useAppStore((s) => s.limparSelecao);
  const removerDaSelecao = useAppStore((s) => s.removerDaSelecao);
  // Colapsos persistem (o app guarda o estado que o usuário deixa).
  // Sidebar migrada pro ui slice (#126). Chave `bridge.sidebar` preservada.
  const sidebarAberta = useAppStore((s) => s.sidebarAberta);
  const setSidebarAberta = useAppStore((s) => s.setSidebarAberta);

  // Filters slice (#129): ordenação/filtros persistem nas chaves legadas; busca,
  // resultados e cursores são somente de sessão.
  const ordenar = useAppStore((s) => s.ordenar);
  const setOrdenar = useAppStore((s) => s.setOrdenar);
  const ordemDesc = useAppStore((s) => s.ordemDesc);
  const filtros = useAppStore((s) => s.filtros);
  const setFiltros = useAppStore((s) => s.setFiltros);
  const busca = useAppStore((s) => s.busca);
  const setBusca = useAppStore((s) => s.setBusca);
  const resultadosBusca = useAppStore((s) => s.resultadosBusca);
  const temMaisBusca = useAppStore((s) => s.temMaisBusca);
  const resultadosFiltro = useAppStore((s) => s.resultadosFiltro);
  const temMaisFiltro = useAppStore((s) => s.temMaisFiltro);
  const cancelarBusca = useAppStore((s) => s.cancelarBusca);
  const cancelarFiltroGraph = useAppStore((s) => s.cancelarFiltroGraph);
  const limparConsultas = useAppStore((s) => s.limparConsultas);
  const buscarMensagens = useAppStore((s) => s.buscarMensagens);
  const filtrarMensagens = useAppStore((s) => s.filtrarMensagens);
  const carregarMaisBuscaStore = useAppStore((s) => s.carregarMaisBusca);
  const carregarMaisFiltroStore = useAppStore((s) => s.carregarMaisFiltro);
  const mutarResultados = useAppStore((s) => s.mutarResultados);
  const removerDosResultados = useAppStore((s) => s.removerDosResultados);
  // Migração: sorts removidos do escopo (tamanho/importancia/flag — #60) que
  // ficaram no localStorage voltam pra "data", evitando estado inconsistente.
  useEffect(() => {
    if (!["data", "remetente", "assunto"].includes(ordenar as string)) setOrdenar("data");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Preferência de "marcar como lido" (#95), persistida: o app sempre guarda o
  // estado que o usuário deixa. Default = "imediato" (comportamento histórico).
  // Marcar-lido (#95) migrado pro ui slice (#126). Chaves `bridge.marcarLidoModo`
  // e `bridge.marcarLidoAtraso` preservadas; validação de valores fora-da-faixa
  // segue no efeito abaixo (localStorage é editável por fora).
  const marcarLidoModo = useAppStore((s) => s.marcarLidoModo);
  const setMarcarLidoModo = useAppStore((s) => s.setMarcarLidoModo);
  const marcarLidoAtraso = useAppStore((s) => s.marcarLidoAtraso);
  const setMarcarLidoAtraso = useAppStore((s) => s.setMarcarLidoAtraso);
  // localStorage é editável por fora (e pode ter sobra de versões antigas):
  // valor inválido volta ao padrão em vez de virar um timer NaN/eterno.
  useEffect(() => {
    if (!MARCAR_LIDO_MODOS.includes(marcarLidoModo)) setMarcarLidoModo("imediato");
    if (!MARCAR_LIDO_ATRASOS.includes(marcarLidoAtraso as (typeof MARCAR_LIDO_ATRASOS)[number]))
      setMarcarLidoAtraso(MARCAR_LIDO_ATRASO_PADRAO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const abrirCompose = useAppStore((s) => s.abrirCompose);
  const setComposePara = useAppStore((s) => s.setComposePara);
  // Handle do leitor para os atalhos r/a/f (#28) abrirem o Sheet de resposta.
  const detalheRef = useRef<MessageDetailHandle>(null);
  const filtroServidor = escopoDeFiltros(filtros);
  const filtroGraph = filtroServidor !== null;
  const carregandoMaisRef = useRef(false);
  // pasta atual (pra closures assíncronas que precisam do valor mais novo).
  const pastaSelRef = useRef(pastaSel);
  pastaSelRef.current = pastaSel;
  // Âncora de paginação: nº já buscado do servidor (skip). NÃO é mensagens.length
  // — a lista encolhe ao excluir, mas o skip do Graph continua avançando.
  const carregadosRef = useRef(0);
  // Refs espelhando o estado atual pra montar a chave de cache (#108) mesmo
  // dentro de closures assíncronas (poll, carregarMais) sem capturar valor velho.
  const caixaAtivaRef = useRef(caixaAtiva);
  caixaAtivaRef.current = caixaAtiva;
  const ordenarRef = useRef(ordenar);
  ordenarRef.current = ordenar;
  const ordemDescRef = useRef(ordemDesc);
  ordemDescRef.current = ordemDesc;
  // Espelho de `mensagens` pro carregarMais montar a lista concatenada a gravar
  // no cache sem depender de uma closure de valor antigo.
  const mensagensRef = useRef(mensagens);
  mensagensRef.current = mensagens;
  // Chave do cache de sessão da pasta (#108). Escopada por caixa ativa (#111) +
  // ordenação (#32) pra que caixa compartilhada e troca de sort não colidam.
  const chaveCache = useCallback(
    (pasta: string, caixa = caixaAtivaRef.current) =>
      `${caixa}|${pasta}|${ordenarRef.current}|${ordemDescRef.current}`,
    []
  );
  // Detecta se o efeito de carga foi disparado por refresh (recarga mudou) —
  // nesse caso invalida o cache e refaz o fetch em vez de restaurar (#108).
  const recargaAnteriorRef = useRef(recarga);
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

  // pastas (recarrega as contagens junto com as ações e no refresh manual)
  useEffect(() => {
    let vivo = true;
    setPastas(null);
    // #803: conta sem Outlook mail (ex.: Google) NÃO bate no MS Graph — mostra
    // vazio limpo em vez de martelar /me/mailFolders e tomar 401 em toda pasta.
    if (!surfaceSuportada(user, "mail")) {
      setPastas([]);
      return () => {
        vivo = false;
      };
    }
    api
      .crMailFolders(caixaAtiva)
      .then((p) => vivo && setPastas(p))
      .catch(() => vivo && setPastas([]));
    return () => {
      vivo = false;
    };
  }, [caixaAtiva, recarga, recargaPastas, setPastas, user]);

  // Cache de SUBPASTAS (childFolders), compartilhado pelo sidebar (expandir) e
  // pelo submenu "Mover para pasta…" (#88). Carrega sob demanda e memoriza; o
  // ref evita pedir duas vezes a mesma pasta (o sidebar e o submenu podem pedir
  // quase ao mesmo tempo).
  const subpastasPedidasRef = useRef<Set<string>>(new Set());
  const carregarSubpastas = useCallback(
    (id: string) => {
      if (subpastasPedidasRef.current.has(id)) return;
      subpastasPedidasRef.current.add(id);
      const caixaPedido = caixaAtiva;
      api
        .crSubpastas(id, caixaAtiva)
        .then((cs) => {
          if (caixaAtivaRef.current !== caixaPedido) return;
          setSubpastas((f) => ({ ...f, [id]: cs }));
        })
        .catch((e) => {
          if (caixaAtivaRef.current !== caixaPedido) return;
          setSubpastas((f) => ({ ...f, [id]: [] }));
          if (String(e).toLowerCase().includes("acesso parcial")) {
            toast.warning(t.controlRoom.caixaAcessoParcial);
          }
        });
    },
    [caixaAtiva, setSubpastas, t]
  );

  // Trocar de caixa é uma fronteira de dados: nenhuma seleção, paginação,
  // subpasta, busca ou cache de foto da caixa anterior pode aparecer na nova.
  useEffect(() => {
    configurarEscopoFotos(caixaAtiva);
    setSubpastas({});
    subpastasPedidasRef.current.clear();
    setPedirArvore(false);
    setPastaSel("inbox");
    setMensagens(null);
    setMsgSel(null);
    limparSelecao();
    limparConsultas();
    setTemMais(false);
    carregadosRef.current = 0;
    deletadasRef.current.clear();
    ultimoVistoRef.current = null;
  }, [
    caixaAtiva,
    limparConsultas,
    limparSelecao,
    setMensagens,
    setMsgSel,
    setPastaSel,
    setSubpastas,
    setTemMais,
  ]);

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
  const pastaCargaAcessoNegado =
    pastas?.some((p) => p.id === pastaCarga && p.leitura === "negado") ?? false;

  // Detecção central de e-mails novos na Inbox: compara o topo da lista com o
  // último visto e dispara o toast rico (c-sonner-9). Chamada tanto pelo poll
  // (usuário parado) QUANTO ao recarregar a lista da inbox (refresh manual).
  // Antes o refresh só resetava o baseline sem avisar — por isso o toast "não
  // aparecia" ao dar refresh depois de receber um e-mail (#43).
  const ultimoVistoRef = useRef<string | null>(null);
  const notificarNovos = useCallback(
    // Retorna quantos e-mails novos detectou (0 no baseline) — o poll usa isso
    // pra invalidar o cache da inbox só quando de fato chegou algo (#108).
    (ms: EmailItem[]): number => {
      if (ms.length === 0) return 0;
      // Baseline = o MAIOR recebido da lista, não ms[0]: com a inbox ordenável
      // (#32) o topo pode não ser o mais recente (ordem ≠ data / ascendente),
      // o que geraria toast espúrio/ausente no poll seguinte (#54).
      const maxRecebido = ms.reduce(
        (mx, m) => (m.recebido > mx ? m.recebido : mx),
        ms[0].recebido
      );
      const anterior = ultimoVistoRef.current;
      ultimoVistoRef.current = maxRecebido;
      if (anterior === null) return 0; // baseline: não avisa no 1º carregamento
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
          // #604: clicar no corpo do toast abre o e-mail no leitor, pelo mesmo
          // caminho do clique na lista (seleção + reader).
          onAbrir: () => {
            setPastaSel("inbox");
            selecionarMensagem(m.id);
          },
        });
      }
      return novos.length;
    },
    // idioma/t só mudam ao trocar idioma; as ações do store são estáveis.
    [idioma, selecionarMensagem, setMsgSel, setPastaSel, t]
  );

  // Poll leve da Inbox (pega e-mail novo enquanto o usuário está parado). O
  // intervalo é configurável em Settings > Bridge > Sync (#227); padrão 15 min
  // (comportamento histórico). Mudar a preferência remonta o efeito com o novo
  // intervalo. No mount NÃO chamamos — o efeito de mensagens já busca a inbox e
  // semeia o baseline; um fetch duplo aqui competia e o Graph estrangulava (429).
  const syncIntervalMinutes = useAppStore((s) => s.syncIntervalMinutes);
  useEffect(() => {
    let vivo = true;
    const INTERVALO = Math.max(1, syncIntervalMinutes) * 60 * 1000;
    const iv = setInterval(async () => {
      try {
        const msgs = await api.crFolderMensagens("inbox", 0, "data", true, "me");
        if (!vivo) return;
        const novos = notificarNovos(msgs);
        // #603: chegou e-mail novo enquanto o usuário estava parado. Antes só
        // invalidávamos o cache (#108) — mas a LISTA exibida não re-renderizava,
        // então o novo só aparecia ao clicar Refresh. Agora, se o usuário está
        // vendo justamente a inbox própria em data-desc sem busca/filtro (= o
        // que o poll buscou), PREPENDAMOS os novos na lista exibida + no cache,
        // sem resetar seleção/scroll (o MessageList reancora o scroll). Fora
        // desse caso, mantém o comportamento antigo: só invalida.
        if (novos > 0) {
          const st = useAppStore.getState();
          const espelhaInbox =
            pastaSelRef.current === "inbox" &&
            caixaAtivaRef.current === CAIXA_PROPRIA &&
            ordenarRef.current === "data" &&
            ordemDescRef.current === true &&
            st.caixaDados === CAIXA_PROPRIA &&
            st.busca.trim() === "" &&
            st.filtros.length === 0;
          const atuais = mensagensRef.current ?? [];
          const vistos = new Set(atuais.map((m) => m.id));
          const aPrepender = espelhaInbox
            ? msgs.filter(
                (m) => !vistos.has(m.id) && !deletadasRef.current.has(m.id)
              )
            : [];
          if (aPrepender.length > 0) {
            // Prepend na lista exibida (setter aceita Updater; preserva msgSel e
            // seleção, que são por id) e no cache da pasta (não invalida).
            setMensagens((prev) => [...aPrepender, ...(prev ?? [])]);
            atualizarCachePasta(chaveCache("inbox", "me"), (e) => ({
              mensagens: [...aPrepender, ...e.mensagens],
              carregados: e.carregados,
              temMais: e.temMais,
            }));
          } else if (!espelhaInbox) {
            // Usuário está noutra pasta/caixa/ordem/busca: só invalida pra
            // rebuscar ao voltar (comportamento #108).
            limparCachePasta(chaveCache("inbox", "me"));
          }
        }
      } catch {
        /* silencioso: é só o aviso de novos e-mails */
      }
    }, INTERVALO);
    return () => {
      vivo = false;
      clearInterval(iv);
    };
    // setMensagens/atualizarCachePasta são ações estáveis do store (#603); os
    // refs de pasta/caixa/ordem/mensagens são lidos por .current, fora das deps.
  }, [
    syncIntervalMinutes,
    notificarNovos,
    limparCachePasta,
    chaveCache,
    setMensagens,
    atualizarCachePasta,
  ]);

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
      const n = await api.crEsvaziarPasta(folderId, caixaAtiva);
      // #788: INVALIDA o cache da pasta esvaziada — senão a lista serve as
      // mensagens velhas (não atualiza) e, ao revisitar a pasta com IDs de
      // mensagens já deletadas, uma request falha e cai no toast de erro
      // ("That didn't go through"). Mesmo caminho que o Refresh manual usa; agora
      // a lista fica vazia na hora e a revisita rebusca do zero, sem erro.
      limparCachePasta(chaveCache(folderId));
      toast.success(preencher(t.controlRoom.pastaEsvaziada, { n }), { id: aviso });
      recarregarAposPasta(folderId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  // Marca como lidas todas as não lidas de uma pasta (#89). Pode demorar (loop
  // de PATCH no Graph), então mostra toast de progresso.
  async function marcarPastaLida(folderId: string) {
    const aviso = toast.loading(t.controlRoom.marcandoTodasLidas);
    try {
      const n = await api.crMarcarPastaLida(folderId, caixaAtiva);
      if (n === 0) toast.info(t.controlRoom.nenhumaNaoLida, { id: aviso });
      else toast.success(preencher(t.controlRoom.todasMarcadasLidas, { n }), { id: aviso });
      recarregarAposPasta(folderId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
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
    [carregarSubpastas, setRecargaPastas, setSubpastas]
  );

  async function criarSubpasta(paiId: string, nome: string) {
    const aviso = toast.loading(t.controlRoom.criandoSubpasta);
    try {
      const nova = await api.crCriarSubpasta(paiId, nome, caixaAtiva);
      toast.success(preencher(t.controlRoom.subpastaCriada, { pasta: nova.nome }), {
        id: aviso,
      });
      recarregarSubpastas(paiId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  async function renomearPasta(id: string, nome: string, paiId?: string) {
    const aviso = toast.loading(t.controlRoom.renomeandoPasta);
    try {
      const nova = await api.crRenomearPasta(id, nome, caixaAtiva);
      toast.success(preencher(t.controlRoom.pastaRenomeada, { pasta: nova.nome }), {
        id: aviso,
      });
      recarregarSubpastas(paiId);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
    }
  }

  async function excluirPasta(id: string, rotulo: string, paiId?: string) {
    const aviso = toast.loading(t.controlRoom.excluindoPasta);
    try {
      // `true` = foi pra Lixeira (reversível, o caminho normal); `false` = o
      // backend teve que cair no DELETE definitivo. O toast diz qual foi.
      const paraLixeira = await api.crExcluirPasta(id, caixaAtiva);
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
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
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
      const nova = await api.crMoverPasta(id, destino, caixaAtiva);
      toast.success(preencher(t.controlRoom.pastaMovida, { pasta: rotuloDestino }), {
        id: aviso,
      });
      recarregarSubpastas(paiId, destino);
      // O move do Graph devolve a pasta com id NOVO: se ela estava selecionada,
      // seguir com o id antigo deixaria a lista quebrada.
      if (pastaSelRef.current === id) setPastaSel(nova.id);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, {
        id: aviso,
        description: descricaoErroEscrita(e, t),
      });
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
    mutarResultados(fn);
    // Espelha no cache da pasta atual (#108): flag/lido não "voltam" ao retornar.
    atualizarCachePasta(chaveCache(pastaCarga), (e) => ({
      ...e,
      mensagens: e.mensagens.map(fn),
    }));
  };
  const removerNasListas = (ids: Set<string>) => {
    setMensagens((prev) => prev?.filter((m) => !ids.has(m.id)) ?? prev);
    removerDosResultados(ids);
    // Espelha a remoção no cache (#108): o item excluído/movido não reaparece ao
    // voltar. `carregados` (skip do Graph) é preservado de propósito.
    atualizarCachePasta(chaveCache(pastaCarga), (e) => ({
      ...e,
      mensagens: e.mensagens.filter((m) => !ids.has(m.id)),
    }));
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
    api.crMarcarLido(id, lido, caixaAtiva).catch((e) => {
      mutarNasListas((x) => (x.id === id ? { ...x, lido: !lido } : x));
      setPastas((prev) =>
        prev?.map((p) =>
          p.id === pastaSel ? { ...p, naoLidos: Math.max(0, p.naoLidos - delta) } : p
        ) ?? prev
      );
      toast.error(t.controlRoom.erroAcao, {
        description: descricaoErroEscrita(e, t),
      });
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

  async function acaoFlag(id: string, novo: boolean) {
    // otimista: pinta o item já nas duas listas.
    mutarNasListas((m) => (m.id === id ? { ...m, sinalizado: novo } : m));
    try {
      await api.crMarcarEmail(id, novo, caixaAtiva);
      toastIcone(
        novo ? t.controlRoom.flagAdicionada : t.controlRoom.flagRemovida,
        "",
        novo ? "marcado" : "desmarcado"
      );
    } catch (e) {
      // desfaz
      mutarNasListas((m) => (m.id === id ? { ...m, sinalizado: !novo } : m));
      toast.error(t.controlRoom.erroAcao, {
        description: descricaoErroEscrita(e, t),
      });
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

    // 1) OTIMISTA: tira da tela na hora (das duas listas) + marca como
    //    "deletada" (pro backfill não trazê-las de volta) + toast imediato.
    ids.forEach((id) => deletadasRef.current.add(id));
    removerNasListas(idsSet);
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
      let erro: unknown = null;
      try {
        // Dentro da própria Lixeira = exclusão definitiva; senão move pra Lixeira.
        ok = await api.crExcluirEmails(ids, pastaSel === "deleteditems", caixaAtiva);
      } catch (e) {
        erro = e;
        ok = [];
      } finally {
        clearInterval(pulso);
      }
      const falharam = ids.filter((id) => !ok.includes(id));
      if (falharam.length > 0) {
        falharam.forEach((id) => deletadasRef.current.delete(id));
        toast.error(t.controlRoom.erroAcao, {
          description: erro ? descricaoErroEscrita(erro, t) : undefined,
        });
        setRecarga((n) => n + 1); // ressincroniza lista + contagens do zero
      } else {
        setRecargaPastas((x) => x + 1); // reconcilia contagens reais
        if (pastaSelRef.current === "deleteditems") setRecarga((x) => x + 1);
      }
    })();
  }

  /**
   * #636 (épico #635): "Salvar como…" — abre o seletor de pasta do sistema e
   * chama o backend POR FORMATO (contrato do #637: `SalvarEmailResultado` com
   * `salvos`/`falhas`). `.eml` já é real (#637); PDF/.msg são stub em S1 (#639/
   * #638). Sucesso → toast com "Abrir pasta"; falha parcial → um toast por item.
   */
  async function salvarComo(ids: string[], formato: FormatoSalvar) {
    if (ids.length === 0) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const pasta = await open({
        directory: true,
        title: t.controlRoom.escolherPasta,
      });
      if (typeof pasta !== "string") return; // cancelou o diálogo
      const res =
        formato === "eml"
          ? await api.crSalvarEmailEml(ids, pasta, caixaAtiva)
          : await api.crSalvarEmailPdf(ids, pasta, caixaAtiva);
      if (res.salvos.length > 0) {
        toast.success(
          preencher(t.controlRoom.salvarSucesso, {
            n: res.salvos.length,
            pasta,
          }),
          {
            action: {
              // Alinhado com o #637 (Confucius): revela o 1º arquivo salvo no
              // Explorer (mesmo padrão do toastDownload), não só abre a pasta.
              label: t.controlRoom.abrirPasta,
              onClick: () => void api.revelarNoExplorer(res.salvos[0]),
            },
          }
        );
      }
      // Falha parcial (#637): um toast de erro por item que não salvou.
      res.falhas.forEach((f) =>
        toast.error(preencher(t.controlRoom.salvarErroItem, { assunto: f.assunto }), {
          description: f.erro,
        })
      );
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
  }

  /**
   * #640 (re-spec): "Imprimir" — abre o PREVIEW do Chromium (não o diálogo legado
   * Win32) sobre o e-mail ABERTO no leitor. O backend `cr_imprimir_email` reusa o
   * `compor_html` + a engine de janela do #639 e chama o COM `ShowPrintUI(BROWSER)`
   * numa janela visível com só o e-mail. Escopo = e-mail em leitura (`msgSel`);
   * sem e-mail aberto não faz nada (o item do menu já fica desabilitado).
   */
  async function imprimir() {
    const msgSel = useAppStore.getState().msgSel;
    if (!msgSel) return;
    try {
      await api.crImprimirEmail([msgSel], caixaAtiva);
    } catch (e) {
      toast.error(t.controlRoom.erroAcao, { description: String(e) });
    }
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

    // 1) OTIMISTA: tira da tela e marca como "saiu daqui" (mesmo registro que o
    //    excluir usa) pra o backfill/paginação não trazer as mensagens de volta.
    ids.forEach((id) => deletadasRef.current.add(id));
    removerNasListas(idsSet);
    // Invalida o cache do DESTINO (#108): a lista de lá agora está desatualizada
    // (ganhou estes itens) — força rebusca na próxima visita em vez de servir stale.
    limparCachePasta(chaveCache(destino));
    removerDaSelecao(ids);

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
    let erro: unknown = null;
    try {
      ok = await api.crMoverEmails(ids, destino, caixaAtiva);
    } catch (e) {
      erro = e;
      ok = [];
    }
    const falharam = ids.filter((id) => !ok.includes(id));
    if (falharam.length > 0) {
      falharam.forEach((id) => deletadasRef.current.delete(id));
      toast.error(t.controlRoom.erroAcao, {
        description: erro ? descricaoErroEscrita(erro, t) : undefined,
      });
      setRecarga((n) => n + 1); // ressincroniza lista + contagens do zero
    } else {
      setRecargaPastas((x) => x + 1); // reconcilia as contagens reais
    }
  }

  // mensagens da pasta (1ª página); auto-seleciona a primeira e semeia o
  // baseline do polling quando é a inbox.
  //
  // #108: cache de sessão por pasta. Ao VOLTAR pra uma pasta já carregada
  // (troca de pasta, sem refresh), RESTAURA mensagens + paginação do cache SEM
  // refetch — preserva as páginas roladas e não repete requests ao Graph. Um
  // refresh (recarga muda) invalida o cache e refaz o fetch (dados frescos).
  useEffect(() => {
    if (pastaCarga !== pastaSel) return;
    let vivo = true;
    const chave = chaveCache(pastaCarga);
    // Refresh manual/ressincronização mudou `recarga`: invalida e refaz o fetch.
    const refreshForcado = recargaAnteriorRef.current !== recarga;
    recargaAnteriorRef.current = recarga;
    const store = useAppStore.getState();
    if (refreshForcado) store.limparCachePasta(chave);
    const cacheEntry = refreshForcado ? undefined : store.cachePastas[chave];

    // Comum às duas vias: troca de pasta zera seleção e busca.
    limparSelecao();
    setBusca("");
    carregandoMaisRef.current = false;
    deletadasRef.current = new Set();

    // A pasta continua visível no sidebar para explicar o acesso parcial, mas
    // não insistimos em novos requests que o Graph já informou que serão 403.
    if (pastaCargaAcessoNegado) {
      carregadosRef.current = 0;
      setMensagens([]);
      setCaixaDados(caixaAtiva);
      setTemMais(false);
      setMsgSel(null);
      return () => {
        vivo = false;
      };
    }

    // VIA RESTAURAÇÃO: cache tem a pasta → repõe sem null-flash e sem rede.
    if (cacheEntry) {
      carregadosRef.current = cacheEntry.carregados;
      setMensagens(cacheEntry.mensagens);
      setCaixaDados(caixaAtiva);
      setTemMais(cacheEntry.temMais);
      const ativa = store.msgSel;
      store.setMensagemAtiva(
        ativa && cacheEntry.mensagens.some((m) => m.id === ativa)
          ? ativa
          : (cacheEntry.mensagens[0]?.id ?? null)
      );
      return () => {
        vivo = false;
      };
    }

    // VIA FETCH: cache vazio (1ª visita ou invalidado) → busca página 0 e semeia.
    setMensagens(null);
    setTemMais(false);
    carregadosRef.current = 0;
    api
      .crFolderMensagens(pastaCarga, 0, ordenar, ordemDesc, caixaAtiva)
      .then((ms) => {
        if (!vivo) return;
        carregadosRef.current = ms.length;
        setMensagens(ms);
        setCaixaDados(caixaAtiva);
        // mantém a mensagem já selecionada se ela existir na lista nova (ex.:
        // clicar "Responder" num toast já selecionou a msg antes do fetch);
        // senão pega a primeira.
        const selecao = useAppStore.getState();
        selecao.setMensagemAtiva(
          selecao.msgSel && ms.some((m) => m.id === selecao.msgSel)
            ? selecao.msgSel
            : (ms[0]?.id ?? null)
        );
        const tem = ms.length === PAGINA;
        setTemMais(tem);
        // Semeia o cache da pasta com a 1ª página (#108).
        setCachePasta(chave, { mensagens: ms, carregados: ms.length, temMais: tem });
        // Inbox: detecta e avisa e-mails novos (também no refresh manual). SÓ
        // quando a lista está em DATA-DESC — aí `ms` está com o mais novo no
        // topo e o baseline (max recebido) é confiável. Em outra ordem (ex.:
        // data-asc), a 1ª página não contém o mais novo, o baseline ficaria
        // baixo e o poll seguinte dispararia toast espúrio (#54). Nesses casos
        // o poll (que SEMPRE busca date-desc) mantém o baseline sozinho. #43
        if (pastaCarga === "inbox" && ordenar === "data" && ordemDesc) notificarNovos(ms);
      })
      .catch(() => {
        if (!vivo) return;
        setMensagens([]);
        setCaixaDados(caixaAtiva);
      });
    return () => {
      vivo = false;
    };
    // notificarNovos é estável (useCallback [idioma,t]); fora das deps de
    // propósito pra não recarregar a lista ao trocar idioma. ordenar/ordemDesc
    // ENTRAM: trocar a ordenação re-busca a lista já ordenada pelo Graph (#32).
    // pastaCarga (debounced) no lugar de pastaSel: coalesce a troca rápida (#87).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    caixaAtiva,
    pastaCarga,
    pastaSel,
    pastaCargaAcessoNegado,
    recarga,
    ordenar,
    ordemDesc,
  ]);

  // Pré-carga: busca a próxima página do servidor pela âncora (skip = já
  // buscado, não o tamanho da lista) e concatena deduplicando. Serve tanto pro
  // scroll (90%) quanto pro backfill pós-exclusão.
  async function carregarMais() {
    if (carregandoMaisRef.current || !temMais) return;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    const caixaPedido = caixaAtiva;
    try {
      const pagina = await api.crFolderMensagens(
        pastaCarga,
        carregadosRef.current,
        ordenar,
        ordemDesc,
        caixaAtiva
      );
      if (caixaAtivaRef.current !== caixaPedido) return;
      carregadosRef.current += pagina.length; // avança pelo offset do servidor
      const proximo = juntar(mensagensRef.current ?? [], pagina);
      const tem = pagina.length === PAGINA;
      setMensagens(proximo);
      setTemMais(tem);
      // Persiste a página no cache da pasta (#108): ao voltar, a lista rolada
      // volta inteira sem refetch. Usa a chave da pasta que ESTÁ carregada.
      setCachePasta(chaveCache(pastaCarga), {
        mensagens: proximo,
        carregados: carregadosRef.current,
        temMais: tem,
      });
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
    if (!termo || filtroGraph || pastaCargaAcessoNegado) {
      cancelarBusca();
      return;
    }
    const id = setTimeout(() => {
      void buscarMensagens({
        pastaId: pastaSel,
        termo,
        caixa: caixaAtiva,
        ignorarIds: deletadasRef.current,
      });
    }, 300);
    return () => {
      clearTimeout(id);
      cancelarBusca();
    };
  }, [
    busca,
    buscarMensagens,
    caixaAtiva,
    cancelarBusca,
    filtroGraph,
    pastaCargaAcessoNegado,
    pastaSel,
  ]);

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
  // e pagina pela continuação no filters slice. Fora deles, invalida a consulta.
  useEffect(() => {
    if (!filtroServidor || pastaCargaAcessoNegado) {
      cancelarFiltroGraph();
      return;
    }
    void filtrarMensagens({
      pastaId: pastaSel,
      escopo: filtroServidor,
      caixa: caixaAtiva,
      ignorarIds: deletadasRef.current,
    });
    return cancelarFiltroGraph;
  }, [
    caixaAtiva,
    cancelarFiltroGraph,
    filtrarMensagens,
    filtroServidor,
    pastaSel,
    pastaCargaAcessoNegado,
    recarga,
  ]);

  // Paginação do filtro Graph via @odata.nextLink; dedup igual à busca.
  async function carregarMaisFiltro() {
    if (
      carregandoMaisRef.current ||
      !filtroServidor ||
      !temMaisFiltro ||
      pastaCargaAcessoNegado
    ) {
      return;
    }
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      await carregarMaisFiltroStore({
        pastaId: pastaSel,
        escopo: filtroServidor,
        caixa: caixaAtiva,
        ignorarIds: deletadasRef.current,
      });
    } finally {
      carregandoMaisRef.current = false;
      setCarregandoMais(false);
    }
  }

  // Paginação dos resultados de busca via @odata.nextLink (o Graph não aceita
  // $skip com $search); dedup igual à pasta.
  async function carregarMaisBusca() {
    const termo = busca.trim();
    if (
      carregandoMaisRef.current ||
      !termo ||
      !temMaisBusca ||
      pastaCargaAcessoNegado
    ) {
      return;
    }
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    try {
      await carregarMaisBuscaStore({
        pastaId: pastaSel,
        termo,
        caixa: caixaAtiva,
        ignorarIds: deletadasRef.current,
      });
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
  const dadosDaCaixaAtiva = caixaDados === caixaAtiva;
  const fonteListaAtiva = dadosDaCaixaAtiva ? fonteLista : null;
  const onCarregarMaisLista = filtroGraph
    ? carregarMaisFiltro
    : buscaAtiva
      ? carregarMaisBusca
      : carregarMais;
  const temMaisLista = filtroGraph ? temMaisFiltro : buscaAtiva ? temMaisBusca : temMais;

  const pastaAtual = pastas?.find((p) => p.id === pastaSel);
  const tituloLista = pastaAtual ? rotuloPasta(pastaAtual.tipo, pastaAtual.nome, t) : "";
  const msgAtual =
    fonteListaAtiva?.find((m) => m.id === msgSel) ??
    (dadosDaCaixaAtiva ? mensagens?.find((m) => m.id === msgSel) : undefined);

  // "Compose in Outlook" — comportamento atual (abre o Outlook interno).
  const composeOutlook = () =>
    api.abrirAppInterno(
      "outlook",
      comLoginHint("https://outlook.office.com/mail/deeplink/compose", user.email),
      "Outlook"
    );
  // "New mail" — abre o nosso composer em modal.
  const novoEmailModal = () => abrirCompose("novo", caixaAtiva);

  // #490 (rework após feedback do PO): o header do conteúdo do Bridge é
  // CONSTANTE nos 3 módulos — sempre título "Bridge" (nav.controlRoom) +
  // subtítulo fixo. O que muda ao alternar E-mail/Contatos/Calendário é o
  // BREADCRUMB, não este header. (Antes o header trocava por módulo e o mail
  // ficou sem subtítulo — o PO rejeitou os dois: quer o header fixo e o
  // subtítulo de volta com copy melhor.)
  const tituloModulo = t.nav.controlRoom;
  const subtituloModulo = t.controlRoom.bridgeSubtitulo;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Cabeçalho — ícone animado do Bridge + título do módulo ativo (#231).
          #868: escondido quando hospedado em aba interna (a própria aba já
          identifica o Bridge com ícone + nome) → o content area começa direto no
          conteúdo. Standalone (fora de aba) mantém o hero pedido pelo PO no #490. */}
      {!emAba && (
        <div className="flex shrink-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <BridgeHeaderIcon className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{tituloModulo}</h1>
            <p className="text-sm text-muted-foreground">{subtituloModulo}</p>
          </div>
        </div>
      )}

      {/* #912: sidebar e conteudo agora sao PAINEIS, com splitter entre eles.
          O `gap-4` saiu de proposito: com folga no meio, a `border-r` do
          sidebar ficava solta no vao em vez de ser a divisoria que o card
          pede. O botao de colapsar continua sendo o mesmo, mandando na store;
          o painel obedece — e avisa de volta se quem colapsar for o arrasto. */}
      <BridgeSplit
        colapsada={!sidebarAberta}
        onColapsadaMudou={(c) => setSidebarAberta(!c)}
        sidebar={
          <FolderSidebar
          pastas={pastas}
          subpastas={subpastas}
          onCarregarSubpastas={carregarSubpastas}
          sel={pastaSel}
          onSel={(id) => {
            setBridgeView("mail");
            setPastaSel(id);
          }}
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
          caixas={caixasCompartilhadas}
          caixaAtiva={caixaAtiva}
          emailProprio={user.email}
          onSelecionarCaixa={(caixa) => {
            setBridgeView("mail");
            setCaixaAtiva(caixa);
          }}
          onAbrirAdicionarCaixa={() => setAdicionarCaixaAberto(true)}
          caixaCompartilhada={caixaCompartilhadaAtiva}
          colapsada={!sidebarAberta}
          onToggleSidebar={() => setSidebarAberta((aberta) => !aberta)}
          bridgeView={bridgeView}
          onSelectModule={(view) => {
            setBridgeView(view);
          }}
          t={t}
        />
        }
      >

        {/* #1065: busca do Bridge REMONTADA no toolbar do conteúdo (OPÇÃO A).
            O #876 orfanou o UniversalSearch ao tirar o mount da title bar; aqui
            ele volta como topo da coluna de conteúdo, ao lado do FolderSidebar.
            O atalho "/" (que já mira [data-universal-search-input]) e o Esc
            round-trip passam a funcionar. A coluna é flex-col/flex-1 e o
            view-switch abaixo mantém min-h-0/flex-1 pra preencher a altura. */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="shrink-0">
            <UniversalSearch
              tela="control-room"
              screenLabel={t.nav.controlRoom}
              bridgeView={bridgeView}
            />
          </div>
          {bridgeView === "people" ? (
          <PeopleView
            userEmail={user.email}
            onGrantAccess={onGrantPeopleAccess}
            onReauthenticate={onReauthenticate}
            onCompose={(email) => {
              abrirCompose("novo", caixaAtiva);
              setComposePara([email]);
            }}
          />
        ) : bridgeView === "agenda" ? (
          <AgendaView />
        ) : (
          <ResizablePanelGroup
            autoSaveId="bridge.layout"
            direction="horizontal"
            className="min-w-0 flex-1 overflow-hidden"
          >
          <ResizablePanel defaultSize={38} minSize={24} maxSize={55} className="overflow-hidden">
            <MessageList
              ativo={ativo}
              titulo={tituloLista}
              mensagens={fonteListaAtiva}
              erroLeitura={
                pastaAtual?.leitura === "negado"
                  ? t.controlRoom.caixaAcessoParcial
                  : undefined
              }
              onRefresh={() => setRecarga((n) => n + 1)}
              pastaId={pastaSel}
              pastaTipo={pastaAtual?.tipo ?? ""}
              onEsvaziar={() => esvaziarPasta(pastaSel)}
              onCarregarMais={onCarregarMaisLista}
              carregandoMais={carregandoMais}
              temMais={temMaisLista}
              onFlag={acaoFlag}
              onExcluir={acaoExcluir}
              onMarcarLido={acaoMarcarLido}
              onSalvarComo={salvarComo}
              onImprimir={imprimir}
              onAbrirMaisAcoes={() => detalheRef.current?.abrirMaisAcoes()}
              pastasDestino={pastasDestino}
              pastasCarregando={arvorePendentes.length > 0}
              onAbrirMover={() => setPedirArvore(true)}
              onMover={acaoMover}
              filtrosOcultos={FILTROS_OCULTOS}
              onResponder={() => detalheRef.current?.responder()}
              onResponderTodos={() => detalheRef.current?.responderTodos()}
              onEncaminhar={() => detalheRef.current?.encaminhar()}
              onCompor={novoEmailModal}
              envioBloqueado={caixaCompartilhadaAtiva && !sharedEnvioEscopoOk}
              t={t}
              idioma={idioma}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5 bg-transparent hover:bg-border" />
          <ResizablePanel defaultSize={62} minSize={35} className="overflow-hidden">
            {dadosDaCaixaAtiva && selecionados.size > 0 ? (
              <MultiSelecaoContexto
                n={selecionados.size}
                onExcluir={() => acaoExcluir([...selecionados])}
                onLimpar={limparSelecao}
                t={t}
              />
            ) : (
              <MessageDetail
                ref={detalheRef}
                id={dadosDaCaixaAtiva ? msgSel : null}
                userEmail={user.email}
                mailbox={caixaAtiva}
                envioBloqueado={caixaCompartilhadaAtiva && !sharedEnvioEscopoOk}
                sinalizado={msgAtual?.sinalizado ?? false}
                lido={msgAtual?.lido ?? false}
                onFlag={acaoFlag}
                onExcluir={acaoExcluir}
                onMarcarLido={acaoMarcarLido}
                onSalvarComo={salvarComo}
                onImprimir={imprimir}
                onAbrirLink={onAbrirLink}
                onMudou={() => setRecargaPastas((n) => n + 1)}
                t={t}
                idioma={idioma}
              />
            )}
          </ResizablePanel>
          </ResizablePanelGroup>
        )}
        </div>
      </BridgeSplit>

      <EventoDialog userEmail={user.email} />
      <NovaMensagemModal
        caixas={caixasCompartilhadas}
        emailPessoal={user.email}
        sharedEnvioDisponivel={sharedEnvioEscopoOk}
      />

      {/* Dialog "Adicionar caixa compartilhada" (#111). Montado só quando abre
          (com `key`) pra nascer limpo. Se o token não traz Mail.Read.Shared,
          sinaliza relogin já ao abrir — sem travar (o backend também revalida). */}
      {adicionarCaixaAberto && (
        <DialogAdicionarCaixa
          key="adicionar-caixa"
          existentes={caixasCompartilhadas}
          avisoRelogin={!sharedEscopoOk}
          onAdicionada={(addr) => {
            setCaixasCompartilhadas((atual) =>
              atual.includes(addr) ? atual : [...atual, addr]
            );
            setCaixaAtiva(addr);
            if (!sharedEscopoOk) toast.warning(t.controlRoom.caixaRelogin);
          }}
          onFechar={() => setAdicionarCaixaAberto(false)}
          t={t}
        />
      )}
    </div>
  );
}
