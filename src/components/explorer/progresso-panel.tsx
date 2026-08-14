// #724 (Explorer S4 UI): painel compacto de progresso das ops de copiar/mover.
// Presentational — recebe as ops ativas (rastreadas por opId no shell) e o
// handler de cancelar. Card flutuante no canto inferior direito; uma linha por
// op concorrente. Percentual/ETA vêm do backend (`FsOpProgress`); a velocidade é
// derivada no shell entre eventos. Reusa Progress/Button/formatBytes/i18n.
import { useRef } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";
import type { FsOpProgress } from "@/lib/types";

import { formatarEta } from "./operacao";

/** Uma op de copy/move em andamento, rastreada por opId no shell. */
export interface OpAtiva {
  opId: number;
  tipo: "copy" | "move";
  progresso: FsOpProgress;
  /** Velocidade instantânea (bytes/s) derivada entre eventos de progresso. */
  velocidade: number;
}

export function ProgressoPanel({
  ops,
  onCancelar,
}: {
  ops: OpAtiva[];
  onCancelar: (opId: number) => void;
}) {
  const { t } = useIdioma();
  if (ops.length === 0) return null;

  const unidades = {
    seg: t.arquivos.etaSeg,
    min: t.arquivos.etaMin,
    hora: t.arquivos.etaHora,
  };

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-40 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2">
      {ops.map((op) => (
        <LinhaOp
          key={op.opId}
          op={op}
          unidades={unidades}
          onCancelar={onCancelar}
        />
      ))}
    </div>
  );
}

/**
 * #850: uma linha do painel. Segura a ÚLTIMA velocidade > 0 (o backend às vezes
 * emite um tick de progresso sem delta de bytes → `velocidade === 0`; sem isto o
 * texto de MB/s piscava pra vazio) e SEMPRE renderiza a linha de detalhe (altura
 * reservada) pra o card não pular quando velocidade/ETA oscilam.
 */
function LinhaOp({
  op,
  unidades,
  onCancelar,
}: {
  op: OpAtiva;
  unidades: { seg: string; min: string; hora: string };
  onCancelar: (opId: number) => void;
}) {
  const { t } = useIdioma();
  const ultimaVelRef = useRef(0);
  if (op.velocidade > 0) ultimaVelRef.current = op.velocidade;
  const velExibida = op.velocidade > 0 ? op.velocidade : ultimaVelRef.current;

  const p = op.progresso;
  const percent = Math.max(0, Math.min(100, Math.round(p.percent)));
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

  return (
    <div className="pointer-events-auto rounded-lg border bg-card p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {op.tipo === "copy" ? t.arquivos.copiando : t.arquivos.movendo}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {percent}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => onCancelar(op.opId)}
            aria-label={t.arquivos.cancelar}
            title={t.arquivos.cancelar}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <Progress value={percent} className="mt-2" />
      {/* #850: linha SEMPRE presente (altura reservada) — ` ` segura a
          altura quando ainda não há velocidade/ETA, pra o card não pular. */}
      <p className="mt-1.5 truncate text-xs text-muted-foreground tabular-nums">
        {detalhe || " "}
      </p>
    </div>
  );
}
