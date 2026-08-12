import { HardDrive, Folder } from "lucide-react";

import { SidebarNavItem } from "@/components/sidebar-nav-item";
import { useIdioma } from "@/lib/idioma";
import type { DriveInfo, FsEntry } from "@/lib/types";

/**
 * #677: sidebar de LOCAIS no topo do painel da árvore — "Este computador" (os
 * drives de `listarDrives`) e "Acesso rápido" (Documentos/Downloads/Área de
 * trabalho). Reusa o `SidebarNavItem` canônico (padrão-ouro do Bridge) e os
 * rótulos de seção no mesmo tratamento do sidebar de pastas do Bridge. Clicar
 * navega a árvore/conteúdo pro caminho.
 */
export function LocaisSidebar({
  drives,
  acessoRapido,
  currentPath,
  onNavegar,
}: {
  drives: DriveInfo[];
  acessoRapido: FsEntry[] | null;
  currentPath: string;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();

  return (
    <div className="space-y-3">
      <div>
        <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
          {t.arquivos.drives}
        </p>
        <div className="flex flex-col gap-0.5">
          {drives.map((d) => (
            <SidebarNavItem
              key={d.path}
              icone={
                <HardDrive className="size-4 shrink-0 text-muted-foreground" />
              }
              label={`${d.name} (${d.path.replace(/\\+$/, "")})`}
              ativo={currentPath === d.path}
              onClick={() => onNavegar(d.path)}
            />
          ))}
        </div>
      </div>

      {acessoRapido && acessoRapido.length > 0 && (
        <div>
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
            {t.arquivos.acessoRapido}
          </p>
          <div className="flex flex-col gap-0.5">
            {acessoRapido.map((e) => (
              <SidebarNavItem
                key={e.path}
                icone={
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                }
                label={e.name}
                ativo={currentPath === e.path}
                onClick={() => onNavegar(e.path)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
