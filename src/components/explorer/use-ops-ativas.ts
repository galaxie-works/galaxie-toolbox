import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { preencher, useIdioma } from "@/lib/idioma";
import {
  cancelarOp,
  desfazerOp,
  onProgressoOp,
  pausarOp,
  previewUndo,
  resumirOp,
} from "@/lib/api";
import type { UndoPlan } from "@/lib/types";
import { useAppStore } from "@/store";

import { calcVelocidade } from "./operacao";
import type { OpAtiva } from "./progresso-panel";

/**
 * #987: máquina de atividades de transferência (copy/move), ANTES no estado local
 * do `explorer-shell`. Como o sino do activity-dropdown foi pra title bar (App,
 * sempre visível), a lógica que POPULA/manipula `ops` subiu pra este hook, que o
 * App monta UMA vez — assim as transferências rodam e são visíveis app-wide,
 * independentemente da tela. A fila (`ops` + `desfeitos`) mora no store
 * (`activity-slice`); os produtores (o próprio `explorer-shell`) seguem
 * disparando as transferências e chamam `registrarOp` ao iniciá-las.
 *
 * Os Maps de bookkeeping são de MÓDULO (não refs de componente): há UM só
 * subsistema de transferência (um stream de progresso do Tauri), então o estado
 * auxiliar é naturalmente singleton — e sobrevive à troca de tela junto com a
 * assinatura montada no App.
 */

/** Último byte/tempo por opId → deriva a velocidade instantânea entre eventos. */
const ultimoPorOp = new Map<number, { bytes: number; ms: number }>();
/** Tipo (copy/move) por opId — o payload de progresso não o carrega. */
const tipoPorOp = new Map<number, "copy" | "move">();
/** Basename do destino por opId → alimenta o resumo terminal ("→ Downloads"). */
const destinoPorOp = new Map<number, string>();
/** opIds cujo evento terminal já saiu (dedupe do toast único por op). */
const terminadosOp = new Set<number>();

/** Uma op está ATIVA (não-dispensável) enquanto em curso OU pausada. */
function ehAtiva(status: string): boolean {
  return status === "inProgress" || status === "paused";
}

/** Limpa o bookkeeping de uma op (ao dispensá-la / limpar concluídas). */
function limparBookkeeping(opId: number): void {
  ultimoPorOp.delete(opId);
  tipoPorOp.delete(opId);
  destinoPorOp.delete(opId);
  terminadosOp.delete(opId);
}

/**
 * Produtores (ex.: `explorer-shell`) registram tipo + basename do destino ao
 * iniciar uma transferência — o stream de progresso só traz o opId. Fica no
 * módulo pra que quem dispara a transferência e a assinatura (montada no App)
 * compartilhem o MESMO bookkeeping sem prop-drill.
 */
export function registrarOp(
  opId: number,
  tipo: "copy" | "move",
  destino: string,
): void {
  tipoPorOp.set(opId, tipo);
  destinoPorOp.set(opId, destino);
}

export interface OpsAtivas {
  ops: OpAtiva[];
  /** Relógio (Date.now, tick de 30s) pros timestamps relativos re-renderizarem. */
  agoraMs: number;
  desfeitos: ReadonlySet<number>;
  onCancelar: (opId: number) => void;
  onPausar: (opId: number) => void;
  onResumir: (opId: number) => void;
  onDispensar: (opId: number) => void;
  onDesfazer: (opId: number) => void;
  onLimparConcluidas: () => void;
  /** #967: preview de undo em aberto (plan=null = fora da janela do journal). */
  undoPreview: { opId: number; plan: UndoPlan | null } | null;
  confirmarUndo: () => void;
  fecharUndoPreview: () => void;
}

