// #724 (Explorer S4 UI) + #875 (Status Center P0): painel de progresso das ops de
// copiar/mover. Agora é uma FILA REVISÁVEL — as ops terminais (concluída/erro/
// cancelada/parcial) PERMANECEM no painel (o shell as retém marcadas por
// `progresso.status`) até serem dispensadas, em vez de sumirem no toast. Traz:
// cabeçalho agregado ("{n} operações · {X}%") + badge de contagem colorido por
// estado, botão "Limpar concluídas", e cards EXPANSÍVEIS (Collapsible do registry)
// com o arquivo atual, proc/total, velocidade e ETA. Presentational — recebe a
// lista de ops e os handlers (cancelar/dispensar/limpar) do shell. Card flutuante
// no canto inferior direito. Reusa Card/Button/Progress/Badge/Collapsible/Spinner
// + formatBytes/i18n. A velocidade é derivada no shell entre eventos.
import { useRef, useState } from "react";
import { AlertCircle, Ban, Check, ChevronDown, Copy, Scissors, Undo2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import type { FsOpProgress } from "@/lib/types";
import type { TipoOp } from "./tipo-op";

import { formatarEta } from "./operacao";
import { TooltipAcao } from "./tooltip-acao";

/** Uma op de copy/move/undo rastreada por opId no shell (ativa OU terminal retida). */
export interface OpAtiva {
  opId: number;
  tipo: TipoOp;
  progresso: FsOpProgress;
  /** Velocidade instantânea (bytes/s) derivada entre eventos de progresso. */
  velocidade: number;
  /** #898 fatia 2: basename do destino pra o resumo terminal (histórico de sessão). */
  destino?: string;
}

/** Uma op é terminal (não-cancelável, dispensável) quando não está mais em curso. */
function ehTerminal(op: OpAtiva): boolean {
  return op.progresso.status !== "inProgress";
}

export function ProgressoPanel({
  ops,
  onCancelar,
  onDispensar,
  onLimparConcluidas,
}: {
  ops: OpAtiva[];
  onCancelar: (opId: number) => void;
  onDispensar: (opId: number) => void;
  onLimparConcluidas: () => void;
}) {
  const { t } = useIdioma();
  if (ops.length === 0) return null;

  const unidades = {
    seg: t.arquivos.etaSeg,
    min: t.arquivos.etaMin,
    hora: t.arquivos.etaHora,
  };

  // Agregado: percentual médio das ops AINDA em curso (as terminais não contam),
  // e se há ao menos uma op terminal (habilita "Limpar concluídas").
  const ativas = ops.filter((o) => !ehTerminal(o));
  const temTerminal = ops.some(ehTerminal);
  const temErro = ops.some(
    (o) => o.progresso.status === "error" || o.progresso.status === "partial",
  );
  const avgPercent =
    ativas.length > 0
      ? Math.round(
          ativas.reduce(
            (s, o) => s + Math.max(0, Math.min(100, o.progresso.percent)),
            0,
          ) / ativas.length,
        )
      : null;

  const cabecalho =
    preencher(t.arquivos.statusCenterOps, { n: ops.length }) +
    (avgPercent != null ? ` · ${avgPercent}%` : "");

  // Badge de contagem colorido pelo estado agregado: erro (vermelho) > em curso
  // (primário) > tudo concluído (verde/success).
  const badgeVariant = temErro ? "outline" : ativas.length > 0 ? "default" : "success";
  const badgeExtra = temErro ? "border-transparent bg-destructive/10 text-destructive" : "";

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-40 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2">
      {/* Cabeçalho agregado (badge + "N operações · X%" + Limpar concluídas). */}
      <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 shadow-lg">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={badgeVariant} className={cn("tabular-nums", badgeExtra)}>
            {ops.length}
          </Badge>
          <span className="truncate text-xs font-medium text-muted-foreground tabular-nums">
            {cabecalho}
          </span>
        </div>
        {temTerminal && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onLimparConcluidas}
          >
            {t.arquivos.limparConcluidas}
          </Button>
        )}
      </div>

      {/* Fila de ops (ativas + terminais retidas). */}
      <div className="pointer-events-auto flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {ops.map((op) => (
          <LinhaOp
            key={op.opId}
            op={op}
            unidades={unidades}
            onCancelar={onCancelar}
            onDispensar={onDispensar}
          />
        ))}
      </div>
    </div>
  );
}

/** Ícone por estado/tipo: erro/parcial → alerta, cancelada → Ban, sucesso → check,
 * descobrindo → spinner, em curso → Copy/Scissors por tipo. */
