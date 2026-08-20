import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BridgeHeaderIcon } from "@/components/ui/icons/marca-anim";
import { Badge } from "@/components/reui/badge";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { PreviewAnexo } from "@/components/bridge/preview-anexo";
import {
  ehItemAttachment,
  ehPrevisualizavel,
  ehReferenceAttachment,
} from "@/lib/anexo-tipo";
import {
  Filters,
  type FilterFieldConfig,
  type FilterOperator,
  type FilterOption,
} from "@/components/reui/filters";
import {
  DateSelector,
  formatDateValue,
  type DateSelectorValue,
} from "@/components/reui/date-selector";
import { montarFiltrosI18n, montarDateSelectorI18n } from "@/lib/reui-i18n";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Frame, FrameHeader, FrameTitle } from "@/components/reui/frame";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { BridgeSplit } from "@/components/bridge/bridge-split";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ContextMenuShortcut,
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcutAccessibleLabel, formatShortcut } from "@/components/ui/shortcut";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
// #1060: catálogo declarativo dos atalhos do Bridge (fonte única) — os tooltips/
// aria-labels das ações icon-only leem daqui, a MESMA fonte da ajuda "?".
import { shortcutBridge } from "@/components/atalhos-bridge";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  ComporMensagem,
  type ComporMensagemHandle,
} from "@/components/compose/compor-mensagem";
import { NovaMensagemModal } from "@/components/compose/nova-mensagem-modal";
import { AgendaView } from "@/components/agenda/agenda-view";
import { AgendaCalendarSelector } from "@/components/agenda/agenda-calendar-selector";
import { PeopleView } from "@/components/people/people-view";
import { UniversalSearch } from "@/components/universal-search";
import { PersonHoverCard } from "@/components/people/person-hover-card";
// Ícones animados das pastas de e-mail (#494) — lucide-animated via registry.
import { MailboxIcon } from "@/components/ui/mailbox";
import { CalendarDaysIcon } from "@/components/ui/calendar-days";
import { UsersIcon } from "@/components/ui/users";
import { SquarePenIcon } from "@/components/ui/square-pen";
import { ChevronDownIcon } from "@/components/ui/chevron-down";
import { SendIcon } from "@/components/ui/send";
import { ArchiveIcon } from "@/components/ui/archive";
import { DeleteIcon } from "@/components/ui/delete";
import { BadgeAlertIcon } from "@/components/ui/badge-alert";
import { FolderOpenIcon } from "@/components/ui/folder-open";
import { toast } from "sonner";
import { toastIcone, toastDownload, toastMensagem } from "@/lib/toasts";
import * as api from "@/lib/api";
import { surfaceSuportada } from "@/lib/capabilities-surface";
import {
  CAIXA_PROPRIA,
  descricaoErroEnvio,
} from "@/lib/bridge-compose";
import {
  montarConversasEmail,
  type ConversaEmail,
} from "@/lib/conversas-email";
import {
  useFotos,
  configurarDominioFotos,
  configurarEscopoFotos,
} from "@/lib/fotos";
import { useVirtualizer } from "@tanstack/react-virtual";
import { iniciais } from "@/lib/iniciais";
import { preencher, useIdioma } from "@/lib/idioma";
import { useTier } from "@/lib/tier-context";
import { recursoOrgDisponivel } from "@/lib/tier";
import { useAppStore } from "@/store";
import type { BridgeView } from "@/store/ui-slice";
import {
  desserializarDataFiltro,
  escopoDeFiltros,
  passaFiltrosClient,
  resolveIntervaloData,
  serializarDataFiltro,
} from "@/store/filters-slice";
import { tocarSomEscopo } from "@/lib/sons-notificacao";
import { scrollTopReancorado, type Ancora } from "@/lib/scroll-ancora";
import { useDebounce } from "@/hooks/use-debounce";
import { useUndoSend } from "@/hooks/use-undo-send";
import { CorpoMensagem } from "@/components/bridge/corpo-html";
import { EventoDialog } from "@/components/bridge/evento-dialog";
import { BotaoExcluir, SubmenuMover, type PastaDestino } from "@/components/bridge/message-shared";
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
  ArrowDownUp,
  AtSign,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ListFilter,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  FlagOff,
  FunnelX,
  FolderPlus,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Plus,
  Paperclip,
  Pencil,
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
  User,
  Users,
  Tag,
  UsersRound,
  Contact,
  X,
} from "lucide-react";
// #489: ícones de collapse do registry animate-ui (animados), por estado.
import { PanelLeftClose as PanelLeftCloseIcon } from "@/components/animate-ui/icons/panel-left-close";
import { PanelLeftOpen as PanelLeftOpenIcon } from "@/components/animate-ui/icons/panel-left-open";
import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtalhos, isTypingTarget, ehModPrincipal } from "@/hooks/use-atalhos";
import { AtalhosAjuda } from "@/components/atalhos-ajuda";

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

function PastaVazia({ t }: { t: ReturnType<typeof useIdioma>["t"] }) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia>
          <IlustracaoCards />
        </EmptyMedia>
        <EmptyTitle>
          <SoftBlurIn delay={80} stagger={18}>
            {t.controlRoom.semMensagensTitulo}
          </SoftBlurIn>
        </EmptyTitle>
        <EmptyDescription>{t.controlRoom.semMensagens}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

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

// #494: ícones ANIMADOS (lucide-animated) por tipo de well-known folder. Custom
// e subpastas caem no fallback FolderOpenIcon (ver `Ico` na Linha). Componentes
// do registry usados como vêm — animam no hover (stroke=currentColor herda a cor
// do container, tamanho pela prop `size`).
const ICONE_PASTA: Record<
  string,
  React.ComponentType<{ className?: string; size?: number }>
