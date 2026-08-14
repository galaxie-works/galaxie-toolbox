import { ExplorerShell } from "@/components/explorer/explorer-shell";

/**
 * Tela Arquivos (#677) — Explorer de arquivos local. #854: SEM hero/título
 * interno — a aba do Navigator que hospeda esta tela já se chama "Files" (com
 * ícone), então repetir o título/ícone aqui dentro é redundante. O Explorer
 * ocupa a altura toda da content-area.
 */
export function ArquivosScreen() {
  return (
    <div className="h-full">
      <ExplorerShell />
    </div>
  );
}
