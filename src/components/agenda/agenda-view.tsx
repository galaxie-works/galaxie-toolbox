// Agenda (Bridge) — calendário completo com views mês/semana/dia/agenda,
// alimentado por /me/events, com criar/editar/excluir via Graph (#211). A UI do
// calendário é o componente reui `event-calendar` (instalado do registry, usado
// como é); aqui fica só a cola: fetch por faixa visível, estados, i18n e o
// diálogo de CRUD (padrão do c-event-calendar-3).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { enUS, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";
import { toast } from "sonner";
import {
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  Check,
  CircleHelp,
  Eye,
  Pencil,
  Plus,
  Repeat,
  RefreshCw,
  Trash2,
  Video,
  X,
} from "lucide-react";

import { useAppStore } from "@/store";
import { podeGerenciarEvento } from "@/lib/agenda-permissions";
import { useIdioma } from "@/lib/idioma";
import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import type { Idioma } from "@/lib/strings";
import type {
  AcaoRsvp,
  ConvidadoInput,
  DiaSemana,
  EventoAgenda,
  EventoInput,
  Pessoa,
  RecorrenciaFim,
  RecorrenciaFrequencia,
  RecorrenciaInput,
} from "@/lib/types";
import { crEventoRecorrencia } from "@/lib/api";
import { CampoPessoas } from "@/components/compose/campo-pessoas";
// #570: avatar do organizador no chip (day/week), mesmo cache de fotos do #533.
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFotos } from "@/lib/fotos";

import {
  EventCalendar,
  type EventCalendarRenderEventProps,
} from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import {
  EventCalendarNav,
  EventCalendarToolbar,
} from "@/components/reui/event-calendar/event-calendar-nav";
import type { EventCalendarI18nOverrides } from "@/components/reui/event-calendar/event-calendar-i18n";
import type {
  CalendarEvent,
  EventCalendarOccurrence,
  EventCalendarProposedUpdate,
  EventCalendarRangeInfo,
  EventCalendarResource,
  EventCalendarSlotDraft,
  EventCalendarSlotInfo,
} from "@/components/reui/event-calendar/event-calendar-types";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type Dic = ReturnType<typeof useIdioma>["t"];