function IconeOp({ op }: { op: OpAtiva }) {
  const s = op.progresso.status;
  if (s === "error" || s === "partial")
    return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  if (s === "canceled") return <Ban className="size-4 shrink-0 text-muted-foreground" />;
  if (s === "success")
    return <Check className="size-4 shrink-0 text-success" />;
  if (op.progresso.phase === "discovering")
    return <Spinner className="size-4 shrink-0 text-muted-foreground" />;
  // #1282: undo tem ícone próprio (Undo2, o mesmo do botão da activity-dropdown).
  const Icon = op.tipo === "undo" ? Undo2 : op.tipo === "copy" ? Copy : Scissors;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * #850: segura a ÚLTIMA velocidade > 0 (o backend às vezes emite um tick sem delta
 * de bytes → `velocidade === 0`; sem isto o MB/s piscava pra vazio).
 * #875: card EXPANSÍVEL (Collapsible) — recolhido mostra ícone/rótulo/percent +
 * barra + proc/total (ou "Descobrindo itens…" indeterminado na varredura);
 * expandido adiciona o arquivo atual, velocidade e ETA. Op em curso → Cancelar
 * (X); op terminal → Dispensar (X). Erro fica com acento vermelho até dispensar.
 */
function LinhaOp({
  op,
  unidades,
  onCancelar,
  onDispensar,
}: {
  op: OpAtiva;
  unidades: { seg: string; min: string; hora: string };
  onCancelar: (opId: number) => void;
  onDispensar: (opId: number) => void;
}) {
  const { t } = useIdioma();
  const [aberto, setAberto] = useState(false);
  const ultimaVelRef = useRef(0);
  if (op.velocidade > 0) ultimaVelRef.current = op.velocidade;
  const velExibida = op.velocidade > 0 ? op.velocidade : ultimaVelRef.current;

  const p = op.progresso;
  const s = p.status;
  const terminal = ehTerminal(op);
  const descobrindo = !terminal && p.phase === "discovering";
  const percent = Math.max(0, Math.min(100, Math.round(p.percent)));

  // Rótulo por estado (curtos nos terminais; frase de ação nas ativas).
  const rotulo = descobrindo
    ? t.arquivos.descobrindoItens
    : s === "success"
      ? t.arquivos.statusConcluido
      : s === "error"
        ? t.arquivos.statusFalhou
        : s === "canceled"
          ? t.arquivos.statusCancelado
          : s === "partial"
            ? t.arquivos.statusParcial
            : op.tipo === "undo"
              ? t.arquivos.desfazendo
              : op.tipo === "copy"
                ? t.arquivos.copiando
                : t.arquivos.movendo;

  // Acento do card por estado: erro/parcial → vermelho; concluído/cancelado →
  // muted; em curso → card normal.
  const acento =
    s === "error" || s === "partial"
      ? "border-destructive/40 bg-destructive/5"
      : s === "success" || s === "canceled"
        ? "bg-muted/40"
        : "bg-card";

  // Detalhe expandido: velocidade + ETA (só faz sentido em curso).
  const eta = formatarEta(p.etaMs, unidades);
  const velocidade =
    velExibida > 0
      ? preencher(t.arquivos.velocidade, { v: formatBytes(velExibida) })
      : null;
  const detalhe = [
    velocidade,
    eta ? preencher(t.arquivos.etaRestante, { eta }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const bytesLinha = `${formatBytes(p.processedBytes)} / ${formatBytes(p.totalBytes)}`;

  return (
    <Collapsible open={aberto} onOpenChange={setAberto}>
      <div className={cn("rounded-lg border p-3 shadow-lg", acento)}>
        <div className="flex items-center gap-2">
          <IconeOp op={op} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {rotulo}
          </span>
          {!terminal && !descobrindo && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {percent}%
            </span>
          )}
          {/* #894: `title` nativo → TooltipAcao (padrão-ouro #862). O chevron é
              `CollapsibleTrigger asChild`; o TooltipAcao (que também é asChild) vai
              POR FORA — os dois `asChild` compõem no mesmo <Button> (Tooltip +
              toggle do Collapsible), padrão Radix de triggers aninhados. */}
          <TooltipAcao label={t.arquivos.detalhesOp}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                aria-label={t.arquivos.detalhesOp}
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", aberto && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
          </TooltipAcao>
          {terminal ? (
            <TooltipAcao label={t.arquivos.dispensar}>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => onDispensar(op.opId)}
                aria-label={t.arquivos.dispensar}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipAcao>
          ) : (
            <TooltipAcao label={t.arquivos.cancelar}>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => onCancelar(op.opId)}
                aria-label={t.arquivos.cancelar}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipAcao>
          )}
        </div>

        {descobrindo ? (
          // Barra indeterminada (varredura sem total conhecido).
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary/20">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
          </div>
        ) : (
          <Progress value={percent} className="mt-2" />
        )}

        {!descobrindo && (
          <p className="mt-1.5 truncate text-xs text-muted-foreground tabular-nums">
            {bytesLinha}
          </p>
        )}

        <CollapsibleContent>
          <div className="mt-2 space-y-1 border-t pt-2">
            {p.currentFile && (
              <p className="truncate text-xs text-muted-foreground" title={p.currentFile}>
                {p.currentFile}
              </p>
            )}
            {detalhe && (
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {detalhe}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
