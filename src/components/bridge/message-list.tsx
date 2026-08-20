// #1019 (épico #1007) — o seam do MessageList, tirado do `control-room.tsx`.
//
// Vieram junto os cinco que só ELE usa: `PastaVazia`, `SeletorDataFiltro`, o
// tipo `LinhaLista`, `periodoChave` e `ItensMenuEmail`. O `IlustracaoCards` NÃO
// veio: ele é usado pelo `PastaVazia` (que saiu) e pelo `MultiSelecaoContexto`
// (que ficou), então cruza seams e foi pro enabler — critério do `Altair`.
//
// A tabela de medição está no card, publicada antes de eu mover uma linha.

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Badge } from "@/components/reui/badge";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";

import {
  Filters,
  type FilterFieldConfig,
  type FilterOperator,
  type FilterOption,
} from "@/components/reui/filters";
import { DateSelector, formatDateValue, type DateSelectorValue } from "@/components/reui/date-selector";
import { montarFiltrosI18n, montarDateSelectorI18n } from "@/lib/reui-i18n";
import { Button } from "@/components/ui/button";

import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Frame, FrameHeader, FrameTitle } from "@/components/reui/frame";

import {
  Empty,
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

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortcutAccessibleLabel, formatShortcut } from "@/components/ui/shortcut";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
// #1060: catálogo declarativo dos atalhos do Bridge (fonte única) — os tooltips/
// aria-labels das ações icon-only leem daqui, a MESMA fonte da ajuda "?".
import {
  ATALHO_EXCLUIR,
  ATALHO_IMPRIMIR,
  ATALHO_SALVAR_COMO,
  ATALHO_SINALIZAR,
  shortcutBridge,
} from "@/components/atalhos-bridge";

import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

// Ícones animados das pastas de e-mail (#494) — lucide-animated via registry.

import * as api from "@/lib/api";

import { montarConversasEmail, type ConversaEmail } from "@/lib/conversas-email";
import { useFotos } from "@/lib/fotos";
import { useVirtualizer } from "@tanstack/react-virtual";

import { preencher, useIdioma } from "@/lib/idioma";

import { useAppStore } from "@/store";
import {
  desserializarDataFiltro,
  escopoDeFiltros,
  passaFiltrosClient,
  resolveIntervaloData,
  serializarDataFiltro,
} from "@/store/filters-slice";

import { scrollTopReancorado, type Ancora } from "@/lib/scroll-ancora";

import { BotaoExcluir, SubmenuMover, type PastaDestino } from "@/components/bridge/message-shared";

import { cn } from "@/lib/utils";
import type {
  EmailItem,
} from "@/lib/types";
import {
  ArrowDownUp,
  AtSign,
  CalendarCheck,
  CalendarDays,
  ListFilter,
  ChevronRight,
  FileText,
  Flag,
  FlagOff,
  FunnelX,
  Mail,
  MailOpen,
  Paperclip,
  Printer,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  User,
  X,
} from "lucide-react";
// #489: ícones de collapse do registry animate-ui (animados), por estado.

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtalhos, isTypingTarget, ehModPrincipal } from "@/hooks/use-atalhos";
import { AtalhosAjuda } from "@/components/atalhos-ajuda";
import { IlustracaoCards } from "@/components/bridge/message-shared";
import { comZ, quandoCurto } from "@/lib/data-email";

/** #109 removeu o esconder-escopo em 400; a coleção canônica permanece vazia. */

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
// Ler/não-ler do leitor (#102): atalho U. Alimenta aria-label + ShortcutTooltip
// do botão que ALTERNA lido/não-lido na toolbar do leitor.
// #497: atalhos das ações do leitor JÁ cabeados no handler central (#28, switch
// por e.key.toLowerCase() = r/a/f). Exibidos como <Kbd> ao lado do rótulo dos
// botões Responder/Responder a todos/Encaminhar. NÃO inventar — casam com o
// handler; teclas exibidas em maiúscula (convenção dos demais ATALHO_*).
// #537: esquema Outlook — combos, não single-key (o single F colidia com o
// Filtro da lista). Responder=Ctrl+R · Responder a todos=Ctrl+Shift+R ·
// Encaminhar=Ctrl+Shift+F. O `ShortcutDefinition` já suporta primary/shift, e o
// `formatShortcut` renderiza "Ctrl+Shift+R" no <Kbd> — o exibido acompanha.
// #538: o Filtro da lista tem atalho F (single, liberado pelo #537) via o
// `<Filters enableShortcut shortcutKey="f">` — o tooltip precisa exibir o Kbd.
const ATALHO_FILTRO = shortcutBridge("filtro");
// #538: "Novo e-mail" (icon-only) dispara o mesmo compose do atalho "c" (o
// handler chama onCompor; onNovo === onCompor === novoEmailModal).
// #549: equiparação Outlook nos icon-only que NÃO tinham atalho.
// Atualizar = F9 (Outlook Send/Receive All). Ordenar = O (app-nativo — o Outlook
// não tem atalho único de sort; tecla livre e mnemônica, sem colisão).
const ATALHO_ATUALIZAR = shortcutBridge("atualizar");
const ATALHO_ORDENAR = shortcutBridge("ordenar");
// #549: Esc fecha o preview de anexo (email aninhado) — por PRECEDÊNCIA sobre o
// clear-selection (padrão Outlook: Esc fecha o painel aberto primeiro).
// #636 (épico #635): Salvar como… = F12 · Imprimir = Ctrl+P (esquema Outlook).
// O abridor "..." usa a tecla nativa de context-menu do Windows (Menu/Shift+F10),
// só documentada no tooltip — o Radix já abre o menu por Enter/Espaço/↓.

/** #636: formatos de "Salvar como…". Um comando por formato (S2–S5). */
export type FormatoSalvar = "pdf" | "eml";

export function MessageList({
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