export function useOpsAtivas(): OpsAtivas {
  const { t } = useIdioma();
  const ops = useAppStore((s) => s.ops);
  const desfeitos = useAppStore((s) => s.desfeitos);
  const setOps = useAppStore((s) => s.setOps);
  const setDesfeitos = useAppStore((s) => s.setDesfeitos);

  const [undoPreview, setUndoPreview] = useState<{
    opId: number;
    plan: UndoPlan | null;
  } | null>(null);

  // t via ref → a assinatura de progresso é registrada UMA vez (sem re-subscribe
  // a cada troca de idioma), mas os toasts saem no idioma atual.
  const tRef = useRef(t);
  tRef.current = t;

  // #724: assina o progresso das ops UMA vez (no mount do App). Deriva a
  // velocidade entre eventos, RETÉM a op no evento terminal (vira card revisável)
  // e mostra um toast único por op. A unsub é SEMPRE chamada (inclui a corrida de
  // resolver depois do unmount). No mock (fora do Tauri) o subscribe é no-op.
  useEffect(() => {
    let vivo = true;
    let unsub: () => void = () => {};
    void onProgressoOp((p) => {
      const arquivos = tRef.current.arquivos;
      const agora = Date.now();
      const ult = ultimoPorOp.get(p.opId);
      const velocidade = ult
        ? calcVelocidade(p.processedBytes, ult.bytes, agora - ult.ms)
        : 0;
      ultimoPorOp.set(p.opId, { bytes: p.processedBytes, ms: agora });

      const terminal = p.done || p.canceled || p.error != null;
      if (terminal) {
        if (!terminadosOp.has(p.opId)) {
          terminadosOp.add(p.opId);
          if (p.error) {
            toast.error(arquivos.opFalhou, { description: p.error.message });
          } else if (p.canceled) {
            toast.info(arquivos.opCancelada);
          } else {
            toast.success(arquivos.opConcluida);
          }
        }
        // #875: RETÉM a op na fila marcada como terminal (card revisável). Sem
        // mais progresso → velocidade 0; só o ultimoPorOp (delta de bytes) sai.
        ultimoPorOp.delete(p.opId);
        setOps((prev) => {
          const tipo =
            tipoPorOp.get(p.opId) ??
            prev.find((o) => o.opId === p.opId)?.tipo ??
            "copy";
          const novo: OpAtiva = {
            opId: p.opId,
            tipo,
            progresso: p,
            velocidade: 0,
            destino: destinoPorOp.get(p.opId),
          };
          return prev.some((o) => o.opId === p.opId)
            ? prev.map((o) => (o.opId === p.opId ? novo : o))
            : [...prev, novo];
        });
        return;
      }

      setOps((prev) => {
        const tipo = tipoPorOp.get(p.opId) ?? "copy";
        const novo: OpAtiva = {
          opId: p.opId,
          tipo,
          progresso: p,
          velocidade,
          destino: destinoPorOp.get(p.opId),
        };
        return prev.some((o) => o.opId === p.opId)
          ? prev.map((o) => (o.opId === p.opId ? novo : o))
          : [...prev, novo];
      });
    })
      .then((fn) => {
        if (!vivo) {
          fn();
          return;
        }
        unsub = fn;
      })
      .catch(() => {});
    return () => {
      vivo = false;
      unsub();
    };
  }, [setOps]);

  // #898: relógio pros timestamps relativos da activity-dropdown re-renderizarem.
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // #1028 (FE7): as ações de op não podem falhar em silêncio — toast no catch.
  const onCancelar = useCallback(
    (opId: number) => {
      void cancelarOp(opId).catch(() => toast.error(t.arquivos.erroCancelarOp));
    },
    [t.arquivos.erroCancelarOp],
  );

  // #898: pausa/retoma uma op em curso — o backend trava/continua os workers e o
  // stream passa a reportar `status: "paused"` (op segue ATIVA, não terminal).
  const onPausar = useCallback(
    (opId: number) => {
      void pausarOp(opId).catch(() => toast.error(t.arquivos.erroPausarOp));
    },
    [t.arquivos.erroPausarOp],
  );
  const onResumir = useCallback(
    (opId: number) => {
      void resumirOp(opId).catch(() => toast.error(t.arquivos.erroResumirOp));
    },
    [t.arquivos.erroResumirOp],
  );

  // #875/#898: dispensa UMA op terminal (guard: nunca uma op ATIVA — essa é
  // cancelável/retomável, não dispensável). Limpa o bookkeeping pra não vazar.
  const onDispensar = useCallback(
    (opId: number) => {
      setOps((prev) => {
        const alvo = prev.find((o) => o.opId === opId);
        if (!alvo || ehAtiva(alvo.progresso.status)) return prev;
        return prev.filter((o) => o.opId !== opId);
      });
      limparBookkeeping(opId);
    },
    [setOps],
  );

  // #967: abre o preview de undo de uma op terminal — busca o plano (sem efeito).
  // Abre o diálogo MESMO com `plan=null` (op fora da janela do journal).
  const onDesfazer = useCallback(async (opId: number) => {
    const plan = await previewUndo(opId).catch(() => null);
    setUndoPreview({ opId, plan });
  }, []);

  // #967: confirma o undo — executa (best-effort, só os itens seguros) e marca a
  // op como desfeita. Toast pelo relatório: sucesso / parcial / erro.
  const confirmarUndo = useCallback(async () => {
    const alvo = undoPreview;
    if (!alvo) return;
    setUndoPreview(null);
    const rep = await desfazerOp(alvo.opId).catch(() => null);
    if (!rep) return;
    setDesfeitos((prev) => new Set(prev).add(alvo.opId));
    const arquivos = tRef.current.arquivos;
    if (rep.erros.length > 0) {
      toast.error(preencher(arquivos.undoErro, { n: rep.erros.length }), {
        description: rep.erros[0],
      });
    } else if (rep.pulados > 0 || rep.naoReversiveis > 0) {
      toast.info(
        preencher(arquivos.undoParcial, {
          ok: rep.executados,
          pulados: rep.pulados + rep.naoReversiveis,
        }),
      );
    } else {
      toast.success(preencher(arquivos.undoOk, { n: rep.executados }));
    }
  }, [undoPreview, setDesfeitos]);

  // #875/#898: limpa TODAS as ops terminais, mantendo as ATIVAS. Limpa o
  // bookkeeping das removidas.
  const onLimparConcluidas = useCallback(() => {
    setOps((prev) => {
      for (const o of prev) {
        if (!ehAtiva(o.progresso.status)) limparBookkeeping(o.opId);
      }
      return prev.filter((o) => ehAtiva(o.progresso.status));
    });
  }, [setOps]);

  const fecharUndoPreview = useCallback(() => setUndoPreview(null), []);

  return {
    ops,
    agoraMs,
    desfeitos,
    onCancelar,
    onPausar,
    onResumir,
    onDispensar,
    onDesfazer,
    onLimparConcluidas,
    undoPreview,
    confirmarUndo,
    fecharUndoPreview,
  };
}
