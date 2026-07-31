// Seletor de calendários da Agenda (#233/#266). Multi-seleção com checkbox por
// calendário, cada um com sua cor. Fonte da verdade é o store (agenda-slice):
// lista + seleção persistida. Sem `useState` local — só leitura por seletor.

import { CalendarRange } from "lucide-react";

import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";
import { cn } from "@/lib/utils";

import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AgendaCalendarSelector({
  colapsada,
}: {
  colapsada: boolean;
}) {
  const { t } = useIdioma();
  const calendarios = useAppStore((s) => s.agendaCalendarios);
  const erro = useAppStore((s) => s.agendaCalendariosErro);
  const selecionados = useAppStore((s) => s.agendaCalendariosSelecionados);
  const alternarCalendario = useAppStore((s) => s.alternarCalendario);

  // Ainda carregando (lista nula e sem erro): mantém o estado no próprio sidebar.
  if (calendarios === null && !erro) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center text-xs text-muted-foreground",
          colapsada ? "size-9 justify-center" : "gap-2 px-2",
        )}
      >
        <Spinner className="size-4" />
        {colapsada ? (
          <span className="sr-only">
            {t.controlRoom.agendaCalendariosCarregando}
          </span>
        ) : (
          t.controlRoom.agendaCalendariosCarregando
        )}
      </div>
    );
  }

  const lista = calendarios ?? [];
  const sel = selecionados ?? [];
  const mensagemEstado = erro
    ? t.controlRoom.agendaCalendariosErro
    : lista.length === 0
      ? t.controlRoom.agendaCalendariosVazio
      : null;

  return (
    <div
      role="group"
      aria-label={t.controlRoom.agendaCalendarios}
      className={cn(
        "flex w-full flex-col gap-0.5",
        colapsada && "items-center",
      )}
    >
      {!colapsada && (
        <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
          {t.controlRoom.agendaCalendarios}
        </p>
      )}

      {mensagemEstado ? (
        colapsada ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-live="polite"
                tabIndex={0}
                className="grid size-9 place-items-center text-muted-foreground"
              >
                <CalendarRange className="size-4" />
                <span className="sr-only">{mensagemEstado}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              {mensagemEstado}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="px-2 py-1.5 text-xs text-muted-foreground"
          >
            {mensagemEstado}
          </p>
        )
      ) : (
        lista.map((cal) => {
          const checkboxId = `agenda-calendario-${cal.id}`;
          const linha = (
            <label
              htmlFor={checkboxId}
              className={cn(
                "flex cursor-pointer items-center rounded-md text-sm transition-colors hover:bg-accent/50",
                colapsada
                  ? "size-9 justify-center gap-1"
                  : "w-full gap-2.5 px-2.5 py-2",
              )}
            >
              <Checkbox
                id={checkboxId}
                checked={sel.includes(cal.id)}
                onCheckedChange={() => alternarCalendario(cal.id)}
                aria-label={cal.nome}
              />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: cal.cor }}
              />
              {!colapsada && (
                <span className="min-w-0 flex-1 truncate text-left">
                  {cal.nome}
                </span>
              )}
            </label>
          );

          return colapsada ? (
            <Tooltip key={cal.id}>
              <TooltipTrigger asChild>{linha}</TooltipTrigger>
              <TooltipContent side="right" align="center">
                {cal.nome}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div key={cal.id}>{linha}</div>
          );
        })
      )}
    </div>
  );
}
