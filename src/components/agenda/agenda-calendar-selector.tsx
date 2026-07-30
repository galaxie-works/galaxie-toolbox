// Seletor de calendários da Agenda (#233). Multi-seleção com checkbox por
// calendário, cada um com sua cor. Fonte da verdade é o store (agenda-slice):
// lista + seleção persistida. Sem `useState` local — só leitura por seletor.

import { CalendarRange, ChevronDown } from "lucide-react";

import { useAppStore } from "@/store";
import { useIdioma } from "@/lib/idioma";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AgendaCalendarSelector() {
  const { t } = useIdioma();
  const calendarios = useAppStore((s) => s.agendaCalendarios);
  const erro = useAppStore((s) => s.agendaCalendariosErro);
  const selecionados = useAppStore((s) => s.agendaCalendariosSelecionados);
  const alternarCalendario = useAppStore((s) => s.alternarCalendario);

  // Ainda carregando (lista nula e sem erro): mostra spinner no lugar do gatilho.
  if (calendarios === null && !erro) {
    return (
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <Spinner className="size-4" />
        {t.controlRoom.agendaCalendariosCarregando}
      </div>
    );
  }

  const lista = calendarios ?? [];
  const sel = selecionados ?? [];
  const total = lista.length;
  const marcados = sel.length;

  // Rótulo do gatilho conforme a seleção.
  const rotulo =
    marcados === 0
      ? t.controlRoom.agendaCalendariosNenhum
      : marcados === total
        ? t.controlRoom.agendaCalendariosTodos
        : marcados === 1
          ? (lista.find((c) => c.id === sel[0])?.nome ??
            t.controlRoom.agendaCalendarios)
          : t.controlRoom.agendaCalendariosContagem.replace(
              "{n}",
              String(marcados),
            );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <CalendarRange className="size-4" />
          <span className="max-w-[10rem] truncate">{rotulo}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>{t.controlRoom.agendaCalendarios}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {erro ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t.controlRoom.agendaCalendariosErro}
          </div>
        ) : lista.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t.controlRoom.agendaCalendariosVazio}
          </div>
        ) : (
          lista.map((cal) => (
            <DropdownMenuCheckboxItem
              key={cal.id}
              checked={sel.includes(cal.id)}
              // Mantém o menu aberto ao alternar (multi-seleção rápida).
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => alternarCalendario(cal.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: cal.cor }}
                />
                <span className="truncate">{cal.nome}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
