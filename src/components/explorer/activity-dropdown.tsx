// #898 (fatia 1): o Status Center do Explorer virou uma "activity-dropdown" (ref
// de UX: morphin.dev/components/activity-dropdown, mas reconstruída dos NOSSOS
// primitivos + tokens do tema, sem dep nova). SUBSTITUI o `ProgressoPanel` — é a
// ÚNICA superfície de progresso agora.
//
// #987: o TRIGGER saiu de flutuante (dentro do Explorer) pra TITLE BAR do app
// (fileira de chrome, ao lado do theme/avatar) — status sempre visível app-wide.
// Trigger = botão-ícone de chrome (sino) + badge "N" de NÃO-VISTAS (some com 0),
// ANCORADO num Popover (não flutua solto). O conteúdo (título/subtítulo + lista)
// abre numa lista com REVELAÇÃO ESCALONADA (`transitionDelay: i*60ms`). Cada item
// = ícone-por-tipo (círculo) + título + subtítulo + timestamp relativo
// (`tempo-relativo.ts`).
//
// Linha ATIVA (em curso OU pausada #898) traz controles: Pausar/Retomar +
// Cancelar. Linha PAUSADA mostra Retomar; em curso mostra Pausar; ambas Cancelar.
// Linha TERMINAL (concluída/erro/cancelada/parcial) mostra Dispensar (X), com o
// "Limpar concluídas" no topo da lista. Presentational: recebe `ops` + handlers do
// shell. `agoraMs` é um relógio que tiquetaqueia no shell pra os timestamps
// relativos re-renderizarem. Reusa Badge/Button/Spinner/TooltipAcao + i18n.
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Ban,
  Bell,
  Check,
  Copy,
  Pause,
  Play,
  Scissors,
  Undo2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatBytes } from "@/lib/utils";
import { preencher, useIdioma } from "@/lib/idioma";

import type { OpAtiva } from "./progresso-panel";
import { montarResumoOp, type RotulosResumo } from "./resumo-op";
import { calcularNaoVistas, marcarTodasVistas } from "./nao-vistas";
import { formatarTempoRelativo, type RotulosTempo } from "./tempo-relativo";
import { TooltipAcao } from "./tooltip-acao";

/** Estado inicial "nada visto" (#898 fatia 3). Constante de módulo: um só set
 *  vazio compartilhado (readonly, nunca mutado) — evita re-alocar por render. */
const VISTOS_VAZIO: ReadonlySet<number> = new Set();

/** Uma op é ATIVA (cancelável/pausável) enquanto está em curso OU pausada (#898). */
function estaAtiva(op: OpAtiva): boolean {
  const s = op.progresso.status;
  return s === "inProgress" || s === "paused";
}

/** Terminal = não está mais ativa (concluída/erro/cancelada/parcial). */
function ehTerminal(op: OpAtiva): boolean {
  return !estaAtiva(op);
}

/** Ícone-por-tipo dentro de um círculo (mesma semântica do `IconeOp` do painel). */
function CirculoIcone({ op }: { op: OpAtiva }) {
  const s = op.progresso.status;
  let Icone = op.tipo === "copy" ? Copy : Scissors;
  let cor = "text-muted-foreground";
  if (s === "error" || s === "partial") {
    Icone = AlertCircle;
    cor = "text-destructive";
  } else if (s === "canceled") {
    Icone = Ban;
  } else if (s === "success") {
    Icone = Check;
    cor = "text-success";
  } else if (s === "paused") {
    Icone = Pause;
    cor = "text-warning";
  }
  const descobrindo = s === "inProgress" && op.progresso.phase === "discovering";
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
      {descobrindo ? (
        <Spinner className={cn("size-4", cor)} />
      ) : (
        <Icone className={cn("size-4", cor)} />
      )}
    </div>
  );
}

