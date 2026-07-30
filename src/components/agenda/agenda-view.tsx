// Agenda (Bridge) — calendário completo com views mês/semana/dia/agenda,
// alimentado por /me/events, com criar/editar/excluir via Graph (#211). A UI do
// calendário é o componente reui `event-calendar` (instalado do registry, usado
// como é); aqui fica só a cola: fetch por faixa visível, estados, i18n e o
// diálogo de CRUD (padrão do c-event-calendar-3).

import { useEffect, useMemo, useState } from "react";
import { enUS, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";
import { toast } from "sonner";
import { CalendarClock, CalendarPlus, RefreshCw } from "lucide-react";

import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";
import type { Idioma } from "@/lib/strings";
import type { EventoAgenda, EventoInput } from "@/lib/types";

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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const selecionarEventoAgenda = useAppStore((s) => s.selecionarEventoAgenda);
  const abrirFormCriar = useAppStore((s) => s.abrirFormCriar);

  // Cores reais das categorias do Outlook (nome -> hex), uma vez.
  useEffect(() => {
    void carregarCoresAgenda();
  }, [carregarCoresAgenda]);

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
      .map((ev): CalendarEvent | null => {
        const inicio = new Date(comZ(ev.inicio));
        const fim = new Date(comZ(ev.fim));
        if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
          return null;
        }
        const cor = ev.categorias?.[0] ? coresCat.get(ev.categorias[0]) : undefined;
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
    abrirFormCriar(slot.date.toISOString());
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
        <EventoFormDialog />
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
          <EventCalendarToolbar className="shrink-0 pr-2">
            <Button size="sm" onClick={() => abrirFormCriar()}>
              <CalendarPlus /> {t.controlRoom.agendaNovoEvento}
            </Button>
          </EventCalendarToolbar>
        </div>
        <EventCalendarContent />
      </EventCalendar>
      <EventoFormDialog />
    </div>
  );
}

// --- diálogo criar/editar (padrão do c-event-calendar-3) --------------------

const SEM_CATEGORIA = "__nenhuma__";

function EventoFormDialog() {
  const { t } = useIdioma();
  const aberto = useAppStore((s) => s.agendaFormAberto);
  const modo = useAppStore((s) => s.agendaFormModo);
  const evento = useAppStore((s) => s.agendaFormEvento);
  const presetInicio = useAppStore((s) => s.agendaFormInicio);
  const fecharForm = useAppStore((s) => s.fecharForm);
  const criarEvento = useAppStore((s) => s.criarEvento);
  const editarEvento = useAppStore((s) => s.editarEvento);
  const coresCat = useAppStore((s) => s.agendaCoresCategoria);

  const [titulo, setTitulo] = useState("");
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [inicioDT, setInicioDT] = useState("");
  const [fimDT, setFimDT] = useState("");
  const [inicioD, setInicioD] = useState("");
  const [fimD, setFimD] = useState("");
  const [local, setLocal] = useState("");
  const [categoria, setCategoria] = useState<string>(SEM_CATEGORIA);
  const [salvando, setSalvando] = useState(false);

  const categorias = useMemo(() => [...coresCat.keys()], [coresCat]);

  // Preenche o formulário sempre que o diálogo abre (por modo/evento/preset).
  useEffect(() => {
    if (!aberto) return;
    if (modo === "editar" && evento) {
      setTitulo(evento.assunto);
      setDiaInteiro(evento.diaInteiro);
      setLocal(evento.local ?? "");
      setCategoria(evento.categorias?.[0] ?? SEM_CATEGORIA);
      if (evento.diaInteiro) {
        setInicioD(paraInputData(evento.inicio));
        // fim é exclusivo (dia seguinte); mostramos o último dia inclusivo
        setFimD(somarDias(paraInputData(evento.fim), -1) || paraInputData(evento.fim));
      } else {
        setInicioDT(paraInputLocal(evento.inicio));
        setFimDT(paraInputLocal(evento.fim));
      }
    } else {
      const base = presetInicio ? new Date(comZ(presetInicio)) : proximaHora();
      const baseIso = base.toISOString();
      const maisUma = new Date(base.getTime() + 60 * 60000).toISOString();
      setTitulo("");
      setDiaInteiro(false);
      setLocal("");
      setCategoria(SEM_CATEGORIA);
      setInicioDT(paraInputLocal(baseIso));
      setFimDT(paraInputLocal(maisUma));
      setInicioD(paraInputData(baseIso));
      setFimD(paraInputData(baseIso));
    }
  }, [aberto, modo, evento, presetInicio]);

  const montarInput = (): EventoInput | null => {
    const assunto = titulo.trim();
    if (!assunto) {
      toast.error(t.controlRoom.agendaTituloObrigatorio);
      return null;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cats = categoria !== SEM_CATEGORIA ? [categoria] : [];
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

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fecharForm()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {modo === "editar"
              ? t.controlRoom.agendaFormEditarTitulo
              : t.controlRoom.agendaFormCriarTitulo}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
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

          {categorias.length > 0 && (
            <Field>
              <FieldLabel htmlFor="agenda-categoria">
                {t.controlRoom.agendaFormCategoria}
              </FieldLabel>
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
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fecharForm} disabled={salvando}>
            {t.controlRoom.agendaFormCancelar}
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando && <Spinner className="size-4" />}
            {modo === "editar"
              ? t.controlRoom.agendaFormSalvar
              : t.controlRoom.agendaFormCriar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
