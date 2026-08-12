import { FolderTree } from "lucide-react";

import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { ExplorerShell } from "@/components/explorer/explorer-shell";
import { useIdioma } from "@/lib/idioma";

/**
 * Tela Arquivos (#677) — Explorer de arquivos local. Segue o template de hero das
 * outras telas full-height (Windows/Apps): ícone + título animado, e abaixo a
 * casca do Explorer (árvore de pastas + navegação) ocupando a altura restante.
 */
export function ArquivosScreen() {
  const { t } = useIdioma();
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-lg bg-secondary"
        >
          <FolderTree className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          <SoftBlurIn delay={80} stagger={16}>
            {t.arquivos.titulo}
          </SoftBlurIn>
        </h1>
      </div>

      <div className="min-h-0 flex-1">
        <ExplorerShell />
      </div>
    </div>
  );
}