> = {
  inbox: MailboxIcon,
  drafts: SquarePenIcon,
  sentitems: SendIcon,
  archive: ArchiveIcon,
  junkemail: BadgeAlertIcon,
  deleteditems: DeleteIcon,
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

// ===========================================================================
// Caixas compartilhadas (#111) — seletor + dialog "Adicionar caixa…"
// ===========================================================================

/** Sentinela do item "Adicionar caixa…": nunca vira caixa ativa — só abre o
 *  dialog (o Select do Radix precisa de um `value` não-vazio no item). */
const CAIXA_ADICIONAR = "__adicionar__";

/**
 * Seletor de caixa no TOPO do sidebar do Bridge (#111). "Minha caixa" (/me) é o
 * padrão; abaixo, as caixas compartilhadas adicionadas; por fim "Adicionar
 * caixa…". Selecionar troca a caixa ativa; escolher "Adicionar…" abre o dialog.
 *
 * Nesta issue selecionar uma caixa compartilhada só TROCA o estado de caixa
 * ativa e a sinaliza (o próprio trigger mostra qual está ativa) — a listagem do
 * conteúdo dela é a #112. Colapsado, vira um ícone que abre o dialog direto.
 */
/** Avatar da caixa: foto do Graph (via cache de fotos #39) com fallback de
 *  iniciais. Sem foto / 404 / sem permissão → iniciais, sem erro visível (#493). */
function AvatarCaixa({
  email,
  foto,
  className,
}: {
  email: string;
  foto?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-5 shrink-0", className)}>
      {foto && <AvatarImage src={foto} alt="" />}
      <AvatarFallback className="text-[9px]">
        {iniciais(undefined, email)}
      </AvatarFallback>
    </Avatar>
  );
}

function SeletorCaixa({
  caixas,
  ativa,
  emailProprio,
  onSelecionar,
  onAdicionar,
  colapsada,
  t,
}: {
  caixas: string[];
  ativa: string;
  emailProprio: string;
  onSelecionar: (v: string) => void;
  onAdicionar: () => void;
  colapsada: boolean;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  // #493: foto das caixas (própria + compartilhadas) via o cache de fotos (#39).
  // Só e-mails internos viram request; 404/sem permissão degrada pra iniciais.
  const { getFoto, pedirFotos } = useFotos();
  useEffect(() => {
    pedirFotos([emailProprio, ...caixas]);
  }, [emailProprio, caixas, pedirFotos]);

  const emailAtivo = ativa === CAIXA_PROPRIA ? emailProprio : ativa;

  if (colapsada) {
    // Colapsada, o rótulo textual some: o e-mail da caixa ativa aparece por
    // tooltip canônico (#158). A `aria-label` (ação "Adicionar caixa…", o clique
    // abre o dialog) fica intacta; ring no avatar sinaliza caixa não-própria.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={onAdicionar}
            aria-label={t.controlRoom.caixaAdicionarItem}
          >
            <AvatarCaixa
              email={emailAtivo}
              foto={getFoto(emailAtivo)}
              className={cn(
                ativa !== CAIXA_PROPRIA && "ring-2 ring-primary ring-offset-1"
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" align="center">
          {emailAtivo}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Select
      value={ativa}
      onValueChange={(v) => {
        if (v === CAIXA_ADICIONAR) onAdicionar();
        else onSelecionar(v);
      }}
    >
      <SelectTrigger className="w-full" aria-label={t.controlRoom.caixaSeletor}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={CAIXA_PROPRIA}>
            <span className="flex items-center gap-2">
              <AvatarCaixa email={emailProprio} foto={getFoto(emailProprio)} />
              <span className="truncate">{emailProprio}</span>
            </span>
          </SelectItem>
          {caixas.map((c) => (
            <SelectItem key={c} value={c}>
              <span className="flex items-center gap-2">
                <AvatarCaixa email={c} foto={getFoto(c)} />
                <span className="truncate">{c}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value={CAIXA_ADICIONAR}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Plus className="size-4 shrink-0" />
            <span>{t.controlRoom.caixaAdicionarItem}</span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
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
  caixas,
  caixaAtiva,
  emailProprio,
  onSelecionarCaixa,
  onAbrirAdicionarCaixa,
  caixaCompartilhada,
  colapsada,
  onToggleSidebar,
  bridgeView,
  onSelectModule,
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
  /** Caixas compartilhadas adicionadas (#111), por endereço. */
  caixas: string[];
  /** Caixa ativa: CAIXA_PROPRIA (/me) ou um endereço de `caixas`. */
  caixaAtiva: string;
  /** E-mail da caixa própria (/me) — mostrado no lugar de "Minha caixa" (#493). */
  emailProprio: string;
  onSelecionarCaixa: (v: string) => void;
  onAbrirAdicionarCaixa: () => void;
  caixaCompartilhada: boolean;
  colapsada: boolean;
  onToggleSidebar: () => void;
  bridgeView: BridgeView;
  onSelectModule: (view: BridgeView) => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  // #712 (PS6 follow-on): caixa compartilhada é feature de ORG — no tier pessoal/
  // uncontracted o seletor de caixa some (só a caixa própria vale).
  const { recursoOrgDisponivel } = useTier();
  const peopleTab = useAppStore((state) => state.peopleTab);
  const setPeopleTab = useAppStore((state) => state.setPeopleTab);
  // #578: os grupos M365 seguem carregados aqui (loadPeopleGroups no mount do
  // módulo People), mas o RENDER deles migrou pro GroupsView (grid no painel) —
  // o bloco "My organization" + o dump de grupos no sidebar foram removidos.
  const peopleGroupsLoading = useAppStore(
    (state) => state.peopleGroupsLoading,
  );
  const peopleGroupsLoaded = useAppStore((state) => state.peopleGroupsLoaded);
  const loadPeopleGroups = useAppStore((state) => state.loadPeopleGroups);
  // #406: categorias do Outlook no sidebar de Contacts.
  const peopleCategorias = useAppStore((state) => state.peopleCategorias);
  const peopleSelectedCategory = useAppStore(
    (state) => state.peopleSelectedCategory,
  );
  const selectPeopleCategory = useAppStore(
    (state) => state.selectPeopleCategory,
  );
  useEffect(() => {
    if (
      bridgeView === "people" &&
      !peopleGroupsLoaded &&
      !peopleGroupsLoading
    ) {
      void loadPeopleGroups();
    }
  }, [
    bridgeView,
    loadPeopleGroups,
    peopleGroupsLoaded,
    peopleGroupsLoading,
  ]);
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
  const Modulo = ({
    view,
    rotulo,
    icon: Icon,
  }: {
    view: BridgeView;
    rotulo: string;
    // #491: ícones ANIMADOS (lucide-animated) — componente div-based com prop
    // `size` (não `className` p/ tamanho) e `stroke=currentColor`; animam no hover.
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }) => {
    const ativo = bridgeView === view;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={ativo ? "secondary" : "ghost"}
            onClick={() => onSelectModule(view)}
            aria-label={rotulo}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "shrink-0",
              colapsada ? "size-9 justify-center p-0" : "w-full justify-start gap-2.5",
              ativo
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            <Icon size={16} className="shrink-0" />
            {!colapsada && <span>{rotulo}</span>}
          </Button>
        </TooltipTrigger>
        {colapsada && (
          <TooltipContent side="right" align="center">
            {rotulo}
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

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
    // Custom/subpasta (tipo desconhecido) → folder-open animado (#494).
    const Ico = ICONE_PASTA[p.tipo] ?? FolderOpenIcon;
    const ativo = p.id === sel;
    // `contagem` é NÃO-LIDOS para inbox/junk/lixeira/custom; para drafts/sentitems
    // é o TOTAL de itens (não-lido não faz sentido em enviados/rascunhos).
    const contagemEhNaoLidos = p.tipo !== "drafts" && p.tipo !== "sentitems";
    const contagem = contagemEhNaoLidos ? p.naoLidos : p.total;
    // #1075 RB46-b: `acessoNegado: boolean` virou `leitura` de 3 estados. Um 500
    // ou queda de rede davam `false` + 0/0, e a pasta era desenhada VAZIA.
    const semAcesso = p.leitura === "negado";
    // Só `ok` autoriza exibir contador como fato. Em `indisponivel` a contagem
    // existe na struct (é 0), mas 0 aqui significa "não sei", não "vazio".
    const contagemEhFato = p.leitura === "ok";
    const rotulo = rotuloPasta(p.tipo, p.nome, t);
    const linhaBtn = (
      <button
        type="button"
        onClick={() => {
          if (semAcesso) {
            toast.warning(t.controlRoom.caixaAcessoParcial);
            return;
          }
          onSel(p.id);
        }}
        aria-disabled={semAcesso || undefined}
        aria-label={colapsada ? rotulo : undefined}
        // Colapsada: o nome vem pelo tooltip canônico (#100), não mais por
        // `title` nativo. `title` fica só para o aviso de acesso parcial.
        title={
          semAcesso
            ? t.controlRoom.caixaAcessoParcial
            : p.leitura === "indisponivel"
              ? t.controlRoom.pastaContagemIndisponivel
              : undefined
        }
        className={cn(
          "flex items-center rounded-md text-sm transition-colors",
          colapsada ? "relative size-9 justify-center" : "flex-1 gap-2.5 px-2.5 py-2",
          ativo ? "bg-secondary font-medium text-secondary-foreground" : "hover:bg-accent/50",
          semAcesso && "cursor-not-allowed opacity-50"
        )}
      >
        {colapsada ? (
          // Dot ancorado ao ÍCONE (não ao botão): com o ring na cor do card ele
          // fica dentro dos limites e o ScrollArea não corta (#37). O dot é
          // indicador de NÃO-LIDO: só aparece onde `contagem` são não-lidos —
          // nunca em drafts/sentitems (ali é o total, #56); Lixeira/Junk são
          // ruído → também sem dot.
          <span className="relative">
            <Ico size={16} className="shrink-0 text-muted-foreground" />
            {contagem > 0 &&
              contagemEhNaoLidos &&
              p.tipo !== "deleteditems" &&
              p.tipo !== "junkemail" && (
                <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-card" />
              )}
          </span>
        ) : (
          <>
            <Ico size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
            {(semAcesso || p.leitura === "indisponivel") && (
              <TriangleAlert className="size-3.5 shrink-0 text-warning" />
            )}
            {contagemEhFato && contagem > 0 && (
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
    const semAcoes =
      semAcesso || (!marcarLidas && !esvaziar && !criarSub && !custom);

    // Irmãs da pasta (para barrar nome duplicado antes de ir ao Graph): as
    // filhas do pai. Nas raízes, as próprias raízes.
    const irmas = (paiId ? (filhos[paiId] ?? []) : (pastas ?? [])).map((f) => f.nome);
    // Destinos válidos do "Mover pasta…": a árvore inteira MENOS a própria
    // pasta e suas descendentes (mover pra dentro de si mesma = ciclo).
    const proibidos = subarvoreIds(p.id, subpastas);
    const destinos = arvore.filter((d) => !proibidos.has(d.id));

    // `dica` (só na sidebar colapsada, #100): quando o rótulo textual está
    // oculto, o nome da pasta aparece por tooltip canônico. Mesmo aninhamento de
    // gatilhos do app-sidebar (Tooltip > TooltipTrigger asChild > MenuTrigger
    // asChild > botão); sem `dica` a árvore é idêntica à de antes.
    const comMenu = (conteudo: React.ReactNode, dica?: string) => (
      <ContextMenu>
        {dica ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild disabled={semAcoes}>
                {conteudo}
              </ContextMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              {dica}
            </TooltipContent>
          </Tooltip>
        ) : (
          <ContextMenuTrigger asChild disabled={semAcoes}>
            {conteudo}
          </ContextMenuTrigger>
        )}
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

    if (colapsada) return <div key={p.id}>{comMenu(linhaBtn, rotulo)}</div>;
    return (
      <div key={p.id}>
        {comMenu(
          <div className={cn("flex items-center", ehFilho && "pl-5")}>
            {/* chevron só quando a pasta realmente tem subpastas (childFolderCount > 0) */}
            {p.filhos > 0 ? (
              (() => {
                // Nome e tooltip do chevron comunicam o ESTADO (expandir vs
                // recolher), não só a pasta (#100) — a mesma string alimenta
                // `aria-label` e o tooltip canônico.
                const rotuloChevron = preencher(
                  expandidas.has(p.id)
                    ? t.controlRoom.recolherPasta
                    : t.controlRoom.expandirPasta,
                  { pasta: rotulo }
                );
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => alternarExpandir(p.id)}
                        aria-label={rotuloChevron}
                        className="grid size-5 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 transition-transform",
                            expandidas.has(p.id) && "rotate-90"
                          )}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center">
                      {rotuloChevron}
                    </TooltipContent>
                  </Tooltip>
                );
              })()
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
        // #912: borderless — sai o "card" (rounded-xl border bg-card) e entra a
        // divisória SÓ à direita (border-r) + o fundo de chrome do app (bg-muted/30,
        // o mesmo padrão in-content das rails do Navigator), destacando o sidebar do
        // content area. Splitter (resize) = follow-up (interage com o colapsar).
        // #912: a largura agora e do PAINEL (splitter), nao do `aside`. O que
        // era `w-64`/`w-16` virou `defaultSize`/`collapsedSize` no `BridgeSplit`
        // — a largura de 256px que o #466 escolheu a dedo (cabe "Caixa de
        // entrada" em pt sem truncar) esta la, em px, convertida na fatia do
        // grupo. Duas fontes de verdade pra mesma largura era o que fazia o
        // splitter brigar com o colapsar, e por isso ele tinha ficado de fora.
        "flex h-full w-full min-w-0 flex-col gap-3 border-r border-border bg-muted/30 p-3",
        colapsada && "items-center"
      )}
    >
      <div
        className={cn(
          "flex w-full shrink-0 items-center",
          colapsada ? "justify-center" : "justify-between"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSidebar}
              aria-label={colapsada ? t.sidebar.expand : t.sidebar.collapse}
            >
              {colapsada ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            {t.nav.alternarMenu}
          </TooltipContent>
        </Tooltip>
        {/* #492: "Novo e-mail" vira button-group (c-button-group-4) na MESMA
            linha do toggle, alinhado à direita. Só no módulo Mailbox e expandido
            (no colapsado o w-16 não cabe os dois → ícone empilhado abaixo). */}
        {!colapsada && bridgeView === "mail" && (
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onNovo}
                  aria-label={shortcutAccessibleLabel(
                    t.controlRoom.novoEmail,
                    ATALHO_COMPOR
                  )}
                >
                  <SquarePenIcon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {/* #538: New Mail é icon-only COM atalho (c) → ShortcutTooltip. */}
                <ShortcutTooltip
                  label={t.controlRoom.novoEmail}
                  shortcut={ATALHO_COMPOR}
                />
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              {/* Tooltip > DropdownMenu: dois gatilhos asChild no mesmo botão. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      aria-label={t.controlRoom.composeOutlook}
                    >
                      <ChevronDownIcon size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t.controlRoom.composeOutlook}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onComposeOutlook}>
                  {t.controlRoom.composeOutlook}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        )}
      </div>
      <Separator className={cn("shrink-0", colapsada && "w-6")} />

      {bridgeView === "mail" ? (
        <>
          {/* Seletor de caixa (#111): contexto do módulo Mailbox. Minha caixa
              (/me) é o padrão; caixas compartilhadas ficam abaixo.
              #712: só no tier org — feature de organização. */}
          {recursoOrgDisponivel && (
            <SeletorCaixa
              caixas={caixas}
              ativa={caixaAtiva}
              emailProprio={emailProprio}
              onSelecionar={onSelecionarCaixa}
              onAdicionar={onAbrirAdicionarCaixa}
              colapsada={colapsada}
              t={t}
            />
          )}
          {caixaCompartilhada && !colapsada ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t.controlRoom.caixaCompartilhadaDesc}
            </p>
          ) : null}

          {/* #492: no colapsado (w-16), só o ícone primário (square-pen) empilhado
              — o button-group completo com chevron mora no header quando expandido.
              A opção "Escrever no Outlook" fica acessível ao expandir. */}
          {colapsada && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onNovo}
                  aria-label={shortcutAccessibleLabel(
                    t.controlRoom.novoEmail,
                    ATALHO_COMPOR
                  )}
                >
                  <SquarePenIcon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" align="center">
                {/* #538: New Mail icon-only COM atalho (c) → ShortcutTooltip. */}
                <ShortcutTooltip
                  label={t.controlRoom.novoEmail}
                  shortcut={ATALHO_COMPOR}
                />
              </TooltipContent>
            </Tooltip>
          )}

          {!pastas ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="min-h-0 w-full flex-1">
              <div
                className={cn(colapsada ? "flex flex-col items-center gap-0.5" : "pr-2")}
              >
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
                    <div
                      className={cn("flex flex-col gap-0.5", colapsada && "items-center")}
                    >
                      {outras.map((p) => Linha(p))}
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </>
      ) : bridgeView === "people" ? (
        <ScrollArea className="min-h-0 w-full flex-1">
          <div className="flex w-full flex-col gap-3">
            <nav
              aria-label={t.controlRoom.peopleTitulo}
              className={cn(
                "flex w-full flex-col gap-0.5",
                colapsada && "items-center"
              )}
            >
              {(
                [
                  {
                    value: "contacts",
                    label: t.controlRoom.peopleContactsTab,
                    Icon: Users,
                  },
                  // #578: Groups vira item único de nav (não mais o dump de
                  // grupos no sidebar) — clicar abre o grid de grupos no painel.
                  {
                    value: "groups",
                    label: t.controlRoom.peopleGroupsSection,
                    Icon: UsersRound,
                  },
                  {
                    value: "organizations",
                    label: t.controlRoom.peopleOrganizationsTab,
                    Icon: Building2,
                  },
                ] as const
              ).map(({ value, label, Icon }) => {
                const ativo = peopleTab === value;
                return (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={ativo ? "secondary" : "ghost"}
                        onClick={() => setPeopleTab(value)}
                        aria-label={label}
                        aria-current={ativo ? "page" : undefined}
                        className={cn(
                          "shrink-0",
                          colapsada
                            ? "size-9 justify-center p-0"
                            : "w-full justify-start gap-2.5",
                          ativo
                            ? "bg-secondary font-medium text-secondary-foreground"
                            : "text-muted-foreground hover:bg-accent/50"
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        {!colapsada && <span>{label}</span>}
                      </Button>
                    </TooltipTrigger>
                    {colapsada && (
                      <TooltipContent side="right" align="center">
                        {label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>

            {/* #562: grupos de contato PESSOAIS (contactFolders) — seção SEPARADA
                dos grupos M365 compartilhados (nav primária acima) pra não
                confundir compartilhado × pessoal. Item único → grid de pastas
                editáveis no painel. */}
            <nav
              aria-label={t.controlRoom.personalGroupsSection}
              className={cn(
                "flex w-full flex-col gap-0.5",
                colapsada && "items-center"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={
                      peopleTab === "personalGroups" ? "secondary" : "ghost"
                    }
                    onClick={() => setPeopleTab("personalGroups")}
                    aria-label={t.controlRoom.personalGroupsSection}
                    aria-current={
                      peopleTab === "personalGroups" ? "page" : undefined
                    }
                    className={cn(
                      "shrink-0",
                      colapsada
                        ? "size-9 justify-center p-0"
                        : "w-full justify-start gap-2.5",
                      peopleTab === "personalGroups"
                        ? "bg-secondary font-medium text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent/50"
                    )}
                  >
                    <Contact className="size-4 shrink-0" />
                    {!colapsada && (
                      <span>{t.controlRoom.personalGroupsSection}</span>
                    )}
                  </Button>
                </TooltipTrigger>
                {colapsada && (
                  <TooltipContent side="right" align="center">
                    {t.controlRoom.personalGroupsSection}
                  </TooltipContent>
                )}
              </Tooltip>
            </nav>

            {/* #578: bloco redundante "My organization / VOAZ / People"
                (que duplicava o People de cima) + o dump de grupos no sidebar
                REMOVIDOS. Groups virou item da nav primária (grid no painel).
                As Categorias do Outlook (#406) seguem como nav própria. */}
            {peopleCategorias.size > 0 && (
            <nav
              aria-label={t.controlRoom.peopleCategoriesSection}
              className={cn(
                "flex w-full flex-col gap-0.5",
                colapsada && "items-center"
              )}
            >
              {/* #406: Categorias do Outlook — grupo customizável portável
                  (opção b). Clicar filtra os contatos pela categoria. */}
              {!colapsada && (
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {t.controlRoom.peopleCategoriesSection}
                </p>
              )}
              {[...peopleCategorias.entries()].map(([nome, cor]) => {
                const ativo =
                  peopleTab === "category" && peopleSelectedCategory === nome;
                return (
                  <Tooltip key={nome}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={ativo ? "secondary" : "ghost"}
                        onClick={() => selectPeopleCategory(nome)}
                        aria-label={nome}
                        aria-current={ativo ? "page" : undefined}
                        className={cn(
                          "shrink-0",
                          colapsada
                            ? "size-9 justify-center p-0"
                            : "w-full justify-start gap-2.5",
                          ativo
                            ? "bg-secondary font-medium text-secondary-foreground"
                            : "text-muted-foreground hover:bg-accent/50"
                        )}
                      >
                        {cor ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: cor }}
                          />
                        ) : (
                          <Tag className="size-4 shrink-0" />
                        )}
                        {!colapsada && (
                          <span className="min-w-0 flex-1 truncate text-left">
                            {nome}
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    {colapsada && (
                      <TooltipContent side="right" align="center">
                        {nome}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>
            )}
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 w-full flex-1">
          <AgendaCalendarSelector colapsada={colapsada} />
        </ScrollArea>
      )}

      <Separator className={cn("shrink-0", colapsada && "w-6")} />
      <nav
        aria-label={t.nav.controlRoom}
        className={cn("flex w-full flex-col gap-0.5", colapsada && "items-center")}
      >
        {/* #491: ordem Mailbox → Calendar → Contacts + ícones animados (lucide-animated). */}
        <Modulo view="mail" rotulo={t.controlRoom.mailboxTitulo} icon={MailboxIcon} />
        <Modulo view="agenda" rotulo={t.controlRoom.agendaTitulo} icon={CalendarDaysIcon} />
        <Modulo view="people" rotulo={t.controlRoom.peopleTitulo} icon={UsersIcon} />
      </nav>

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

// --- Filtro de intervalo de datas (#110) -----------------------------------
// Serialização, resolução do intervalo e predicado client-side agora vivem no
// filters slice (#129); a UI abaixo mantém somente o registry DateSelector.

// #1058: a tradução do DateSelector agora vive no namespace `dateSelector` do
// strings.ts (pt E en), montada por `montarDateSelectorI18n`. Trimestres (Q1–Q4)
// e semestres (H1–H2) seguem iguais nos dois idiomas — notação de negócio que
// bate com o parser de linguagem natural do input.

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
  // #1058: config completa (pt/en) montada do dicionário central.
  const dsI18n = useMemo(
    () => montarDateSelectorI18n(t.dateSelector),
    [t],
  );
  const fmt = ehPt ? "dd/MM/yyyy" : "MM/dd/yyyy";
  const rotulo = atual ? formatDateValue(atual, dsI18n, fmt) : "";
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
  | { tipo: "thread"; chave: string; m: EmailItem; n: number }
  | { tipo: "msg"; m: EmailItem; threadFilha?: boolean };

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
  onSalvarComo,
  onImprimir,
  pastasDestino,
  pastasCarregando,
  onAbrirMover,
  onMover,
  t,
}: {
  alvos: string[];
  lido: boolean;
  sinalizado: boolean;
  permanente: boolean;
  onMarcarLido: (id: string, lido: boolean) => void;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void | Promise<void>;
  onSalvarComo: (ids: string[], formato: FormatoSalvar) => void;
  onImprimir: (ids: string[]) => void;
  pastasDestino: PastaDestino[];
  pastasCarregando: boolean;
  onAbrirMover: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
  t: ReturnType<typeof useIdioma>["t"];
}) {
  const removerDaSelecao = useAppStore((s) => s.removerDaSelecao);
  // #640: "Imprimir" age sobre o e-mail EM LEITURA (escopo do S5). Sem leitor
  // aberto, o item fica desabilitado (multi-seleção não imprime).
  const readerAberto = useAppStore((s) => s.msgSel != null);
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
      {/* #636: "Salvar como…" (PDF/.eml/.msg) + "Imprimir" — mesmas ações do
          kebab "..." do leitor. Age sobre `alvos` (1 linha ou N selecionados). */}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Save />
          {t.controlRoom.salvarComo}
          <ContextMenuShortcut>
            {formatShortcut(ATALHO_SALVAR_COMO)}
          </ContextMenuShortcut>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          <ContextMenuItem className="gap-2" onClick={() => onSalvarComo(alvos, "pdf")}>
            <FileText />
            {t.controlRoom.salvarPdf}
          </ContextMenuItem>
          <ContextMenuItem className="gap-2" onClick={() => onSalvarComo(alvos, "eml")}>
            <Mail />
            {t.controlRoom.salvarEml}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        className="gap-2"
        disabled={!readerAberto}
        onClick={() => onImprimir(alvos)}
      >
        <Printer />
        {t.controlRoom.imprimir}
        <ContextMenuShortcut>{formatShortcut(ATALHO_IMPRIMIR)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        className="gap-2"
        onClick={() => {
          onExcluir(alvos);
          // Tira da seleção o que foi excluído — senão a barra "N selected"
          // fica fantasma após excluir pelo menu de contexto (o atalho Delete
          // já limpava; o menu não) (rejeição do #86 pelo PO).
          removerDaSelecao(alvos);
        }}
      >
        <Trash2 />
        {permanente ? t.controlRoom.excluirPermanente : t.controlRoom.excluir}
      </ContextMenuItem>
    </>
  );
}

// Atalhos reais das ações icon-only da lista (#101). Alimentam ao mesmo tempo
// o `aria-label` (via shortcutAccessibleLabel) e a dica do ShortcutTooltip (Kbd
// platform-correto). Ctrl+A/Esc já são tratados no handler de teclas da lista
// (mod+a → selecionarTudo; Escape → limparSelecao); S/Delete idem (onFlag /
// onExcluir da mensagem ativa).
// #1060: os ShortcutDefinition dos tooltips saem do catálogo (`atalhos-bridge`),
// a mesma fonte da ajuda "?" — nada de par de verdades divergindo.
const ATALHO_SELECIONAR_TUDO = shortcutBridge("selecionarTudo");
const ATALHO_LIMPAR_SELECAO = shortcutBridge("limparSelecao");
const ATALHO_SINALIZAR = shortcutBridge("sinalizar");
const ATALHO_EXCLUIR = shortcutBridge("excluir");
// Ler/não-ler do leitor (#102): atalho U. Alimenta aria-label + ShortcutTooltip
// do botão que ALTERNA lido/não-lido na toolbar do leitor.
const ATALHO_LER_NAO_LIDO = shortcutBridge("lidoNaoLido");
// #497: atalhos das ações do leitor JÁ cabeados no handler central (#28, switch
// por e.key.toLowerCase() = r/a/f). Exibidos como <Kbd> ao lado do rótulo dos
// botões Responder/Responder a todos/Encaminhar. NÃO inventar — casam com o
// handler; teclas exibidas em maiúscula (convenção dos demais ATALHO_*).
// #537: esquema Outlook — combos, não single-key (o single F colidia com o
// Filtro da lista). Responder=Ctrl+R · Responder a todos=Ctrl+Shift+R ·
// Encaminhar=Ctrl+Shift+F. O `ShortcutDefinition` já suporta primary/shift, e o
// `formatShortcut` renderiza "Ctrl+Shift+R" no <Kbd> — o exibido acompanha.
const ATALHO_RESPONDER = shortcutBridge("responder");
const ATALHO_RESPONDER_TODOS = shortcutBridge("responderTodos");
const ATALHO_ENCAMINHAR = shortcutBridge("encaminhar");
// #538: o Filtro da lista tem atalho F (single, liberado pelo #537) via o
// `<Filters enableShortcut shortcutKey="f">` — o tooltip precisa exibir o Kbd.
const ATALHO_FILTRO = shortcutBridge("filtro");
// #538: "Novo e-mail" (icon-only) dispara o mesmo compose do atalho "c" (o
// handler chama onCompor; onNovo === onCompor === novoEmailModal).
const ATALHO_COMPOR = shortcutBridge("compor");
// #549: equiparação Outlook nos icon-only que NÃO tinham atalho.
// Atualizar = F9 (Outlook Send/Receive All). Ordenar = O (app-nativo — o Outlook
// não tem atalho único de sort; tecla livre e mnemônica, sem colisão).
const ATALHO_ATUALIZAR = shortcutBridge("atualizar");
const ATALHO_ORDENAR = shortcutBridge("ordenar");
// #549: Esc fecha o preview de anexo (email aninhado) — por PRECEDÊNCIA sobre o
// clear-selection (padrão Outlook: Esc fecha o painel aberto primeiro).
const ATALHO_FECHAR_PREVIEW = shortcutBridge("fecharPreview");
// #636 (épico #635): Salvar como… = F12 · Imprimir = Ctrl+P (esquema Outlook).
// O abridor "..." usa a tecla nativa de context-menu do Windows (Menu/Shift+F10),
// só documentada no tooltip — o Radix já abre o menu por Enter/Espaço/↓.
const ATALHO_SALVAR_COMO = shortcutBridge("salvarComo");
const ATALHO_IMPRIMIR = shortcutBridge("imprimir");

/** #636: formatos de "Salvar como…". Um comando por formato (S2–S5). */
export type FormatoSalvar = "pdf" | "eml";

function MessageList({
  titulo,
  mensagens,
  erroLeitura,
  onRefresh,
  pastaId,
  pastaTipo,
  onEsvaziar,
  onCarregarMais,
  carregandoMais,
  temMais,
  onFlag,
  onExcluir,
  onMarcarLido,
  onSalvarComo,
  onImprimir,
  onAbrirMaisAcoes,
  pastasDestino,
  pastasCarregando,
  onAbrirMover,
  onMover,
  filtrosOcultos,
  onResponder,
  onResponderTodos,
  onEncaminhar,
  onCompor,
  envioBloqueado,
  t,
  idioma,
  ativo = true,
}: {
  titulo: string;
  mensagens: EmailItem[] | null;
  erroLeitura?: string;
  onRefresh: () => void;
  pastaId: string;
  pastaTipo: string;
  onEsvaziar: () => void;
  onCarregarMais: () => void;
  carregandoMais: boolean;
  temMais: boolean;
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void | Promise<void>;
  onMarcarLido: (id: string, lido: boolean) => void;
  // #636: Salvar como…/Imprimir agem sobre a linha ou a seleção; `onAbrirMaisAcoes`
  // é o F12 (abre o menu "..." do leitor, delegado ao MessageDetail via ref).
  onSalvarComo: (ids: string[], formato: FormatoSalvar) => void;
  onImprimir: (ids: string[]) => void;
  onAbrirMaisAcoes: () => void;
  pastasDestino: PastaDestino[];
  pastasCarregando: boolean;
  onAbrirMover: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
  filtrosOcultos: Set<string>;
  // Atalhos de teclado (#28): ações que vivem no LEITOR (reply/forward via
  // handle imperativo) e no PAI (compor). MessageList só dispara a tecla.
  onResponder: () => void;
  onResponderTodos: () => void;
  onEncaminhar: () => void;
  onCompor: () => void;
  envioBloqueado: boolean;
  t: ReturnType<typeof useIdioma>["t"];
  idioma: string;
  /** #454: só instala o atalho GLOBAL quando o Bridge é a tela ATIVA. O
   * control-room fica montado (keep-alive) apenas escondido ao trocar de tela;
   * sem este gate o listener de `window` seguia vivo e teclas como 'a'
   * (reply-all) disparavam com o usuário já no Navigator. */
  ativo?: boolean;
}) {
  const listaRef = useRef<HTMLDivElement>(null);
  const selecionados = useAppStore((s) => s.selecionados);
  const msgSel = useAppStore((s) => s.msgSel);
  const selecionarMensagem = useAppStore((s) => s.selecionarMensagem);
  const alternarSelecionado = useAppStore((s) => s.alternarSelecionado);
  const limparSelecao = useAppStore((s) => s.limparSelecao);
  const selecionarTudo = useAppStore((s) => s.selecionarTudo);
  const selecionarRange = useAppStore((s) => s.selecionarRange);
  const filtros = useAppStore((s) => s.filtros);
  const setFiltros = useAppStore((s) => s.setFiltros);
  const busca = useAppStore((s) => s.busca);
  const setBusca = useAppStore((s) => s.setBusca);
  const ordenar = useAppStore((s) => s.ordenar);
  const setOrdenar = useAppStore((s) => s.setOrdenar);
  const ordemDesc = useAppStore((s) => s.ordemDesc);
  const setOrdemDesc = useAppStore((s) => s.setOrdemDesc);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  // #549: dropdown do sort controlado, pra o atalho "O" poder abri-lo.
  const [sortAberto, setSortAberto] = useState(false);
  // #565: "Esvaziar lixeira" é destrutivo e irreversível → passa por AlertDialog
  // (mesmo padrão do "Esvaziar pasta" do menu de contexto), nunca direto.
  const [confirmarEsvaziar, setConfirmarEsvaziar] = useState(false);
  const filtroServidor = escopoDeFiltros(filtros);
  const filtroGraph = filtroServidor !== null;

  // ESC limpa só a busca de texto (o filtro é global/persistido, controlado
  // pelo pai — não é resetado aqui).
  const limparBusca = () => {
    setBusca("");
  };

  // A busca por TEXTO e os filtros Graph são resolvidos pelo pai (que passa os
  // resultados como `mensagens`); aqui só aplicamos os filtros CLIENT-side
  // (Unread/Flagged/Files) sobre a fonte. "all" e os filtros Graph não filtram
  // mais nada aqui.
  const filtrada = useMemo(() => {
    if (!mensagens) return [];
    return mensagens.filter((m) => passaFiltrosClient(m, filtros));
  }, [mensagens, filtros]);
  // O build das conversas pode atravessar centenas de mensagens carregadas.
  // `useDeferredValue` mantém busca/filtros responsivos e o useMemo só remonta
  // a estrutura quando o conjunto visível estabiliza (#29 / MailVault).
  const agruparConversas = useAppStore((s) => s.agruparConversas);
  const filtradaDiferida = useDeferredValue(filtrada);
  const conversas = useMemo<ConversaEmail[]>(
    () =>
      agruparConversas ? montarConversasEmail(filtradaDiferida) : [],
    [agruparConversas, filtradaDiferida]
  );

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
  // Colapsos migrados pro ui slice (#126). Chave `bridge.gruposColapsados.v2`
  // preservada pelo persist; seletor assina só este campo.
  const colapsadosMapa = useAppStore((s) => s.gruposColapsados);
  const setColapsadosMapa = useAppStore((s) => s.setGruposColapsados);
  const colapsadosArr = useMemo(
    () => colapsadosMapa[pastaId] ?? [],
    [colapsadosMapa, pastaId]
  );
  const colapsados = useMemo(() => new Set(colapsadosArr), [colapsadosArr]);
  // Conversas começam recolhidas; só as explicitamente abertas ficam salvas
  // por pasta, seguindo a persistência já usada pelos grupos de período.
  const threadsExpandidasMapa = useAppStore((s) => s.threadsExpandidas);
  const setThreadsExpandidasMapa = useAppStore(
    (s) => s.setThreadsExpandidas
  );
  const threadsExpandidasArr = useMemo(
    () => threadsExpandidasMapa[pastaId] ?? [],
    [threadsExpandidasMapa, pastaId]
  );
  const threadsExpandidas = useMemo(
    () => new Set(threadsExpandidasArr),
    [threadsExpandidasArr]
  );
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
  const alternarThread = (chave: string) => {
    autoPreencheuRef.current = null;
    setThreadsExpandidasMapa((mapa) => {
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
    // Toggle OFF mantém literalmente o flattening anterior, sem passar pela
    // camada de conversas (decisão de opt-in do PO).
    if (!agruparConversas) {
      if (!AGRUPAR) {
        return filtrada.map((m) => ({ tipo: "msg", m }) as LinhaLista);
      }
      const out: LinhaLista[] = [];
      const agora = new Date();
      const flagged = filtrada.filter((m) => m.sinalizado);
      const resto = filtrada.filter((m) => !m.sinalizado);
      if (flagged.length > 0) {
        out.push({
          tipo: "grupo",
          chave: "flagged",
          rotulo: t.controlRoom.grupoFlagged,
          n: flagged.length,
        });
        if (!colapsados.has("flagged")) {
          for (const m of flagged) out.push({ tipo: "msg", m });
        }
      }
      let atual: string | null = null;
      let header: Extract<LinhaLista, { tipo: "grupo" }> | null = null;
      for (const m of resto) {
        const chave = periodoChave(m.recebido, agora);
        if (chave !== atual) {
          atual = chave;
          header = {
            tipo: "grupo",
            chave,
            rotulo: rotuloDePeriodo(chave),
            n: 0,
          };
          out.push(header);
        }
        if (header) header.n++;
        if (!colapsados.has(chave)) out.push({ tipo: "msg", m });
      }
      return out;
    }

    const out: LinhaLista[] = [];
    const agora = new Date();
    const adicionarConversa = (conversa: ConversaEmail) => {
      if (conversa.quantidade === 1) {
        out.push({ tipo: "msg", m: conversa.principal });
        return;
      }
      out.push({
        tipo: "thread",
        chave: conversa.chave,
        m: conversa.principal,
        n: conversa.quantidade,
      });
      if (threadsExpandidas.has(conversa.chave)) {
        for (const m of conversa.anteriores) {
          out.push({ tipo: "msg", m, threadFilha: true });
        }
      }
    };

    if (!AGRUPAR) {
      for (const conversa of conversas) adicionarConversa(conversa);
      return out;
    }

    // A conversa é unidade indivisível: qualquer membro sinalizado leva o fio
    // inteiro ao grupo Flagged; ele não reaparece nos períodos.
    const flagged = conversas.filter((c) => c.sinalizada);
    const resto = conversas.filter((c) => !c.sinalizada);
    if (flagged.length > 0) {
      out.push({
        tipo: "grupo",
        chave: "flagged",
        rotulo: t.controlRoom.grupoFlagged,
        n: flagged.reduce((n, c) => n + c.quantidade, 0),
      });
      if (!colapsados.has("flagged")) {
        for (const conversa of flagged) adicionarConversa(conversa);
      }
    }
    let atual: string | null = null;
    let header: Extract<LinhaLista, { tipo: "grupo" }> | null = null;
    for (const conversa of resto) {
      const chave = periodoChave(conversa.principal.recebido, agora);
      if (chave !== atual) {
        atual = chave;
        header = { tipo: "grupo", chave, rotulo: rotuloDePeriodo(chave), n: 0 };
        out.push(header);
      }
      if (header) header.n += conversa.quantidade;
      if (!colapsados.has(chave)) adicionarConversa(conversa);
    }
    return out;
  }, [
    filtrada,
    conversas,
    agruparConversas,
    AGRUPAR,
    colapsados,
    threadsExpandidas,
    t,
    rotuloDePeriodo,
  ]);
  // Navegação por teclado segue estritamente as linhas de mensagem que estão
  // visíveis. Isso evita selecionar um membro recolhido de uma conversa (ou de
  // um grupo de período recolhido) e tentar rolar até uma linha inexistente.
  const mensagensNavegaveis = useMemo(
    () => linhas.flatMap((linha) => (linha.tipo === "grupo" ? [] : [linha.m])),
    [linhas]
  );

  // #230: a coluna do expander de conversa (`size-6`) só faz sentido quando a
  // lista TEM conversas encadeadas. Reservá-la em toda linha (mesmo em pastas
  // sem threads) criava uma faixa vazia à esquerda que comia largura útil. Só
  // reservamos quando há ao menos uma thread — aí o alinhamento se mantém.
  const haThreads = useMemo(
    () => linhas.some((linha) => linha.tipo === "thread"),
    [linhas]
  );

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
      if (!l) return i;
      if (l.tipo === "grupo") return `g:${l.chave}`;
      if (l.tipo === "thread") return `t:${l.chave}`;
      return l.m.id;
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
      if (l && l.tipo !== "grupo" && l.m.deEmail) emails.push(l.m.deEmail);
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
    const alvo = mensagensNavegaveis[idx];
    if (!alvo) return;
    selecionarMensagem(alvo.id);
    // Com a lista virtualizada, o item pode não estar no DOM — usa o
    // scrollToIndex do virtualizer. O índice é o da lista PLANA (linhas),
    // que difere de `filtrada` quando há headers de grupo (#30).
    const vi = linhas.findIndex(
      (l) => l.tipo !== "grupo" && l.m.id === alvo.id
    );
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
      selecionarTudo(idsFiltrados);
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
        limparSelecao();
        return;
      }
      if (busca) {
        e.preventDefault();
        limparBusca();
      }
      return;
    }

    // "/" foca a busca universal no top bar (#226).
    if (e.key === "/") {
      e.preventDefault();
      document
        .querySelector<HTMLInputElement>("[data-universal-search-input]")
        ?.focus();
      return;
    }

    // "c" compõe nova mensagem (ação do pai).
    if (e.key.toLowerCase() === "c" && !ehModPrincipal(e) && !e.altKey) {
      e.preventDefault();
      onCompor();
      return;
    }

    // #549: F9 atualiza a lista (Outlook = Send/Receive All).
    if (e.key === "F9") {
      e.preventDefault();
      onRefresh();
      return;
    }

    // #537: Responder / Responder a todos / Encaminhar por COMBO (esquema
    // Outlook). Antes eram single R/A/F, e o F colidia com o Filtro da lista.
    // Ctrl+R = responder · Ctrl+Shift+R = responder a todos · Ctrl+Shift+F =
    // encaminhar. Sem modificador, R/A/F ficam livres (F → só o Filtro).
    if (ehModPrincipal(e) && !e.altKey) {
      const tecla = e.key.toLowerCase();
      if (tecla === "r" && !e.shiftKey) {
        if (envioBloqueado) return;
        e.preventDefault();
        onResponder();
        return;
      }
      if (tecla === "r" && e.shiftKey) {
        if (envioBloqueado) return;
        e.preventDefault();
        onResponderTodos();
        return;
      }
      if (tecla === "f" && e.shiftKey) {
        if (envioBloqueado) return;
        e.preventDefault();
        onEncaminhar();
        return;
      }
    }

    // #636/#640: Salvar como… (F12) / Imprimir (Ctrl+P). ANTES do guard de lista
    // vazia — valem com um e-mail ATIVO no leitor (`msgSel`) mesmo que a lista
    // navegável esteja vazia (busca/filtro sem resultado).
    {
      // F12 abre o menu "..." do leitor (revela "Salvar como…"), via ref.
      if (e.key === "F12") {
        if (msgSel) {
          e.preventDefault();
          onAbrirMaisAcoes();
        }
        return;
      }
      // Ctrl+P (#640): SEMPRE intercepta pra bloquear a impressão nativa do
      // WebView2 (que imprimiria a UI do app); imprime só se há e-mail no leitor.
      if (ehModPrincipal(e) && e.key.toLowerCase() === "p" && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (msgSel) onImprimir([msgSel]);
        return;
      }
    }

    if (mensagensNavegaveis.length === 0) return;
    const idxAtivo = mensagensNavegaveis.findIndex((m) => m.id === msgSel);

    // Navegação: ↑/↓ e j/k (MailVault).
    const desce = e.key === "ArrowDown" || e.key === "j";
    const sobe = e.key === "ArrowUp" || e.key === "k";
    if (desce || sobe) {
      e.preventDefault();
      const prox =
        idxAtivo === -1
          ? 0
          : desce
            ? Math.min(mensagensNavegaveis.length - 1, idxAtivo + 1)
            : Math.max(0, idxAtivo - 1);
      irPara(prox);
      return;
    }

    // Ações que dependem de UMA mensagem ativa (ou da seleção, no excluir).
    const ativoId =
      msgSel ?? (idxAtivo >= 0 ? mensagensNavegaveis[idxAtivo].id : null);
    const msgAtiva = ativoId
      ? mensagensNavegaveis.find((m) => m.id === ativoId)
      : undefined;

    // Delete exclui a seleção (se houver) ou a ativa.
    if (e.key === "Delete") {
      const alvos = selecionados.size > 0 ? [...selecionados] : ativoId ? [ativoId] : [];
      if (alvos.length > 0) {
        e.preventDefault();
        onExcluir(alvos);
        // acaoExcluir não limpa mais a seleção (pro BotaoExcluir animar antes de
        // desmontar); no atalho, limpamos aqui.
        limparSelecao();
      }
      return;
    }

    // Atalhos de tecla única sem modificadores. (Responder/Responder a todos/
    // Encaminhar saíram daqui no #537 — agora são combos Ctrl+... acima; R/A/F
    // single ficam livres, o F pro Filtro da lista.)
    if (ehModPrincipal(e) || e.altKey || e.shiftKey) return;
    switch (e.key.toLowerCase()) {
      case "o": // #549: abre o menu de ordenação (app-nativo, Outlook não tem)
        e.preventDefault();
        setSortAberto(true);
        return;
      case "x": // marcar/desmarcar a mensagem ativa
        if (ativoId) {
          e.preventDefault();
          alternarSelecionado(ativoId);
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
  useAtalhos(aoTeclar, ativo);

  // Clique na linha (#28): Shift+clique seleciona o INTERVALO entre a âncora e
  // o item clicado (sobre a ordem de exibição `idsFiltrados`, ignorando headers
  // de grupo); Ctrl/⌘+clique alterna; clique simples abre e vira a nova âncora.
  const aoClicarLinha = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && selecionarRange(idsExibidos, id)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      alternarSelecionado(id);
      return;
    }
    // Shift sem âncora válida também cai aqui: abre e fixa a nova âncora.
    selecionarMensagem(id);
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
    () => linhas.reduce((n, l) => n + (l.tipo !== "grupo" ? 1 : 0), 0),
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
  }, [
    linhas.length,
    linhasMsg,
    temMais,
    carregandoMais,
    colapsadosArr,
    threadsExpandidasArr,
  ]);

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
  }, [linhas.length, colapsadosArr, threadsExpandidasArr]);

  // #611: scroll-anchoring no PREPEND (e-mail novo chega acima — #603). A cada
  // commit rastreamos a âncora = 1ª linha de mensagem visível (id estável) e seu
  // offset. Se no commit seguinte essa mesma linha desceu (entraram itens acima,
  // = prepend), compensamos o `scrollTop` pela diferença, mantendo o conteúdo
  // exato em vista. Só quando o usuário está scrollado; no topo deixamos o novo
  // aparecer. `useLayoutEffect` roda antes do paint → sem flicker. Complementa o
  // efeito acima (que reancora quando a lista ENCOLHE); aqui só agimos na
  // descida da âncora (delta>0), então não colidem.
  const ancoraRef = useRef<Ancora | null>(null);
  useLayoutEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    const vitems = virtualizer.getVirtualItems();
    const ancora = ancoraRef.current;
    if (ancora) {
      const atual = vitems.find((vi) => {
        const l = linhas[vi.index];
        return l && l.tipo !== "grupo" && l.m.id === ancora.id;
      });
      const novo = scrollTopReancorado(ancora, atual?.start, {
        noTopo: el.scrollTop <= 0,
      });
      if (novo !== null) el.scrollTop = novo;
    }
    // (Re)calcula a âncora pro próximo commit: 1ª linha de mensagem cujo fim
    // passa do topo do viewport (primeira visível), já na posição compensada.
    const st = el.scrollTop;
    let nova: Ancora | null = null;
    for (const vi of vitems) {
      const l = linhas[vi.index];
      if (l && l.tipo !== "grupo" && vi.end > st) {
        nova = { id: l.m.id, start: vi.start, scrollTop: st };
        break;
      }
    }
    ancoraRef.current = nova;
  });

  const idsFiltrados = filtrada.map((m) => m.id);
  // Ordem de EXIBIÇÃO das mensagens (respeita agrupamento/Flagged-no-topo e
  // ignora headers e grupos colapsados): é o que o Shift+clique usa como
  // "itens compreendidos entre" — o intervalo segue o que o usuário vê (#28).
  const idsExibidos = useMemo(
    () => linhas.flatMap((l) => (l.tipo !== "grupo" ? [l.m.id] : [])),
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
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {mensagens && (
          <Badge variant="secondary" size="sm">
            {mensagens.length}
          </Badge>
        )}
        <Toolbar
          className="ml-auto gap-1"
          aria-label={t.controlRoom.mailboxTitulo}
        >
          {pastaTipo === "deleteditems" && (mensagens?.length ?? 0) > 0 && (
            // #565: semântica destrutiva (variant destructive) + confirmação —
            // ação irreversível não pode parecer/agir como um botão comum.
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmarEsvaziar(true)}
            >
              <Trash2 /> {t.controlRoom.esvaziarLixeira}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Filters<string>
                  filters={filtros}
                  fields={filtroCampos}
                  onChange={setFiltros}
                  enableShortcut
                  shortcutKey="f"
                  shortcutLabel="F"
                  trigger={
                    <ToolbarButton
                      aria-label={shortcutAccessibleLabel(
                        t.controlRoom.filtroLabel,
                        ATALHO_FILTRO
                      )}
                      pressed={filtros.length > 0}
                    >
                      <ListFilter />
                    </ToolbarButton>
                  }
                  i18n={montarFiltrosI18n(t.filtros)}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {/* #538: Filtro é icon-only COM atalho (F) → ShortcutTooltip c/ Kbd. */}
              <ShortcutTooltip
                label={t.controlRoom.filtroLabel}
                shortcut={ATALHO_FILTRO}
              />
            </TooltipContent>
          </Tooltip>
          {filtros.length > 0 && (
            <ToolbarButton
              tooltip={t.controlRoom.filtroLimpar}
              onClick={() => setFiltros([])}
            >
              <FunnelX />
            </ToolbarButton>
          )}
          <DropdownMenu open={sortAberto} onOpenChange={setSortAberto}>
            {/* #226: sort é icon button com tooltip, igual ao People. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton
                    aria-label={shortcutAccessibleLabel(
                      t.controlRoom.ordenarPor,
                      ATALHO_ORDENAR
                    )}
                    pressed={ordenar !== "data" || !ordemDesc}
                  >
                    <ArrowDownUp />
                  </ToolbarButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {/* #549: Sort ganha atalho O → ShortcutTooltip com Kbd. */}
                <ShortcutTooltip
                  label={t.controlRoom.ordenarPor}
                  shortcut={ATALHO_ORDENAR}
                />
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>{t.controlRoom.ordenarPor}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={ordenar}
                onValueChange={(v) => setOrdenar(v as api.OrdenarMensagens)}
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
                onValueChange={(v) => setOrdemDesc(v === "desc")}
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
          {/* As preferências de LEITURA (marcar como lido) migraram pra
              Settings > Bridge > Reading (#227): a UI do e-mail deixa de ter
              esse controle solto. */}
          {/* Atualizar (#549): atalho F9 (Outlook Send/Receive) → ShortcutTooltip. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onRefresh}
                aria-label={shortcutAccessibleLabel(
                  t.controlRoom.atualizar,
                  ATALHO_ATUALIZAR
                )}
              >
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <ShortcutTooltip
                label={t.controlRoom.atualizar}
                shortcut={ATALHO_ATUALIZAR}
              />
            </TooltipContent>
          </Tooltip>
        </Toolbar>
      </div>

      {/* #565: confirmação do "Esvaziar lixeira" — destrutiva e irreversível
          (reusa as strings/estrutura do "Esvaziar pasta" do menu de contexto). */}
      <AlertDialog open={confirmarEsvaziar} onOpenChange={setConfirmarEsvaziar}>
        <AlertDialogContent className="max-w-sm!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preencher(t.controlRoom.esvaziarPastaTitulo, {
                pasta: t.controlRoom.pastaTrash,
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
                onEsvaziar();
                setConfirmarEsvaziar(false);
              }}
            >
              {t.controlRoom.esvaziarPastaConfirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selecionados.size > 0 && (
        <div className="flex items-center gap-2 px-3 pb-2">
          {/* Selecionar tudo (#101): atalho Ctrl+A → ShortcutTooltip com Kbd.
              O nome acessível era ERRADO — trocava pra "Limpar seleção" quando
              tudo estava marcado; num master checkbox o estado já é comunicado
              pelo próprio role, então o nome fica FIXO em "Selecionar tudo". */}
          <Tooltip>
            <TooltipTrigger asChild>
              <input
                type="checkbox"
                checked={todosSel}
                onChange={(e) =>
                  e.target.checked ? selecionarTudo(idsFiltrados) : limparSelecao()
                }
                className="size-3.5 accent-primary"
                aria-label={shortcutAccessibleLabel(
                  t.controlRoom.selecionarTudo,
                  ATALHO_SELECIONAR_TUDO
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              <ShortcutTooltip
                label={t.controlRoom.selecionarTudo}
                shortcut={ATALHO_SELECIONAR_TUDO}
              />
            </TooltipContent>
          </Tooltip>
          <span className="text-xs font-medium">
            {preencher(t.controlRoom.nSelecionados, { n: selecionados.size })}
          </span>
          <BotaoExcluir
            className="ml-auto"
            onExcluir={() => onExcluir([...selecionados])}
            onConcluir={limparSelecao}
            rotulo={t.controlRoom.excluirSelecionados}
            rotuloProcessando={t.controlRoom.excluindo}
            rotuloConcluido={t.controlRoom.excluidos}
          />
          {/* Limpar seleção (#101): atalho Esc → ShortcutTooltip com Kbd. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={limparSelecao}
                aria-label={shortcutAccessibleLabel(
                  t.controlRoom.limparSelecao,
                  ATALHO_LIMPAR_SELECAO
                )}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <ShortcutTooltip
                label={t.controlRoom.limparSelecao}
                shortcut={ATALHO_LIMPAR_SELECAO}
              />
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <Separator />

      {!mensagens ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : erroLeitura ? (
        <Empty className="flex-1 py-10">
          <EmptyHeader>
            <EmptyMedia>
              <ShieldAlert />
            </EmptyMedia>
            <EmptyTitle>{t.controlRoom.caixaCompartilhadaTitulo}</EmptyTitle>
            <EmptyDescription>{erroLeitura}</EmptyDescription>
          </EmptyHeader>
        </Empty>
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
          className="min-h-0 flex-1 overflow-y-auto scrollbar-fina outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
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
                const thread = linha.tipo === "thread" ? linha : null;
                const m = linha.m;
                const threadExpandida =
                  thread !== null && threadsExpandidas.has(thread.chave);
                const ativo = m.id === msgSel;
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
                        !m.lido && !ativo && "bg-primary/[0.03]",
                        linha.tipo === "msg" &&
                          linha.threadFilha &&
                          "border-l-2 border-l-primary/20 pl-5"
                      )}
                    >
                      {/* A conversa é uma unidade virtual plana: o trigger do
                          Collapsible abre/fecha as linhas anteriores sem
                          desmontar conteúdo dentro da linha (mesma adaptação
                          do c-collapsible-6 usada nos headers de período). */}
                      {haThreads &&
                        (thread ? (() => {
                          // Nome e tooltip do expander comunicam o ESTADO
                          // (expandir vs recolher) e a CONTAGEM de mensagens,
                          // não só a conversa (#157) — a mesma string alimenta
                          // `aria-label` e o tooltip canônico (mesmo padrão do
                          // chevron da sidebar no #100). Sem atalho de teclado,
                          // então Tooltip puro (não ShortcutTooltip).
                          const rotuloThread = threadExpandida
                            ? t.controlRoom.recolherConversa
                            : preencher(t.controlRoom.expandirConversaContagem, {
                                n: thread.n,
                              });
                          return (
                            <Collapsible
                              open={threadExpandida}
                              onOpenChange={() => alternarThread(thread.chave)}
                              className="self-start pt-1"
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <CollapsibleTrigger asChild>
                                    <button
                                      type="button"
                                      className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                      aria-label={rotuloThread}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ChevronRight
                                        aria-hidden="true"
                                        className="size-3.5 transition-transform in-data-[state=open]:rotate-90"
                                      />
                                    </button>
                                  </CollapsibleTrigger>
                                </TooltipTrigger>
                                <TooltipContent>{rotuloThread}</TooltipContent>
                              </Tooltip>
                            </Collapsible>
                          );
                        })() : (
                          <span
                            aria-hidden="true"
                            className="size-6 shrink-0 self-start"
                          />
                        ))}

                      <ItemMedia className="relative self-start">
                        <Avatar>
                          {foto && <AvatarImage src={foto} alt="" />}
                          <AvatarFallback>{m.iniciais}</AvatarFallback>
                        </Avatar>
                        {!m.lido && (
                          <span className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />
                        )}
                        {/* #230: o checkbox de seleção sobrepõe o avatar (padrão
                            Outlook/Gmail) em vez de ocupar uma coluna própria à
                            esquerda — que gerava a faixa vazia. Aparece no hover
                            da linha ou quando há seleção; a seleção/atalhos não
                            mudam (só o `onChange` continua disparando). */}
                        <label
                          className={cn(
                            "absolute inset-0 grid cursor-pointer place-items-center rounded-full bg-background/85 transition-opacity",
                            marcado || haSelecao
                              ? "opacity-100"
                              : "opacity-0 group-hover/row:opacity-100"
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => alternarSelecionado(m.id)}
                            className="size-4 accent-primary"
                            aria-label={m.assunto}
                          />
                        </label>
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
                          {thread && (
                            <Badge
                              variant="secondary"
                              size="sm"
                              className="shrink-0"
                              title={preencher(
                                t.controlRoom.nMensagensConversa,
                                { n: thread.n }
                              )}
                            >
                              {thread.n}
                            </Badge>
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
                                {/* Sinalizar da linha (#101): atalho S →
                                    ShortcutTooltip com Kbd. */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => onFlag(m.id, !m.sinalizado)}
                                      className="grid size-6 place-items-center rounded bg-accent hover:bg-background"
                                      aria-label={shortcutAccessibleLabel(
                                        t.controlRoom.sinalizar,
                                        ATALHO_SINALIZAR
                                      )}
                                    >
                                      <Flag
                                        className={cn(
                                          "size-3.5",
                                          m.sinalizado ? "fill-red-500 text-red-500" : "text-muted-foreground"
                                        )}
                                      />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <ShortcutTooltip
                                      label={t.controlRoom.sinalizar}
                                      shortcut={ATALHO_SINALIZAR}
                                    />
                                  </TooltipContent>
                                </Tooltip>
                                {/* Excluir da linha (#101): atalho Delete →
                                    ShortcutTooltip com Kbd. */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => onExcluir([m.id])}
                                      className="grid size-6 place-items-center rounded bg-accent text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                      aria-label={shortcutAccessibleLabel(
                                        t.controlRoom.excluir,
                                        ATALHO_EXCLUIR
                                      )}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <ShortcutTooltip
                                      label={t.controlRoom.excluir}
                                      shortcut={ATALHO_EXCLUIR}
                                    />
                                  </TooltipContent>
                                </Tooltip>
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
                          onSalvarComo={onSalvarComo}
                          onImprimir={onImprimir}
                          pastasDestino={pastasDestino}
                          pastasCarregando={pastasCarregando}
                          onAbrirMover={onAbrirMover}
                          onMover={onMover}
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
              onSalvarComo={onSalvarComo}
              onImprimir={onImprimir}
              pastasDestino={pastasDestino}
              pastasCarregando={pastasCarregando}
              onAbrirMover={onAbrirMover}
              onMover={onMover}
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