export function ActivityDropdown({
  ops,
  agoraMs,
  onCancelar,
  onPausar,
  onResumir,
  onDispensar,
  onDesfazer,
  desfeitos,
  onLimparConcluidas,
}: {
  ops: OpAtiva[];
  /** Relógio (Date.now) pra os timestamps relativos re-renderizarem. */
  agoraMs: number;
  onCancelar: (opId: number) => void;
  onPausar: (opId: number) => void;
  onResumir: (opId: number) => void;
  onDispensar: (opId: number) => void;
  /** #967: abre o preview de undo de uma op terminal (copy/move concluída). */
  onDesfazer: (opId: number) => void;
  /** #967: opIds já desfeitos (marca a linha como "Desfeito"). */
  desfeitos: ReadonlySet<number>;
  onLimparConcluidas: () => void;
}) {
  const { t } = useIdioma();
  const [aberto, setAberto] = useState(false);
  // #898 fatia 3 (#966): opIds já VISTOS. Abrir o painel — e enquanto ele fica
  // aberto — marca todas as ops atuais como vistas (o contador de "não vistas"
  // zera). Fechado, ops novas (opId fora do conjunto) voltam a contar.
  const [vistos, setVistos] = useState<ReadonlySet<number>>(VISTOS_VAZIO);
  useEffect(() => {
    if (aberto) setVistos(marcarTodasVistas(ops));
  }, [aberto, ops]);

  if (ops.length === 0) return null;

  // Não-vistas exibidas: 0 enquanto aberto (o usuário está vendo tudo), senão a
  // contagem real. O efeito acima já converge pra 0, isto evita o flash de 1 frame.
  const naoVistas = aberto ? 0 : calcularNaoVistas(ops, vistos);

  const rotulosTempo: RotulosTempo = {
    agora: t.arquivos.tempoAgora,
    minAtras: t.arquivos.tempoMinAtras,
    horasAtras: t.arquivos.tempoHorasAtras,
    ontem: t.arquivos.tempoOntem,
    diasAtras: t.arquivos.tempoDiasAtras,
  };

  // #898 fatia 2: rótulos do resumo terminal (histórico de sessão). Montados uma
  // vez aqui e passados às linhas — cada linha TERMINAL vira um resumo imutável.
  const rotulosResumo: RotulosResumo = {
    copiados: t.arquivos.resumoCopiados,
    copiadoUm: t.arquivos.resumoCopiadoUm,
    movidos: t.arquivos.resumoMovidos,
    movidoUm: t.arquivos.resumoMovidoUm,
    canceladoCopia: t.arquivos.resumoCanceladoCopia,
    canceladoMove: t.arquivos.resumoCanceladoMove,
    falhaCopia: t.arquivos.resumoFalhaCopia,
    falhaMove: t.arquivos.resumoFalhaMove,
    parcial: t.arquivos.resumoParcial,
    paraDestino: t.arquivos.resumoParaDestino,
    arquivoUm: t.arquivos.arquivoUm,
    arquivos: t.arquivos.arquivosMuitos,
  };

  // Agregado (reusa a lógica do `ProgressoPanel`): contagem + cor pelo estado
  // agregado (erro > em curso/pausada > tudo concluído) e o percentual médio das
  // ops AINDA ativas. Ativas = em curso OU pausadas.
  const ativas = ops.filter(estaAtiva);
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

  // Badge de contagem colorido pelo estado agregado (mesmas variantes do painel):
  // erro (vermelho) > em curso (primário) > tudo concluído (verde/success).
  const badgeVariant = temErro ? "outline" : ativas.length > 0 ? "default" : "success";
  const badgeExtra = temErro
    ? "border-transparent bg-destructive/10 text-destructive"
    : "";

  // Subtítulo do trigger: com ops ativas, o resumo "{n} operações · {X}%" (reusa
  // `statusCenterOps`); sem nenhuma ativa, a frase de histórico da sessão.
  const subtitulo =
    ativas.length > 0
      ? preencher(t.arquivos.statusCenterOps, { n: ativas.length }) +
        (avgPercent != null ? ` · ${avgPercent}%` : "")
      : t.arquivos.atividadesSubtitulo;

  // Mais recentes no topo (histórico de sessão): ordena pelo início desc.
  const ordenadas = [...ops].sort(
    (a, b) => b.progresso.startedAtMs - a.progresso.startedAtMs,
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      {/* #987: trigger = botão-ícone de chrome na title bar (sino + badge de
          NÃO-VISTAS no canto). Some quando não há atividade nenhuma (o guard
          `ops.length === 0` acima) — o sino só aparece quando há o que mostrar. */}
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
            "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            aberto && "bg-muted text-foreground",
          )}
          aria-label={
            naoVistas > 0
              ? preencher(t.arquivos.atividadesTitulo, { n: naoVistas })
              : t.arquivos.atividadesTituloVazio
          }
        >
          <Bell className="size-5" />
          {/* #898 fatia 3 (#966): badge de NÃO-VISTAS ("N novas") — some quando
              zero (tudo visto). Cor pelo estado agregado (erro>ativo>concluído). */}
          {naoVistas > 0 && (
            <Badge
              variant={badgeVariant}
              className={cn(
                "absolute -right-1 -top-1 min-w-4 justify-center rounded-full px-1 py-0 text-[10px] leading-4 tabular-nums",
                badgeExtra,
              )}
              aria-hidden
            >
              {naoVistas}
            </Badge>
          )}
        </button>
      </PopoverTrigger>

      {/* Conteúdo ANCORADO no sino (align end → alinha à direita, sob o chrome).
          Cabeçalho (título + subtítulo) + "Limpar concluídas" + lista escalonada. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-0"
      >
        <div className="flex items-center gap-3 p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Bell className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">
              {naoVistas > 0
                ? preencher(t.arquivos.atividadesTitulo, { n: naoVistas })
                : t.arquivos.atividadesTituloVazio}
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
              {subtitulo}
            </p>
          </div>
        </div>

        {temTerminal && (
          <div className="flex justify-end px-3 pb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onLimparConcluidas}
            >
              {t.arquivos.limparConcluidas}
            </Button>
          </div>
        )}
        <div className="max-h-[50vh] space-y-1 overflow-y-auto px-2 pb-3">
          {ordenadas.map((op, index) => (
            <LinhaAtividade
              key={op.opId}
              op={op}
              index={index}
              aberto={aberto}
              agoraMs={agoraMs}
              rotulosTempo={rotulosTempo}
              rotulosResumo={rotulosResumo}
              onCancelar={onCancelar}
              onPausar={onPausar}
              onResumir={onResumir}
              onDispensar={onDispensar}
              onDesfazer={onDesfazer}
              desfeitos={desfeitos}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinhaAtividade({
  op,
  index,
  aberto,
  agoraMs,
  rotulosTempo,
  rotulosResumo,
  onCancelar,
  onPausar,
  onResumir,
  onDispensar,
  onDesfazer,
  desfeitos,
}: {
  op: OpAtiva;
  index: number;
  aberto: boolean;
  agoraMs: number;
  rotulosTempo: RotulosTempo;
  rotulosResumo: RotulosResumo;
  onCancelar: (opId: number) => void;
  onPausar: (opId: number) => void;
  onResumir: (opId: number) => void;
  onDispensar: (opId: number) => void;
  onDesfazer: (opId: number) => void;
  desfeitos: ReadonlySet<number>;
}) {
  const { t } = useIdioma();
  const p = op.progresso;
  const s = p.status;
  const terminal = ehTerminal(op);
  const pausada = s === "paused";
  const descobrindo = !terminal && !pausada && p.phase === "discovering";

  // #898 fatia 2: linha TERMINAL (concluída/erro/cancelada/parcial) vira um RESUMO
  // imutável e legível (histórico de sessão) via `montarResumoOp` (puro, testado
  // por node --test). Linha ATIVA (em curso/pausada) mantém o render de sempre —
  // rótulo de estado + arquivo atual.
  const resumo = terminal ? montarResumoOp(op, rotulosResumo) : null;

  // Título: resumo terminal, ou rótulo curto de estado ativo (pausada/descobrindo/
  // copiando/movendo — os terminais já saem pelo `resumo`).
  const titulo = resumo
    ? resumo.titulo
    : pausada
      ? t.arquivos.statusPausado
      : descobrindo
        ? t.arquivos.descobrindoItens
        : op.tipo === "copy"
          ? t.arquivos.copiando
          : t.arquivos.movendo;

  // Subtítulo: resumo terminal ("→ destino" / bytes) ou o arquivo atual (ativo,
  // com o resumo de bytes como fallback).
  const subtitulo = resumo
    ? resumo.subtitulo
    : (p.currentFile ??
      `${formatBytes(p.processedBytes)} / ${formatBytes(p.totalBytes)}`);

  // Timestamp relativo: fim (se terminou) senão início.
  const quando = formatarTempoRelativo(
    p.completedAtMs ?? p.startedAtMs,
    agoraMs,
    rotulosTempo,
  );

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-xl p-2.5",
        "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "hover:bg-muted/60",
        aberto ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        (s === "error" || s === "partial") && "bg-destructive/5",
      )}
      style={{ transitionDelay: aberto ? `${index * 60}ms` : "0ms" }}
    >
      <CirculoIcone op={op} />
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-medium">{titulo}</h4>
        <p className="truncate text-xs text-muted-foreground" title={subtitulo}>
          {subtitulo}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <span className="text-xs tabular-nums text-muted-foreground">{quando}</span>
        {/* Linha ATIVA: Pausar (em curso) / Retomar (pausada) + Cancelar. Controles
            sempre visíveis (ação primária de uma op viva). */}
        {!terminal && (
          <>
            {pausada ? (
              <TooltipAcao label={t.arquivos.retomar}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => onResumir(op.opId)}
                  aria-label={t.arquivos.retomar}
                >
                  <Play className="size-3.5" />
                </Button>
              </TooltipAcao>
            ) : (
              <TooltipAcao label={t.arquivos.pausar}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => onPausar(op.opId)}
                  aria-label={t.arquivos.pausar}
                >
                  <Pause className="size-3.5" />
                </Button>
              </TooltipAcao>
            )}
            <TooltipAcao label={t.arquivos.cancelar}>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => onCancelar(op.opId)}
                aria-label={t.arquivos.cancelar}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipAcao>
          </>
        )}
        {/* Linha TERMINAL: Desfazer (undo) + Dispensar. Desfazer só numa op
            reversível (copy/move concluída OU parcial). Já desfeita → some o
            botão e mostra o rótulo "Desfeito" (#967). */}
        {terminal &&
          (desfeitos.has(op.opId) ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {t.arquivos.undoDesfeito}
            </span>
          ) : (
            (s === "success" || s === "partial") && (
              <TooltipAcao label={t.arquivos.desfazer}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => onDesfazer(op.opId)}
                  aria-label={t.arquivos.desfazer}
                >
                  <Undo2 className="size-3.5" />
                </Button>
              </TooltipAcao>
            )
          ))}
        {/* Linha TERMINAL: Dispensar (revela no hover). */}
        {terminal && (
          <TooltipAcao label={t.arquivos.dispensar}>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onDispensar(op.opId)}
              aria-label={t.arquivos.dispensar}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipAcao>
        )}
      </div>
    </div>
  );
}
