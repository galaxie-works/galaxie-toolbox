import { HardDrive, Folder, MonitorSmartphone } from "lucide-react";

import { SidebarNavItem } from "@/components/sidebar-nav-item";
import { useIdioma } from "@/lib/idioma";
import type { DriveInfo, FsEntry } from "@/lib/types";
import { CAMINHO_ESTE_PC } from "./caminho";

/**
 * #677: sidebar de LOCAIS no topo do painel da árvore — "Este computador" (os
 * drives de `listarDrives`) e "Acesso rápido" (Documentos/Downloads/Área de
 * trabalho). Reusa o `SidebarNavItem` canônico (padrão-ouro do Bridge) e os
 * rótulos de seção no mesmo tratamento do sidebar de pastas do Bridge. Clicar
 * navega a árvore/conteúdo pro caminho.
 *
 * #855: "Este computador" vira um item SELECIONÁVEL — clicar abre a grade de
 * drives (sentinel `CAMINHO_ESTE_PC`) na área de conteúdo; os drives seguem
 * listados logo abaixo, indentados.
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
        <SidebarNavItem
          icone={
            <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
          }
          label={t.arquivos.drives}
          ativo={currentPath === CAMINHO_ESTE_PC}
          onClick={() => onNavegar(CAMINHO_ESTE_PC)}
        />
        <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
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
