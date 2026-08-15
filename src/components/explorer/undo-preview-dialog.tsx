// #967 (#898 fatia 4): diálogo de PREVIEW/confirmação do "Desfazer" (undo) de uma
// op de copy/move do histórico da activity-dropdown. Espelha o `conflito-dialog`
// (Dialog canônico + i18n + `open`/`onOpenChange` controlados pelo shell, intactos
// ao Radix — regra do #275/P0 de webview). Lista o que será revertido em 3 baldes
// (seguros/pulados/não-reversíveis) com o motivo (código → copy i18n). `plan: null`
// = op saiu da janela do journal (nada a desfazer). Botão Desfazer desabilitado
// quando não há item seguro (com o porquê no `title`).
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { preencher, useIdioma } from "@/lib/idioma";
import type { UndoItemPlan, UndoPlan } from "@/lib/types";

import { nomeBase } from "./caminho";
import { agruparUndo, rotuloMotivo, type RotulosMotivo } from "./undo-resumo";

export function UndoPreviewDialog({
  aberto,
  plan,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  plan: UndoPlan | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const { t } = useIdioma();

  const rotulosMotivo: RotulosMotivo = {
    sumiu: t.arquivos.undoMotivoSumiu,
    modificado: t.arquivos.undoMotivoModificado,
    origemReocupada: t.arquivos.undoMotivoOrigemReocupada,
    sobrescrita: t.arquivos.undoMotivoSobrescrita,
  };

  const baldes = plan ? agruparUndo(plan) : null;
  // Desfazer só faz sentido com ao menos 1 item seguro (o backend reverte só os
  // seguros). Sem plan (fora da janela) ou zero seguros → desabilitado + porquê.
  const semSeguro = plan === null || plan.seguros === 0;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onCancelar();
      }}
    >
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>{t.arquivos.undoTitulo}</DialogTitle>
          <DialogDescription>
            {plan
              ? preencher(t.arquivos.undoDescricao, {
                  seguros: plan.seguros,
                  pulados: plan.pulados,
                  naoReversiveis: plan.naoReversiveis,
                })
              : t.arquivos.undoForaJanela}
          </DialogDescription>
        </DialogHeader>

        {plan && baldes && (
          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            <SecaoBalde
              titulo={t.arquivos.undoSeguro}
              itens={baldes.seguros}
              rotulosMotivo={rotulosMotivo}
            />
            <SecaoBalde
              titulo={t.arquivos.undoPulado}
              itens={baldes.pulados}
              rotulosMotivo={rotulosMotivo}
            />
            <SecaoBalde
              titulo={t.arquivos.undoNaoReversivel}
              itens={baldes.naoReversiveis}
              rotulosMotivo={rotulosMotivo}
            />
          </div>
        )}

        <DialogFooter className="sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancelar}>
            {t.arquivos.cancelar}
          </Button>
          {plan && (
            <Button
              onClick={onConfirmar}
              disabled={semSeguro}
              title={semSeguro ? t.arquivos.undoNadaSeguro : undefined}
            >
              {t.arquivos.desfazer}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uma seção de balde: só renderiza se houver item. Cabeçalho + lista compacta. */
function SecaoBalde({
  titulo,
  itens,
  rotulosMotivo,
}: {
  titulo: string;
  itens: UndoItemPlan[];
  rotulosMotivo: RotulosMotivo;
}) {
  if (itens.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-muted-foreground">{titulo}</h4>
      <ul className="space-y-0.5">
        {itens.map((item) => {
          const motivo = rotuloMotivo(item.motivo, rotulosMotivo);
          return (
            <li key={item.path} className="flex flex-col">
              <span className="truncate text-sm" title={item.path}>
                {nomeBase(item.path)}
              </span>
              {motivo && (
                <span className="truncate text-xs text-muted-foreground">
                  {motivo}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