// Recorrência (#396): ordem dos dias (domingo=0, como o getDay do JS) e rótulo
// curto localizado via Intl (sem precisar de string por dia no dicionário).
const ORDEM_DIAS: DiaSemana[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
function rotuloDiaCurto(dia: DiaSemana): string {
  const idx = ORDEM_DIAS.indexOf(dia);
  // 2023-01-01 é um domingo → base estável pra formatar o nome do dia.
  const d = new Date(2023, 0, 1 + idx);
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
}
function diaDaData(iso: string): DiaSemana {
  const d = new Date(`${iso}T00:00:00`);
  return ORDEM_DIAS[d.getDay()] ?? "monday";
}

// #397/#398: um evento é recorrente quando é ocorrência/exceção/série.
function ehRecorrente(ev: EventoAgenda): boolean {
  return (
    ev.tipo === "occurrence" ||
    ev.tipo === "exception" ||
    ev.tipo === "seriesMaster"
  );
}

/**
 * #212: chip de evento custom (padrão c-event-calendar-4) — barra COMPACTA de
 * uma linha: swatch quadrado na cor da categoria (`--ec-event-color`, do #211) +
 * título em `font-medium` + ícone de recorrência. Mais denso e limpo que o chip
 * padrão (sem a coluna de hora, que polui a célula do mês). Injetado via o hook
 * `renderEvent` do event-calendar — NÃO instala variante nova. O avatar do
 * organizador é follow-up (#570, só day/week, depende de dado da agenda).
 */
/** #570: payload do evento no calendar — leva o organizador pro chip. */
type DadosChipEvento = { organizadorEmail: string };

/** Iniciais a partir do e-mail (não temos o nome do organizador no list-item). */
function iniciaisEmail(email: string): string {
  const base = email.split("@")[0] ?? email;
  return (
    base
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function renderChipEvento(
  { occurrence, view }: EventCalendarRenderEventProps<DadosChipEvento>,
  getFoto: (email: string | null | undefined) => string | null | undefined,
): ReactNode {
  // #570: avatar do organizador SÓ em day/week (blocos maiores). No mês o chip é
  // apertado demais (decisão de design). Sem foto no cache → iniciais.
  const orgEmail = occurrence.event.data?.organizadorEmail?.trim();
  const mostrarAvatar = (view === "day" || view === "week") && !!orgEmail;
  return (
    <span className="flex w-full min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-[3px] bg-(--ec-event-color)"
      />
      {mostrarAvatar && orgEmail && (
        <Avatar className="size-3.5 shrink-0">
          <AvatarImage src={getFoto(orgEmail) ?? undefined} alt="" />
          <AvatarFallback className="text-[8px]">
            {iniciaisEmail(orgEmail)}
          </AvatarFallback>
        </Avatar>
      )}
      {occurrence.isRecurring && (
        <Repeat className="size-2.5 shrink-0 opacity-70" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">
        {occurrence.event.title}
      </span>
    </span>
  );
}

// Identidades estáveis: o store do event-calendar compara settings por
// referência, então arrays/objetos recriados a cada render forçariam re-render.
const VIEWS: ("month" | "week" | "day" | "agenda" | "resource")[] = [
  "month",
  "week",
  "day",
  "agenda",
  // #214: visão por RECURSO (salas) — colunas por local, pra reserva de sala.
  // O EventCalendar do reui já suporta a view "resource" (não recriamos variante);
  // aqui só a ligamos e alimentamos com os recursos derivados dos eventos.
  "resource",
];
// #214: recurso "sem local" — eventos sem sala caem nesta coluna, pra não sumirem
// da visão por recurso.
const RECURSO_SEM_LOCAL = "__sem_local__";
// #213 drag-to-book: arrastar um evento reagenda (move) e arrastar num slot vazio
// abre criar. `resize` (mudar duração pela borda) fica de fora do escopo do #213
// — segue pelo diálogo. O per-event `draggable` (abaixo) barra recorrentes e
// convites; `canDropEvent` barra trocar de sala na visão por recurso (#214).
const INTERACOES = { drag: true, resize: false, selectSlot: true } as const;

// --- helpers de data --------------------------------------------------------

/** Anexa Z se o ISO vier sem fuso (o Graph devolve UTC sem Z). */
function comZ(iso: string): string {
  return iso.endsWith("Z") ? iso : iso + "Z";
}

/** ISO UTC -> valor de <input type="datetime-local"> (hora local, sem fuso). */
function paraInputLocal(iso: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** #213: Date (instante) -> hora-de-parede LOCAL "yyyy-MM-ddTHH:mm:ss" (sem Z),
 *  como o form monta o input pro Graph. O `cr_reagendar_evento` recebe isso +
 *  o fuso IANA e resolve o instante no servidor. */
function paraWallLocal(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

/** ISO UTC -> valor de <input type="date"> (data local). */
function paraInputData(iso: string): string {
  const d = new Date(comZ(iso));
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Soma dias a um "yyyy-MM-dd" e devolve outro "yyyy-MM-dd". */
function somarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function localeDe(idioma: Idioma): Locale {
  return idioma === "pt-BR" ? ptBR : enUS;
}

/** Overrides de i18n do event-calendar a partir do dicionário do app. */
function montarI18n(t: Dic): EventCalendarI18nOverrides {
  return {
    labels: {
      today: t.controlRoom.agendaHoje,
      addEvent: t.controlRoom.agendaNovoEvento,
      allDay: t.controlRoom.diaInteiro,
      more: (n: number) => `+${n} ${t.controlRoom.agendaCalMais}`,
      noEvents: t.controlRoom.agendaCalSemEventos,
      loading: t.controlRoom.agendaCalCarregando,
    },
    viewNames: {
      month: t.controlRoom.agendaViewMes,
      week: t.controlRoom.agendaViewSemana,
      day: t.controlRoom.agendaViewDia,
      agenda: t.controlRoom.agendaViewAgenda,
      resource: t.controlRoom.agendaViewResource,
    },
  };
}

// --- view principal ---------------------------------------------------------

export function AgendaView() {
  const { idioma, t } = useIdioma();
  const dia = useAppStore((s) => s.agendaDia);
  const setDia = useAppStore((s) => s.setAgendaDia);
  const view = useAppStore((s) => s.agendaView);
  const setView = useAppStore((s) => s.setAgendaView);
  const mesEventos = useAppStore((s) => s.agendaEventosMes);
  const erroAgenda = useAppStore((s) => s.agendaErro);
  const recargaAgenda = useAppStore((s) => s.agendaRecarga);
  const carregarMesAgenda = useAppStore((s) => s.carregarMesAgenda);
  const recarregarAgenda = useAppStore((s) => s.recarregarAgenda);
  const coresCat = useAppStore((s) => s.agendaCoresCategoria);
  const carregarCoresAgenda = useAppStore((s) => s.carregarCoresAgenda);
  const carregarCalendarios = useAppStore((s) => s.carregarCalendarios);
  // #495: caixa selecionada — muda ⇒ recarrega calendários/eventos da caixa.
  const caixaAtiva = useAppStore((s) => s.caixaAtiva);
  const selecionarEventoAgenda = useAppStore((s) => s.selecionarEventoAgenda);
  const abrirFormCriar = useAppStore((s) => s.abrirFormCriar);
  const cancelarEvento = useAppStore((s) => s.cancelarEvento);
  // #213: reagendar arrastando (drag-to-book).
  const reagendarEvento = useAppStore((s) => s.reagendarEvento);

  // Menu de contexto do evento (#330): o right-click num chip abre o ContextMenu
  // do app com as ações condicionadas ao contexto. Identificamos a ocorrência
  // sob o cursor pelo `data-event-id` que o chip do event-calendar expõe, e
  // resolvemos o EventoAgenda completo na lista do mês (organizer/RSVP/etc.).
  const [menuEventoId, setMenuEventoId] = useState<string | null>(null);
  const menuEvento = useMemo(
    () =>
      menuEventoId
        ? ((mesEventos ?? []).find((e) => e.id === menuEventoId) ?? null)
        : null,
    [menuEventoId, mesEventos],
  );

  // Confirmação do "Cancelar evento" (#260) disparada pelo menu — destrutiva e
  // notifica os convidados, então reusa o mesmo AlertDialog + comentário do
  // detalhe (EventoDialog). Excluir é silencioso; cancelar avisa.
  const [cancelarAlvo, setCancelarAlvo] = useState<EventoAgenda | null>(null);
  const [comentarioCancel, setComentarioCancel] = useState("");
  const [cancelando, setCancelando] = useState(false);
  // #398: excluir recorrente pede ocorrência × série (excluir é silencioso).
  const excluirEvento = useAppStore((s) => s.excluirEvento);
  const [excluirAlvo, setExcluirAlvo] = useState<EventoAgenda | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // Right-click: acha o chip sob o cursor. Fora de um evento (célula vazia,
  // navbar), suprime o menu (preventDefault também impede o menu nativo) — o
  // ContextMenuTrigger do Radix pula a abertura quando o evento já veio
  // defaultPrevented.
  const aoAbrirMenu = (e: React.MouseEvent) => {
    const alvo = (e.target as HTMLElement).closest?.("[data-event-id]");
    const id = alvo?.getAttribute("data-event-id") ?? null;
    if (!id) {
      e.preventDefault();
      return;
    }
    setMenuEventoId(id);
  };

  const confirmarCancelamento = async (alvoId: string, recarregar: boolean) => {
    if (!cancelarAlvo) return;
    setCancelando(true);
    try {
      await cancelarEvento(alvoId, comentarioCancel.trim());
      // Série: as ocorrências exibidas não casam com o id do master — recarrega.
      if (recarregar) recarregarAgenda();
      setCancelarAlvo(null);
      setComentarioCancel("");
      toast.success(t.controlRoom.agendaCancelado);
    } catch {
      toast.error(t.controlRoom.agendaErroCancelar);
    } finally {
      setCancelando(false);
    }
  };

  // #398: exclui a ocorrência (id dela) ou a série (seriesMasterId) — silencioso.
  const confirmarExclusao = async (alvo: "ocorrencia" | "serie") => {
    if (!excluirAlvo) return;
    const id =
      alvo === "serie" && excluirAlvo.seriesMasterId
        ? excluirAlvo.seriesMasterId
        : excluirAlvo.id;
    setExcluindo(true);
    try {
      await excluirEvento(id);
      if (alvo === "serie") recarregarAgenda();
      setExcluirAlvo(null);
      toast.success(t.controlRoom.agendaExcluido);
    } catch {
      toast.error(t.controlRoom.agendaErroExcluir);
    } finally {
      setExcluindo(false);
    }
  };

  // Cores reais das categorias do Outlook (nome -> hex), uma vez.
  useEffect(() => {
    void carregarCoresAgenda();
  }, [carregarCoresAgenda]);

  // Lista de calendários do usuário (#233). Ao carregar, a slice inicializa a
  // seleção (padrão) e re-busca os eventos com as cores.
  // #495: re-executa quando a caixa selecionada muda — calendários e eventos
  // passam a ser os da caixa (própria = /me, compartilhada = /users/{addr}).
  useEffect(() => {
    void carregarCalendarios();
  }, [carregarCalendarios, caixaAtiva]);

  // Uma mudança de faixa visível (mês/semana/dia ou navegação) re-busca os
  // eventos daquele intervalo. `recargaAgenda` força o refetch no retry e após
  // gravações (para reconciliar com o servidor).
  const buscarFaixa = useMemo(
    () => (info: EventCalendarRangeInfo) => {
      void carregarMesAgenda(
        info.range.start.toISOString(),
        info.range.end.toISOString(),
      );
    },
    [carregarMesAgenda],
  );

  // Refetch quando o contador de recarga muda (retry / pós-escrita). Usa a
  // faixa do mês corrente do store como aproximação segura.
  useEffect(() => {
    if (recargaAgenda === 0) return;
    const ini = new Date(dia.getFullYear(), dia.getMonth(), 1);
    const fim = new Date(dia.getFullYear(), dia.getMonth() + 1, 1);
    void carregarMesAgenda(ini.toISOString(), fim.toISOString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargaAgenda]);

  const eventos: CalendarEvent<DadosChipEvento>[] = useMemo(() => {
    return (mesEventos ?? [])
      // Semântica do convite (#287): eventos recusados somem do calendário
      // (mesmo comportamento do Outlook). Os demais estados (aceito/talvez/
      // pendente) aparecem; o RSVP e o badge ficam no detalhe do evento.
      .filter((ev) => ev.resposta !== "declined")
      .map((ev): CalendarEvent<DadosChipEvento> | null => {
        const inicio = new Date(comZ(ev.inicio));
        const fim = new Date(comZ(ev.fim));
        if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
          return null;
        }
        // Cor do calendário de origem (#233) tem prioridade; sem ela (calendário
        // padrão), cai na cor da categoria do Outlook (#211).
        const corCat = ev.categorias?.[0]
          ? coresCat.get(ev.categorias[0])
          : undefined;
        const cor = ev.corCalendario ?? corCat;
        const recorrente =
          ev.tipo === "occurrence" ||
          ev.tipo === "exception" ||
          ev.tipo === "seriesMaster";
        return {
          id: ev.id,
          title: ev.assunto,
          start: inicio,
          end: fim,
          allDay: ev.diaInteiro,
          color: cor,
          // #399: as ocorrências vêm expandidas do calendarView (sem regra de
          // recorrência aqui), então marcamos o instante como parte de uma série
          // pra acender o indicador nativo (ícone repeat) no card.
          isRecurring: recorrente,
          // #213: só arrasta pra reagendar quem o usuário gerencia (organizador)
          // E não é recorrente — mover ocorrência de série criaria uma exceção
          // silenciosa de escopo ambíguo (a série segue pelo Editar, que pergunta
          // ocorrência × série). Convite (não-organizador) também não arrasta.
          draggable: podeGerenciarEvento(ev) && !recorrente,
          // #570: leva o organizador pro chip (avatar em day/week).
          data: { organizadorEmail: ev.organizadorEmail },
          // #214: liga o evento à coluna de recurso (sala) na visão por recurso.
          resourceId: ev.local?.trim() || RECURSO_SEM_LOCAL,
        };
      })
      .filter((e): e is CalendarEvent<DadosChipEvento> => e !== null);
  }, [mesEventos, coresCat]);

  // #570: cache de fotos dos organizadores (mesmo useFotos do #533). Pré-carrega
  // em batch só em day/week (onde o avatar aparece); month não mostra.
  const { getFoto, pedirFotos } = useFotos();
  useEffect(() => {
    if (view !== "day" && view !== "week") return;
    pedirFotos((mesEventos ?? []).map((ev) => ev.organizadorEmail));
  }, [mesEventos, pedirFotos, view]);
  const renderChip = useCallback(
    (props: EventCalendarRenderEventProps<DadosChipEvento>) =>
      renderChipEvento(props, getFoto),
    [getFoto],
  );

  // #214: recursos (salas) da visão por recurso, derivados dos LOCAIS dos eventos
  // carregados — sem depender do Graph rooms (futuro/nicho). Cada sala com evento
  // vira uma coluna; eventos sem sala caem no recurso "sem local". Ordenados por
  // nome (localeCompare do idioma), estáveis via useMemo.
  const recursos: EventCalendarResource[] = useMemo(() => {
    const locais = new Set<string>();
    let temSemLocal = false;
    for (const ev of mesEventos ?? []) {
      if (ev.resposta === "declined") continue;
      const l = ev.local?.trim();
      if (l) locais.add(l);
      else temSemLocal = true;
    }
    const lista: EventCalendarResource[] = [...locais]
      .sort((a, b) => a.localeCompare(b, idioma, { sensitivity: "base" }))
      .map((l) => ({ id: l, title: l }));
    if (temSemLocal) {
      lista.push({ id: RECURSO_SEM_LOCAL, title: t.controlRoom.agendaSemLocal });
    }
    return lista;
  }, [mesEventos, idioma, t]);

  const i18nCal = useMemo(() => montarI18n(t), [t]);
  const locale = localeDe(idioma);

  const aoClicarEvento = (occ: EventCalendarOccurrence) => {
    void selecionarEventoAgenda(occ.eventId);
  };

  const aoClicarSlot = (slot: EventCalendarSlotInfo) => {
    // Clicar numa célula vazia (mês/semana/dia) traz o início do slot. Uma data
    // ausente/inválida chegava crua no toISOString e quebrava com
    // "RangeError: Invalid time value" — validamos antes e, sem data válida,
    // caímos no default seguro do form (próxima hora cheia).
    const d = slot?.date;
    const iso =
      d instanceof Date && !Number.isNaN(d.getTime())
        ? d.toISOString()
        : undefined;
    abrirFormCriar(iso);
  };

  // #213: arrastar num slot vazio abre o criar-evento com a faixa desenhada
  // (início + fim). Datas inválidas caem no default seguro do form.
  const aoCriarPorSlot = (draft: EventCalendarSlotDraft) => {
    const iniOk =
      draft.start instanceof Date && !Number.isNaN(draft.start.getTime());
    const fimOk =
      draft.end instanceof Date && !Number.isNaN(draft.end.getTime());
    abrirFormCriar(
      iniOk ? draft.start.toISOString() : undefined,
      fimOk ? draft.end.toISOString() : undefined,
    );
  };

  // #213: soltar um evento reagenda via PATCH /me/events (só início/fim/dia-
  // inteiro; convidados/corpo intactos). Otimista no store — a UI já mostra o
  // evento no novo horário; o rollback + toast tratam a falha. Retorna `true`
  // (aceita); o calendário nunca muta sozinho, então o store é a fonte da verdade.
  const aoReagendar = (
    update: EventCalendarProposedUpdate<DadosChipEvento>,
  ): boolean => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void reagendarEvento(
      update.event.id,
      paraWallLocal(update.start),
      paraWallLocal(update.end),
      update.allDay,
      tz,
    )
      .then(() => toast.success(t.controlRoom.agendaReagendado))
      .catch(() => toast.error(t.controlRoom.agendaErroReagendar));
    return true;
  };

  // #214: na visão por recurso, arrastar entre colunas trocaria a SALA (o
  // `local`) — fora do escopo do #213 (drag = reagendar tempo). Veta o drop que
  // muda de recurso; o reschedule de horário dentro da mesma sala segue válido.
  const podeSoltar = (
    update: EventCalendarProposedUpdate<DadosChipEvento>,
  ): boolean =>
    update.resourceId === undefined ||
    update.resourceId === update.event.resourceId;

  // #213: feedback quando o usuário TENTA arrastar um evento que não move
  // (recorrente ou convite). Sem escrita silenciosa — explica o caminho (Editar).
  const aoBloquearDrag = (
    _occ: EventCalendarOccurrence<DadosChipEvento>,
    info: { gesture: "move" | "resize"; reason: string },
  ) => {
    if (info.gesture !== "move") return;
    toast.info(t.controlRoom.agendaDragBloqueado);
  };

  if (erroAgenda) {
    // #495: caixa compartilhada sem permissão (403) → empty gracioso, sem botão
    // de retry (relogin/permissão não resolve com refresh).
    const semAcessoCaixa =
      caixaAtiva !== "me" && /403|forbidden/i.test(erroAgenda);
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
        <Empty className="py-8">
          <EmptyHeader>
            <EmptyMedia>
              <CalendarClock className="size-8 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>
              <SoftBlurIn delay={80} stagger={18}>
                {semAcessoCaixa
                  ? t.controlRoom.agendaSemAcessoCaixaTitulo
                  : t.controlRoom.agendaErroTitulo}
              </SoftBlurIn>
            </EmptyTitle>
            <EmptyDescription className="text-xs">
              {semAcessoCaixa
                ? t.controlRoom.agendaSemAcessoCaixaDica
                : t.controlRoom.agendaErroDica}
            </EmptyDescription>
          </EmptyHeader>
          {!semAcessoCaixa && (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={recarregarAgenda}>
                <RefreshCw /> {t.controlRoom.atualizar}
              </Button>
            </EmptyContent>
          )}
        </Empty>
        <EventoFormSheet />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <ContextMenu onOpenChange={(aberto) => !aberto && setMenuEventoId(null)}>
        <ContextMenuTrigger asChild>
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            onContextMenu={aoAbrirMenu}
          >
            <EventCalendar
              events={eventos}
              view={view}
              date={dia}
              views={VIEWS}
              resources={recursos}
              locale={locale}
              i18n={i18nCal}
              loading={mesEventos === null}
              renderEvent={renderChip}
              interactions={INTERACOES}
              showDayAddButton
              onRangeChange={buscarFaixa}
              onDateChange={setDia}
              onViewChange={(v) => setView(v as typeof view)}
              onEventClick={aoClicarEvento}
              onSlotClick={aoClicarSlot}
              onSelectSlot={aoCriarPorSlot}
              onEventUpdate={aoReagendar}
              canDropEvent={podeSoltar}
              onDragBlocked={aoBloquearDrag}
              className="min-h-0 flex-1"
            >
              <div className="flex min-w-0 items-center gap-1 border-b">
                <EventCalendarNav className="min-w-0 flex-1 border-b-0" />
                <EventCalendarToolbar className="shrink-0 gap-1.5 pr-2">
                  <Button size="sm" onClick={() => abrirFormCriar()}>
                    <CalendarPlus /> {t.controlRoom.agendaNovoEvento}
                  </Button>
                </EventCalendarToolbar>
              </div>
              <EventCalendarContent />
            </EventCalendar>
          </div>
        </ContextMenuTrigger>
        <EventoContextMenu
          evento={menuEvento}
          onPedirCancelar={(ev) => {
            setCancelarAlvo(ev);
            setComentarioCancel("");
          }}
          onPedirExcluir={(ev) => setExcluirAlvo(ev)}
        />
      </ContextMenu>
      <EventoFormSheet />
      <CancelarEventoDialog
        alvo={cancelarAlvo}
        comentario={comentarioCancel}
        onComentario={setComentarioCancel}
        cancelando={cancelando}
        onConfirmar={confirmarCancelamento}
        onFechar={() => {
          if (!cancelando) {
            setCancelarAlvo(null);
            setComentarioCancel("");
          }
        }}
      />

      {/* #398: excluir evento recorrente — ocorrência × série (silencioso). */}
      <AlertDialog
        open={excluirAlvo != null}
        onOpenChange={(o) => {
          if (!o && !excluindo) setExcluirAlvo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.controlRoom.agendaExcluirRecorrenteTitulo}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.controlRoom.agendaExcluirRecorrenteDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>
              {t.controlRoom.agendaEditarCancelar}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={excluindo}
              onClick={(e) => {
                e.preventDefault();
                void confirmarExclusao("ocorrencia");
              }}
            >
              {t.controlRoom.agendaEditarEstaOcorrencia}
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              disabled={excluindo}
              onClick={(e) => {
                e.preventDefault();
                void confirmarExclusao("serie");
              }}
            >
              {t.controlRoom.agendaEditarSerie}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Menu de contexto do evento (#330) --------------------------------------
// Right-click num evento abre o ContextMenu do design system (mesmo padrão do
// menu de e-mail #86). As ações NÃO são reimplementadas: cada item chama o
// fluxo que já existe na Agenda — detalhe (#34), editar (#211), RSVP (#287),
// cancelar (#260), excluir. A visibilidade segue as MESMAS condições do detalhe
// (EventoDialog): organizer vs. convidado, com/sem convidados.

function EventoContextMenu({
  evento,
  onPedirCancelar,
  onPedirExcluir,
}: {
  evento: EventoAgenda | null;
  onPedirCancelar: (ev: EventoAgenda) => void;
  onPedirExcluir: (ev: EventoAgenda) => void;
}) {
  const { t } = useIdioma();
  const selecionarEventoAgenda = useAppStore((s) => s.selecionarEventoAgenda);
  const abrirFormEditar = useAppStore((s) => s.abrirFormEditar);
  const excluirEvento = useAppStore((s) => s.excluirEvento);
  const responderEvento = useAppStore((s) => s.responderEvento);

  // Sem alvo resolvido (ainda), o conteúdo fica vazio; o trigger só abre o menu
  // quando o right-click acerta um chip (data-event-id), então isto é defensivo.
  if (!evento) return <ContextMenuContent />;

  // Mesmas condições do detalhe (#287/#260): convidado (não organizer) com
  // resposta solicitada pode dar RSVP; organizer COM convidados pode cancelar.
  const podeGerenciar = podeGerenciarEvento(evento);
  const ehConvite = !podeGerenciar;
  const podeResponder = ehConvite && evento.respostaSolicitada;
  const podeCancelar = podeGerenciar && evento.totalParticipantes > 0;

  const excluir = async () => {
    if (!podeGerenciar) return;
    // #398: recorrente pergunta ocorrência × série (via dialog no AgendaView).
    if (ehRecorrente(evento)) {
      onPedirExcluir(evento);
      return;
    }
    try {
      await excluirEvento(evento.id);
      toast.success(t.controlRoom.agendaExcluido);
    } catch {
      toast.error(t.controlRoom.agendaErroExcluir);
    }
  };

  // RSVP rápido pelo menu (#287): envia resposta ao organizador, sem comentário
  // (o detalhe segue disponível pra RSVP com comentário/opções).
  const responder = async (acao: AcaoRsvp) => {
    try {
      await responderEvento(evento.id, acao, true, "");
      toast.success(t.controlRoom.rsvpEnviado);
    } catch {
      toast.error(t.controlRoom.rsvpErro);
    }
  };

  return (
    <ContextMenuContent className="w-52">
      <ContextMenuItem
        className="gap-2"
        onClick={() => void selecionarEventoAgenda(evento.id)}
      >
        <Eye /> {t.controlRoom.agendaVerDetalhes}
      </ContextMenuItem>
      {podeGerenciar &&
        (ehRecorrente(evento) ? (
          // #397: recorrente escolhe o escopo no próprio Edit — nada de prompt
          // depois de preencher o form.
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2">
              <Pencil /> {t.controlRoom.agendaEditar}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                className="gap-2"
                onClick={() => abrirFormEditar(evento, "ocorrencia")}
              >
                {t.controlRoom.agendaEditarEstaOcorrencia}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2"
                onClick={() => abrirFormEditar(evento, "serie")}
              >
                {t.controlRoom.agendaEditarSerie}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem
            className="gap-2"
            onClick={() => abrirFormEditar(evento)}
          >
            <Pencil /> {t.controlRoom.agendaEditar}
          </ContextMenuItem>
        ))}

      {podeResponder && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <Check /> {t.controlRoom.rsvpTitulo}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              className="gap-2"
              onClick={() => void responder("accept")}
            >
              <Check /> {t.controlRoom.rsvpAceitar}
            </ContextMenuItem>
            <ContextMenuItem
              className="gap-2"
              onClick={() => void responder("tentativelyAccept")}
            >
              <CircleHelp /> {t.controlRoom.rsvpTalvez}
            </ContextMenuItem>
            <ContextMenuItem
              className="gap-2"
              onClick={() => void responder("decline")}
            >
              <X /> {t.controlRoom.rsvpRecusar}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}

      {podeGerenciar && (
        <>
          <ContextMenuSeparator />
          {podeCancelar && (
            <ContextMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => onPedirCancelar(evento)}
            >
              <CalendarX2 /> {t.controlRoom.agendaCancelar}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            variant="destructive"
            className="gap-2"
            onClick={() => void excluir()}
          >
            <Trash2 /> {t.controlRoom.agendaExcluir}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

// Confirmação do "Cancelar evento" (#260) acionada pelo menu de contexto. Mesmo
// AlertDialog + campo de comentário do detalhe (EventoDialog): o comentário
// segue aos convidados junto do cancelamento.
function CancelarEventoDialog({
  alvo,
  comentario,
  onComentario,
  cancelando,
  onConfirmar,
  onFechar,
}: {
  alvo: EventoAgenda | null;
  comentario: string;
  onComentario: (v: string) => void;
  cancelando: boolean;
  onConfirmar: (alvoId: string, recarregar: boolean) => void;
  onFechar: () => void;
}) {
  const { t } = useIdioma();
  const recorrente = alvo ? ehRecorrente(alvo) : false;
  return (
    <AlertDialog open={!!alvo} onOpenChange={(aberto) => !aberto && onFechar()}>
      <AlertDialogContent className="max-w-md!">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.controlRoom.agendaCancelarTitulo}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.controlRoom.agendaCancelarDesc}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="agenda-menu-cancelar-comentario">
            {t.controlRoom.agendaCancelarComentario}
          </Label>
          <Textarea
            id="agenda-menu-cancelar-comentario"
            value={comentario}
            onChange={(e) => onComentario(e.target.value)}
            placeholder={t.controlRoom.agendaCancelarComentarioPlaceholder}
            rows={3}
            disabled={cancelando}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelando}>
            {t.controlRoom.agendaCancelarVoltar}
          </AlertDialogCancel>
          {recorrente ? (
            // #398: recorrente — cancelar esta ocorrência × a série inteira.
            <>
              <AlertDialogAction
                variant="destructive"
                disabled={cancelando}
                onClick={(e) => {
                  e.preventDefault();
                  if (alvo) onConfirmar(alvo.id, false);
                }}
              >
                {t.controlRoom.agendaEditarEstaOcorrencia}
              </AlertDialogAction>
              <AlertDialogAction
                variant="destructive"
                disabled={cancelando}
                onClick={(e) => {
                  e.preventDefault();
                  if (alvo?.seriesMasterId) onConfirmar(alvo.seriesMasterId, true);
                }}
              >
                {cancelando && <Spinner className="size-4" />}
                {t.controlRoom.agendaEditarSerie}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction
              variant="destructive"
              disabled={cancelando}
              onClick={(e) => {
                // Segura o fechamento até a chamada resolver (spinner enquanto o
                // Graph notifica os convidados).
                e.preventDefault();
                if (alvo) onConfirmar(alvo.id, false);
              }}
            >
              {cancelando && <Spinner className="size-4" />}
              {t.controlRoom.agendaCancelarConfirmar}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Sheet criar/editar (mesma casca do detalhe de evento #34 / compose) -----

const SEM_CATEGORIA = "__nenhuma__";

// Presets de cor do Outlook (subconjunto) para criar categoria. O `preset` é o
// valor que o Graph aceita em masterCategories.color; o hex é só o swatch.
const CORES_PRESET: { preset: string; hex: string }[] = [
  { preset: "preset0", hex: "#D13438" },
  { preset: "preset1", hex: "#FF8C00" },
  { preset: "preset3", hex: "#EAA300" },
  { preset: "preset4", hex: "#498205" },
  { preset: "preset5", hex: "#00B7C3" },
  { preset: "preset7", hex: "#0078D4" },
  { preset: "preset8", hex: "#8764B8" },
  { preset: "preset9", hex: "#C239B3" },
];

function EventoFormSheet() {
  const { t } = useIdioma();
  const aberto = useAppStore((s) => s.agendaFormAberto);
  const modo = useAppStore((s) => s.agendaFormModo);
  const evento = useAppStore((s) => s.agendaFormEvento);
  const presetInicio = useAppStore((s) => s.agendaFormInicio);
  // #213: fim do slot arrastado (drag-to-book) — semeia a duração no form criar.
  const presetFim = useAppStore((s) => s.agendaFormFim);
  // Convidados completos do evento em edição (#240): buscados ao abrir o Sheet.
  const convidadosFull = useAppStore((s) => s.agendaFormConvidados);
  const convidadosCarregando = useAppStore(
    (s) => s.agendaFormConvidadosCarregando,
  );
  const fecharForm = useAppStore((s) => s.fecharForm);
  const criarEvento = useAppStore((s) => s.criarEvento);
  const editarEvento = useAppStore((s) => s.editarEvento);
  const recarregarAgenda = useAppStore((s) => s.recarregarAgenda);
  // #397: o escopo (ocorrência × série) é escolhido no menu Edit ANTES de abrir
  // o form; o save apenas o respeita — nada de prompt no meio do save.
  const escopoRec = useAppStore((s) => s.agendaFormEscopo);
  const criarCategoria = useAppStore((s) => s.criarCategoria);
  const coresCat = useAppStore((s) => s.agendaCoresCategoria);
  const calendarios = useAppStore((s) => s.agendaCalendarios);
  const selCalendarios = useAppStore((s) => s.agendaCalendariosSelecionados);

  const [titulo, setTitulo] = useState("");
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [inicioDT, setInicioDT] = useState("");
  const [fimDT, setFimDT] = useState("");
  const [inicioD, setInicioD] = useState("");
  const [fimD, setFimD] = useState("");
  const [local, setLocal] = useState("");
  const [categoria, setCategoria] = useState<string>(SEM_CATEGORIA);
  // Convidados: buffer local do Sheet (como os outros campos). `convEmails` é a
  // lista canônica (do people-picker); `convPessoas` guarda nome/foto p/ montar
  // os attendees do Graph.
  const [convEmails, setConvEmails] = useState<string[]>([]);
  const [convPessoas, setConvPessoas] = useState<Pessoa[]>([]);
  const [reuniaoTeams, setReuniaoTeams] = useState(false);
  const [calendarioAlvo, setCalendarioAlvo] = useState<string>("");
  const [salvando, setSalvando] = useState(false);
  // #397: assinatura do schedule (início/fim/dia-inteiro) como semeado ao abrir
  // o form em edição. Ao editar a SÉRIE, só forçamos o schedule no seriesMaster
  // se o usuário DE FATO mexeu no horário — senão preservamos (somente_campos).
  const scheduleSeedRef = useRef<string | null>(null);
  // #397: início REAL da série (do fetch da recorrência) — usado no montar pra NÃO
  // mover o começo da série ao editar (a data no form é a da ocorrência). E a
  // assinatura da recorrência semeada, pra detectar no save se o usuário mexeu no
  // padrão (aí NÃO usa `somente_campos`, senão o recurrence editado não é enviado).
  const recSerieInicioRef = useRef<string | null>(null);
  const recSeedRef = useRef<string>("never");

  // Recorrência (#396, S1 criar; #397 S2 editar série). "never" = único.
  const [recFreq, setRecFreq] = useState<"never" | RecorrenciaFrequencia>(
    "never",
  );
  const [recIntervalo, setRecIntervalo] = useState(1);
  const [recDias, setRecDias] = useState<DiaSemana[]>([]);
  const [recFim, setRecFim] = useState<RecorrenciaFim>("noEnd");
  const [recDataFim, setRecDataFim] = useState("");
  const [recNumOcorr, setRecNumOcorr] = useState(10);

  // Só dá pra criar em calendários editáveis (#233). Calendários somente-leitura
  // (feriados, aniversários, compartilhados) ficam de fora do alvo de criação.
  const calsEditaveis = useMemo(
    () => (calendarios ?? []).filter((c) => c.canEdit),
    [calendarios],
  );

  // Criação inline de categoria.
  const [criandoCat, setCriandoCat] = useState(false);
  const [novaCatNome, setNovaCatNome] = useState("");
  const [novaCatPreset, setNovaCatPreset] = useState(CORES_PRESET[0].preset);
  const [criandoCatSalvando, setCriandoCatSalvando] = useState(false);

  const categorias = useMemo(() => [...coresCat.keys()], [coresCat]);

  // Preenche o formulário sempre que o Sheet abre (por modo/evento/preset).
  useEffect(() => {
    if (!aberto) return;
    setCriandoCat(false);
    setNovaCatNome("");
    setNovaCatPreset(CORES_PRESET[0].preset);
    if (modo === "editar" && evento) {
      setTitulo(evento.assunto);
      setDiaInteiro(evento.diaInteiro);
      setLocal(evento.local ?? "");
      setCategoria(evento.categorias?.[0] ?? SEM_CATEGORIA);
      // Convidados são semeados por um efeito dedicado a partir da lista
      // COMPLETA (#240) — ver abaixo; o resumo do mês trunca em 5.
      setReuniaoTeams(evento.online);
      // Editar não move o evento de calendário (#233): alvo fica neutro.
      setCalendarioAlvo("");
      if (evento.diaInteiro) {
        setInicioD(paraInputData(evento.inicio));
        // fim é exclusivo (dia seguinte); mostramos o último dia inclusivo
        setFimD(somarDias(paraInputData(evento.fim), -1) || paraInputData(evento.fim));
      } else {
        setInicioDT(paraInputLocal(evento.inicio));
        setFimDT(paraInputLocal(evento.fim));
      }
      // #397: assinatura do schedule semeado, pra detectar no save se o usuário
      // mexeu no horário (aí a edição de série aplica start/end no master).
      scheduleSeedRef.current = evento.diaInteiro
        ? `d|${paraInputData(evento.inicio)}|${somarDias(paraInputData(evento.fim), -1) || paraInputData(evento.fim)}`
        : `t|${paraInputLocal(evento.inicio)}|${paraInputLocal(evento.fim)}`;
    } else {
      scheduleSeedRef.current = null;
      // Preset do clique pode vir inválido/ausente — cai na próxima hora cheia.
      const bruta = presetInicio ? new Date(comZ(presetInicio)) : proximaHora();
      const base = Number.isNaN(bruta.getTime()) ? proximaHora() : bruta;
      const baseIso = base.toISOString();
      // #213: um slot ARRASTADO traz o fim (honra a duração desenhada); clique/
      // botão não traz e cai em +1h. Fim inválido/antes do início também cai no
      // default seguro.
      const fimBruta = presetFim ? new Date(comZ(presetFim)) : null;
      const maisUma =
        fimBruta && !Number.isNaN(fimBruta.getTime()) && fimBruta > base
          ? fimBruta.toISOString()
          : new Date(base.getTime() + 60 * 60000).toISOString();
      setTitulo("");
      setDiaInteiro(false);
      setLocal("");
      setCategoria(SEM_CATEGORIA);
      setConvEmails([]);
      setConvPessoas([]);
      setReuniaoTeams(false);
      setRecFreq("never");
      setRecIntervalo(1);
      setRecDias([]);
      setRecFim("noEnd");
      setRecDataFim("");
      setRecNumOcorr(10);
      setInicioDT(paraInputLocal(baseIso));
      setFimDT(paraInputLocal(maisUma));
      setInicioD(paraInputData(baseIso));
      setFimD(paraInputData(baseIso));
      // Calendário-alvo default (#233): se há exatamente um editável selecionado
      // na navbar, usa ele; senão cai no calendário padrão do usuário.
      const editaveisSel = calsEditaveis.filter((c) =>
        (selCalendarios ?? []).includes(c.id),
      );
      const alvoDefault =
        editaveisSel.length === 1
          ? editaveisSel[0].id
          : (calsEditaveis.find((c) => c.isDefaultCalendar)?.id ?? "");
      setCalendarioAlvo(alvoDefault);
    }
  }, [aberto, modo, evento, presetInicio, presetFim, calsEditaveis, selCalendarios]);

  // Semeia os convidados do form de EDIÇÃO a partir da lista COMPLETA (#240). O
  // resumo do mês trunca em 5 e o PATCH /me/events/{id} substitui a coleção de
  // attendees; então o form precisa dos attendees completos antes de montar o
  // patch. `convidadosFull` começa com o seed truncado (instantâneo) e é trocado
  // pela lista completa assim que o detalhe chega; o salvar fica bloqueado até
  // lá. Efeito à parte para não re-semear/limpar título e datas já digitados.
  useEffect(() => {
    if (!aberto || modo !== "editar") return;
    const parts = convidadosFull ?? [];
    setConvEmails(parts.map((p) => p.email).filter(Boolean));
    setConvPessoas(parts.map((p) => ({ nome: p.nome, email: p.email })));
  }, [aberto, modo, convidadosFull]);

  // Convidados no formato do Graph: nome resolvido pelo people-picker, senão o
  // próprio e-mail.
  const montarConvidados = (): ConvidadoInput[] =>
    convEmails.map((email) => {
      const p = convPessoas.find(
        (x) => x.email.trim().toLowerCase() === email.trim().toLowerCase(),
      );
      return { email, nome: p?.nome ?? email };
    });

  // #397: assinatura do estado de recorrência do form — comparada com a semeada
  // (`recSeedRef`) no save pra saber se o usuário MEXEU no padrão ao editar a série.
  const assinaturaRec = (): string =>
    recFreq === "never"
      ? "never"
      : `${recFreq}|${recIntervalo}|${[...recDias].sort().join(",")}|${recFim}|${recDataFim}|${recNumOcorr}`;

  // Monta a recorrência a partir do estado do form (#396 criar; #397 editar série).
  // weekly sem dias marcados cai no dia da data de início. Ao editar a SÉRIE, o
  // início vem da PRÓPRIA série (fetch), não da data da ocorrência no form — senão
  // salvar a série moveria o começo dela.
  const montarRecorrencia = (dataOcorrencia: string): RecorrenciaInput | undefined => {
    const editandoSerie = modo === "editar" && escopoRec === "serie";
    if ((modo !== "criar" && !editandoSerie) || recFreq === "never") return undefined;
    const inicio = editandoSerie
      ? (recSerieInicioRef.current ?? dataOcorrencia)
      : dataOcorrencia;
    if (!inicio) return undefined;
    const dias =
      recFreq === "weekly"
        ? recDias.length > 0
          ? recDias
          : [diaDaData(inicio)]
        : [];
    return {
      frequencia: recFreq,
      intervalo: Math.max(1, recIntervalo || 1),
      diasSemana: dias,
      diaDoMes:
        recFreq === "monthly" || recFreq === "yearly"
          ? Number(inicio.slice(8, 10))
          : undefined,
      mes: recFreq === "yearly" ? Number(inicio.slice(5, 7)) : undefined,
      fimTipo: recFim,
      dataInicio: inicio,
      dataFim: recFim === "endDate" ? recDataFim || undefined : undefined,
      numeroOcorrencias:
        recFim === "numbered" ? Math.max(1, recNumOcorr || 1) : undefined,
    };
  };

  const montarInput = (): EventoInput | null => {
    const assunto = titulo.trim();
    if (!assunto) {
      toast.error(t.controlRoom.agendaTituloObrigatorio);
      return null;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cats = categoria !== SEM_CATEGORIA ? [categoria] : [];
    const convidados = montarConvidados();
    // Calendário-alvo (#233): só ao criar e só quando for um calendário editável
    // diferente do padrão — assim o caminho do padrão segue /me/events (#211).
    const calObj = calsEditaveis.find((c) => c.id === calendarioAlvo);
    const calendarioId =
      modo === "criar" && calObj && !calObj.isDefaultCalendar
        ? calObj.id
        : undefined;
    if (diaInteiro) {
      if (!inicioD) return null;
      const fimBase = fimD && fimD >= inicioD ? fimD : inicioD;
      return {
        assunto,
        inicio: `${inicioD}T00:00:00`,
        fim: `${somarDias(fimBase, 1)}T00:00:00`, // exclusivo
        diaInteiro: true,
        local: local.trim(),
        corpo: "",
        categorias: cats,
        timeZone,
        convidados,
        reuniaoTeams,
        calendarioId,
        recorrencia: montarRecorrencia(inicioD),
      };
    }
    if (!inicioDT) return null;
    const fimVal = fimDT && fimDT > inicioDT ? fimDT : maisUmaHora(inicioDT);
    return {
      assunto,
      inicio: `${inicioDT}:00`,
      fim: `${fimVal}:00`,
      diaInteiro: false,
      local: local.trim(),
      corpo: "",
      categorias: cats,
      timeZone,
      convidados,
      reuniaoTeams,
      calendarioId,
      recorrencia: montarRecorrencia(inicioDT.slice(0, 10)),
    };
  };

  // #397: um evento é recorrente quando é ocorrência/exceção/série.
  const eventoRecorrente =
    !!evento &&
    (evento.tipo === "occurrence" ||
      evento.tipo === "exception" ||
      evento.tipo === "seriesMaster");

  // #397: ao abrir o Edit da SÉRIE, carrega a recorrência do master pra o form
  // MOSTRAR/editar os campos (a reprovação foi "não carrega os campos da
  // recorrência"). Ocorrência, não-recorrente ou padrão não modelado (relative*):
  // recFreq "never" (sem edição de recorrência). Async à parte pra não re-semear
  // título/datas do efeito de carga principal.
  useEffect(() => {
    if (!aberto || modo !== "editar" || !evento) return;
    const editaSerie = escopoRec === "serie" && eventoRecorrente;
    if (!editaSerie) {
      setRecFreq("never");
      recSeedRef.current = "never";
      recSerieInicioRef.current = null;
      return;
    }
    const masterId =
      evento.tipo === "seriesMaster" ? evento.id : evento.seriesMasterId;
    if (!masterId) return;
    let vivo = true;
    void crEventoRecorrencia(masterId)
      .then((rec) => {
        if (!vivo) return;
        if (!rec) {
          setRecFreq("never");
          recSeedRef.current = "never";
          recSerieInicioRef.current = null;
          return;
        }
        setRecFreq(rec.frequencia);
        setRecIntervalo(rec.intervalo);
        setRecDias(rec.diasSemana);
        setRecFim(rec.fimTipo);
        setRecDataFim(rec.dataFim ?? "");
        setRecNumOcorr(rec.numeroOcorrencias ?? 10);
        recSerieInicioRef.current = rec.dataInicio;
        recSeedRef.current = `${rec.frequencia}|${rec.intervalo}|${[...rec.diasSemana].sort().join(",")}|${rec.fimTipo}|${rec.dataFim ?? ""}|${rec.numeroOcorrencias ?? 10}`;
      })
      .catch(() => {
        if (!vivo) return;
        setRecFreq("never");
        recSeedRef.current = "never";
        recSerieInicioRef.current = null;
      });
    return () => {
      vivo = false;
    };
  }, [aberto, modo, evento, escopoRec, eventoRecorrente]);

  const executarSalvar = async (
    idAlvo: string | null,
    input: EventoInput,
    recarregar: boolean,
  ) => {
    setSalvando(true);
    try {
      if (modo === "editar" && evento && idAlvo) {
        await editarEvento(idAlvo, input);
        // Série: as ocorrências exibidas não casam com o id do master no update
        // otimista — recarrega o range pra refletir a mudança em todas.
        if (recarregar) recarregarAgenda();
        toast.success(t.controlRoom.agendaAtualizado);
      } else {
        await criarEvento(input);
        toast.success(t.controlRoom.agendaCriado);
      }
      fecharForm();
    } catch {
      toast.error(t.controlRoom.agendaErroSalvar);
    } finally {
      setSalvando(false);
    }
  };

  const salvar = async () => {
    const input = montarInput();
    if (!input) return;
    // #397: o escopo já foi decidido no menu Edit (ocorrência × série). "Série"
    // aplica no seriesMaster + recarrega. Se o usuário MEXEU no horário, manda
    // start/end (o Graph desloca a série toda); se NÃO mexeu, `somente_campos`
    // preserva o schedule e altera só os campos. "Ocorrência" é PATCH normal no
    // id dela (vira exceção no Graph). Sem prompt.
    if (modo === "editar" && evento && eventoRecorrente && escopoRec === "serie") {
      const idSerie = evento.seriesMasterId ?? evento.id;
      const scheduleAtual = diaInteiro
        ? `d|${inicioD}|${fimD}`
        : `t|${inicioDT}|${fimDT}`;
      const scheduleMudou = scheduleSeedRef.current !== scheduleAtual;
      // #397: se o usuário mexeu no PADRÃO de recorrência, o PATCH tem que enviar o
      // `recurrence` — então NÃO pode ser somente_campos (que omite recurrence).
      const recorrenciaMudou = recSeedRef.current !== assinaturaRec();
      await executarSalvar(
        idSerie,
        { ...input, somenteCampos: !scheduleMudou && !recorrenciaMudou },
        true,
      );
      return;
    }
    await executarSalvar(
      modo === "editar" && evento ? evento.id : null,
      input,
      false,
    );
  };

  // Cria a categoria via store (Graph) e já a seleciona no evento.
  const salvarCategoria = async () => {
    const nome = novaCatNome.trim();
    if (!nome) return;
    setCriandoCatSalvando(true);
    try {
      const criada = await criarCategoria(nome, novaCatPreset);
      setCategoria(criada);
      setCriandoCat(false);
      setNovaCatNome("");
      toast.success(t.controlRoom.agendaCategoriaCriada);
    } catch {
      toast.error(t.controlRoom.agendaCategoriaErro);
    } finally {
      setCriandoCatSalvando(false);
    }
  };

  return (
    <>
    <Sheet open={aberto} onOpenChange={(o) => !o && fecharForm()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-left">
            {modo !== "editar"
              ? t.controlRoom.agendaFormCriarTitulo
              : eventoRecorrente && escopoRec === "serie"
                ? t.controlRoom.agendaFormEditarSerieTitulo
                : eventoRecorrente && escopoRec === "ocorrencia"
                  ? t.controlRoom.agendaFormEditarOcorrenciaTitulo
                  : t.controlRoom.agendaFormEditarTitulo}
          </SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-fina px-4 py-4">
          <Field>
            <FieldLabel htmlFor="agenda-titulo">
              {t.controlRoom.agendaFormTitulo}
            </FieldLabel>
            <Input
              id="agenda-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t.controlRoom.agendaFormTituloPlaceholder}
              autoFocus
            />
          </Field>

          <Field orientation="horizontal" className="w-auto">
            <Switch
              id="agenda-dia-inteiro"
              checked={diaInteiro}
              onCheckedChange={setDiaInteiro}
            />
            <FieldLabel htmlFor="agenda-dia-inteiro">
              {t.controlRoom.agendaFormDiaInteiro}
            </FieldLabel>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="agenda-inicio">
                {t.controlRoom.agendaFormInicio}
              </FieldLabel>
              {diaInteiro ? (
                <Input
                  id="agenda-inicio"
                  type="date"
                  value={inicioD}
                  onChange={(e) => setInicioD(e.target.value)}
                />
              ) : (
                <Input
                  id="agenda-inicio"
                  type="datetime-local"
                  value={inicioDT}
                  onChange={(e) => setInicioDT(e.target.value)}
                />
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="agenda-fim">
                {t.controlRoom.agendaFormFim}
              </FieldLabel>
              {diaInteiro ? (
                <Input
                  id="agenda-fim"
                  type="date"
                  value={fimD}
                  onChange={(e) => setFimD(e.target.value)}
                />
              ) : (
                <Input
                  id="agenda-fim"
                  type="datetime-local"
                  value={fimDT}
                  onChange={(e) => setFimDT(e.target.value)}
                />
              )}
            </Field>
          </div>

          {/* Convidar pessoas — mesmo people-picker do compose (To/Cc). O
              próprio CampoPessoas renderiza o rótulo "Convidados" à esquerda. */}
          <Field>
            <div className="rounded-md border px-0.5 py-0.5">
              <CampoPessoas
                rotulo={t.controlRoom.agendaFormConvidados}
                valor={convEmails}
                onChange={setConvEmails}
                onPessoas={setConvPessoas}
                placeholder={t.controlRoom.agendaFormConvidadosPlaceholder}
                compactarSelecionados
              />
            </div>
          </Field>

          {/* Reunião do Teams — liga isOnlineMeeting no payload Graph. */}
          <Field orientation="horizontal" className="w-auto">
            <Switch
              id="agenda-teams"
              checked={reuniaoTeams}
              onCheckedChange={setReuniaoTeams}
            />
            <FieldLabel htmlFor="agenda-teams" className="flex items-center gap-1.5">
              <Video className="size-4 text-muted-foreground" />
              {t.controlRoom.agendaFormTeams}
            </FieldLabel>
          </Field>

          {/* Recorrência (#396, S1) — só ao criar; editar série é o S2. */}
          {/* #397: recorrência aparece ao CRIAR e ao editar a SÉRIE (carregada do
              master). Ocorrência não edita recorrência (vira exceção). */}
          {(modo === "criar" ||
            (modo === "editar" && eventoRecorrente && escopoRec === "serie")) && (
            <Field>
              <FieldLabel htmlFor="agenda-recorrencia">
                {t.controlRoom.agendaFormRepetir}
              </FieldLabel>
              <Select
                value={recFreq}
                onValueChange={(v) =>
                  setRecFreq(v as "never" | RecorrenciaFrequencia)
                }
              >
                <SelectTrigger id="agenda-recorrencia" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">
                    {t.controlRoom.agendaRepetirNunca}
                  </SelectItem>
                  <SelectItem value="daily">
                    {t.controlRoom.agendaRepetirDiario}
                  </SelectItem>
                  <SelectItem value="weekly">
                    {t.controlRoom.agendaRepetirSemanal}
                  </SelectItem>
                  <SelectItem value="monthly">
                    {t.controlRoom.agendaRepetirMensal}
                  </SelectItem>
                  <SelectItem value="yearly">
                    {t.controlRoom.agendaRepetirAnual}
                  </SelectItem>
                </SelectContent>
              </Select>

              {recFreq !== "never" && (
                <div className="mt-2 grid gap-3 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {t.controlRoom.agendaRepetirACada}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      value={recIntervalo}
                      onChange={(e) =>
                        setRecIntervalo(Math.max(1, Number(e.target.value) || 1))
                      }
                      className="w-20"
                      aria-label={t.controlRoom.agendaRepetirACada}
                    />
                  </div>

                  {recFreq === "weekly" && (
                    <div className="flex flex-wrap gap-1">
                      {ORDEM_DIAS.map((dia) => {
                        const ativo = recDias.includes(dia);
                        return (
                          <Button
                            key={dia}
                            type="button"
                            size="sm"
                            variant={ativo ? "default" : "outline"}
                            className="h-8 min-w-9 px-2 capitalize"
                            aria-pressed={ativo}
                            onClick={() =>
                              setRecDias((atual) =>
                                atual.includes(dia)
                                  ? atual.filter((d) => d !== dia)
                                  : [...atual, dia],
                              )
                            }
                          >
                            {rotuloDiaCurto(dia)}
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid gap-2">
                    <span className="text-sm text-muted-foreground">
                      {t.controlRoom.agendaRepetirTermina}
                    </span>
                    <Select
                      value={recFim}
                      onValueChange={(v) => setRecFim(v as RecorrenciaFim)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="noEnd">
                          {t.controlRoom.agendaRepetirNuncaTermina}
                        </SelectItem>
                        <SelectItem value="endDate">
                          {t.controlRoom.agendaRepetirAteData}
                        </SelectItem>
                        <SelectItem value="numbered">
                          {t.controlRoom.agendaRepetirAposN}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {recFim === "endDate" && (
                      <Input
                        type="date"
                        value={recDataFim}
                        onChange={(e) => setRecDataFim(e.target.value)}
                        aria-label={t.controlRoom.agendaRepetirAteData}
                      />
                    )}
                    {recFim === "numbered" && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={recNumOcorr}
                          onChange={(e) =>
                            setRecNumOcorr(
                              Math.max(1, Number(e.target.value) || 1),
                            )
                          }
                          className="w-20"
                          aria-label={t.controlRoom.agendaRepetirAposN}
                        />
                        <span className="text-sm text-muted-foreground">
                          {t.controlRoom.agendaRepetirOcorrencias}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="agenda-local">
              {t.controlRoom.agendaFormLocal}
            </FieldLabel>
            <Input
              id="agenda-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
            />
          </Field>

          {/* Calendário-alvo (#233): só ao criar e havendo mais de um editável. */}
          {modo === "criar" && calsEditaveis.length > 1 && (
            <Field>
              <FieldLabel htmlFor="agenda-calendario">
                {t.controlRoom.agendaFormCalendario}
              </FieldLabel>
              <Select value={calendarioAlvo} onValueChange={setCalendarioAlvo}>
                <SelectTrigger id="agenda-calendario" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calsEditaveis.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: c.cor }}
                        />
                        {c.nome}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="agenda-categoria">
                {t.controlRoom.agendaFormCategoria}
              </FieldLabel>
              {!criandoCat && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setCriandoCat(true)}
                >
                  <Plus className="size-3.5" />
                  {t.controlRoom.agendaFormNovaCategoria}
                </Button>
              )}
            </div>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger id="agenda-categoria" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_CATEGORIA}>
                  {t.controlRoom.agendaFormSemCategoria}
                </SelectItem>
                {categorias.map((nome) => (
                  <SelectItem key={nome} value={nome}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: coresCat.get(nome) }}
                      />
                      {nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {criandoCat && (
              <div className="mt-1 flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
                <Input
                  value={novaCatNome}
                  onChange={(e) => setNovaCatNome(e.target.value)}
                  placeholder={t.controlRoom.agendaFormNovaCategoriaNome}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void salvarCategoria();
                    }
                  }}
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {CORES_PRESET.map((c) => (
                    <button
                      key={c.preset}
                      type="button"
                      aria-label={c.preset}
                      onClick={() => setNovaCatPreset(c.preset)}
                      className={
                        "size-6 rounded-full ring-offset-2 ring-offset-background transition " +
                        (novaCatPreset === c.preset
                          ? "ring-2 ring-ring"
                          : "hover:opacity-80")
                      }
                      style={{ background: c.hex }}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCriandoCat(false)}
                    disabled={criandoCatSalvando}
                  >
                    <X className="size-4" />
                    {t.controlRoom.agendaFormCancelar}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void salvarCategoria()}
                    disabled={criandoCatSalvando || !novaCatNome.trim()}
                  >
                    {criandoCatSalvando ? (
                      <Spinner className="size-4" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    {t.controlRoom.agendaFormCriarCategoria}
                  </Button>
                </div>
              </div>
            )}
          </Field>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={fecharForm} disabled={salvando}>
            {t.controlRoom.agendaFormCancelar}
          </Button>
          {/* Ao editar, bloqueia o salvar enquanto os attendees completos ainda
              não chegaram (#240): salvar com a lista truncada substituiria a
              coleção e perderia os convidados além dos 5 do resumo do mês. */}
          <Button
            onClick={() => void salvar()}
            disabled={salvando || (modo === "editar" && convidadosCarregando)}
          >
            {(salvando || (modo === "editar" && convidadosCarregando)) && (
              <Spinner className="size-4" />
            )}
            {modo === "editar"
              ? t.controlRoom.agendaFormSalvar
              : t.controlRoom.agendaFormCriar}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    </>
  );
}

/** Próxima hora cheia (default do início ao criar sem preset). */
function proximaHora(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Soma 1h a um "yyyy-MM-ddTHH:mm" local, devolvendo o mesmo formato. */
function maisUmaHora(valor: string): string {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  d.setHours(d.getHours() + 1);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
