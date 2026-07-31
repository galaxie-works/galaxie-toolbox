// Agenda (Bridge) — calendário completo com views mês/semana/dia/agenda,
// alimentado por /me/events, com criar/editar/excluir via Graph (#211). A UI do
// calendário é o componente reui `event-calendar` (instalado do registry, usado
// como é); aqui fica só a cola: fetch por faixa visível, estados, i18n e o
// diálogo de CRUD (padrão do c-event-calendar-3).

import { useEffect, useMemo, useState } from "react";
import { enUS, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";
import { toast } from "sonner";
import { CalendarClock, CalendarPlus, Check, Plus, RefreshCw, Video, X } from "lucide-react";

import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";
import type { Idioma } from "@/lib/strings";
import type { ConvidadoInput, EventoInput, Pessoa } from "@/lib/types";
import { CampoPessoas } from "@/components/compose/campo-pessoas";
import { AgendaCalendarSelector } from "@/components/agenda/agenda-calendar-selector";

import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import {
  EventCalendarNav,
  EventCalendarToolbar,
} from "@/components/reui/event-calendar/event-calendar-nav";
import type { EventCalendarI18nOverrides } from "@/components/reui/event-calendar/event-calendar-i18n";
import type {
  CalendarEvent,
  EventCalendarOccurrence,
  EventCalendarRangeInfo,
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

// Identidades estáveis: o store do event-calendar compara settings por
// referência, então arrays/objetos recriados a cada render forçariam re-render.
const VIEWS: ("month" | "week" | "day" | "agenda")[] = [
  "month",
  "week",
  "day",
  "agenda",
];
// Sem arrastar/redimensionar nem drag-create: a edição é pelo diálogo (#211).
const INTERACOES = { drag: false, resize: false, selectSlot: false } as const;

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
  const selecionarEventoAgenda = useAppStore((s) => s.selecionarEventoAgenda);
  const abrirFormCriar = useAppStore((s) => s.abrirFormCriar);

  // Cores reais das categorias do Outlook (nome -> hex), uma vez.
  useEffect(() => {
    void carregarCoresAgenda();
  }, [carregarCoresAgenda]);

  // Lista de calendários do usuário (#233), uma vez. Ao carregar, a slice
  // inicializa a seleção (padrão) e re-busca os eventos com as cores.
  useEffect(() => {
    void carregarCalendarios();
  }, [carregarCalendarios]);

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

  const eventos: CalendarEvent[] = useMemo(() => {
    return (mesEventos ?? [])
      // Semântica do convite (#287): eventos recusados somem do calendário
      // (mesmo comportamento do Outlook). Os demais estados (aceito/talvez/
      // pendente) aparecem; o RSVP e o badge ficam no detalhe do evento.
      .filter((ev) => ev.resposta !== "declined")
      .map((ev): CalendarEvent | null => {
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
        return {
          id: ev.id,
          title: ev.assunto,
          start: inicio,
          end: fim,
          allDay: ev.diaInteiro,
          color: cor,
        };
      })
      .filter((e): e is CalendarEvent => e !== null);
  }, [mesEventos, coresCat]);

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

  if (erroAgenda) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
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
            <Button variant="outline" size="sm" onClick={recarregarAgenda}>
              <RefreshCw /> {t.controlRoom.atualizar}
            </Button>
          </EmptyContent>
        </Empty>
        <EventoFormSheet />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <EventCalendar
        events={eventos}
        view={view}
        date={dia}
        views={VIEWS}
        locale={locale}
        i18n={i18nCal}
        loading={mesEventos === null}
        interactions={INTERACOES}
        showDayAddButton
        onRangeChange={buscarFaixa}
        onDateChange={setDia}
        onViewChange={(v) => setView(v as typeof view)}
        onEventClick={aoClicarEvento}
        onSlotClick={aoClicarSlot}
        className="min-h-0 flex-1"
      >
        <div className="flex min-w-0 items-center gap-1 border-b">
          <EventCalendarNav className="min-w-0 flex-1 border-b-0" />
          <EventCalendarToolbar className="shrink-0 gap-1.5 pr-2">
            <AgendaCalendarSelector />
            <Button size="sm" onClick={() => abrirFormCriar()}>
              <CalendarPlus /> {t.controlRoom.agendaNovoEvento}
            </Button>
          </EventCalendarToolbar>
        </div>
        <EventCalendarContent />
      </EventCalendar>
      <EventoFormSheet />
    </div>
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
  // Convidados completos do evento em edição (#240): buscados ao abrir o Sheet.
  const convidadosFull = useAppStore((s) => s.agendaFormConvidados);
  const convidadosCarregando = useAppStore(
    (s) => s.agendaFormConvidadosCarregando,
  );
  const fecharForm = useAppStore((s) => s.fecharForm);
  const criarEvento = useAppStore((s) => s.criarEvento);
  const editarEvento = useAppStore((s) => s.editarEvento);
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
    } else {
      // Preset do clique pode vir inválido/ausente — cai na próxima hora cheia.
      const bruta = presetInicio ? new Date(comZ(presetInicio)) : proximaHora();
      const base = Number.isNaN(bruta.getTime()) ? proximaHora() : bruta;
      const baseIso = base.toISOString();
      const maisUma = new Date(base.getTime() + 60 * 60000).toISOString();
      setTitulo("");
      setDiaInteiro(false);
      setLocal("");
      setCategoria(SEM_CATEGORIA);
      setConvEmails([]);
      setConvPessoas([]);
      setReuniaoTeams(false);
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
  }, [aberto, modo, evento, presetInicio, calsEditaveis, selCalendarios]);

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
    };
  };

  const salvar = async () => {
    const input = montarInput();
    if (!input) return;
    setSalvando(true);
    try {
      if (modo === "editar" && evento) {
        await editarEvento(evento.id, input);
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
    <Sheet open={aberto} onOpenChange={(o) => !o && fecharForm()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-left">
            {modo === "editar"
              ? t.controlRoom.agendaFormEditarTitulo
              : t.controlRoom.agendaFormCriarTitulo}
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
