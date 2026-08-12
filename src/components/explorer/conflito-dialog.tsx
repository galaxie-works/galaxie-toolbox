// #724 (Explorer S4 UI): diálogo de conflito de nome ANTES de copiar/mover. Uma
// decisão única aplicada a todos os conflitos (v1): Substituir / Pular / Manter
// ambos. Reusa o Dialog canônico (Animate UI) + Button + i18n. O estado
// `open`/`onOpenChange` é controlado pelo shell (chega intacto ao Radix — regra
// do #275/P0 de webview).
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
import type { FsConflict } from "@/lib/types";

import { nomeBase } from "./caminho";
import type { ResolucaoConflito } from "./operacao";

export function ConflitoDialog({
  aberto,
  conflitos,
  destDir,
  onResolver,
  onCancelar,
}: {
  aberto: boolean;
  conflitos: FsConflict[];
  destDir: string;
  onResolver: (resolucao: ResolucaoConflito) => void;
  onCancelar: () => void;
}) {
  const { t } = useIdioma();

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onCancelar();
      }}
    >
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>{t.arquivos.conflitoTitulo}</DialogTitle>
          <DialogDescription>
            {preencher(t.arquivos.conflitoDescricao, {
              n: conflitos.length,
              pasta: nomeBase(destDir) || destDir,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancelar}>
            {t.arquivos.cancelar}
          </Button>
          <Button variant="outline" onClick={() => onResolver("pular")}>
            {t.arquivos.pular}
          </Button>
          <Button variant="outline" onClick={() => onResolver("manterAmbos")}>
            {t.arquivos.manterAmbos}
          </Button>
          <Button onClick={() => onResolver("substituir")}>
            {t.arquivos.substituir}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
