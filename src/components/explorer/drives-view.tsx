// #855 (Explorer): grade de cards de drives — mostrada na área de conteúdo
// quando "Este computador" está selecionado (sentinel de caminho vazio no
// shell). Presentational: os drives vêm do shell (`listarDrives`). Cada card
// (DriveCard) reusa o Card do registry, uma barra de uso colorida por token de
// tema (success/warning/destructive por faixa de %), tooltip com o detalhe e
// clique que navega PARA dentro do drive.
import { rotuloDrive } from "./rotulo-drive";
import { HardDrive } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { preencher, useIdioma } from "@/lib/idioma";
import { cn, formatBytes } from "@/lib/utils";
import type { DriveInfo } from "@/lib/types";

/**
 * Grade responsiva de drives (1/2/3 colunas). Card no próprio scroll container,
 * no mesmo tratamento do card de conteúdo do Explorer (#854).
 */
export function DrivesView({
  drives,
  onNavegar,
}: {
  drives: DriveInfo[];
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();
  // #855 refino: 2 seções, estilo Win11 — "Dispositivos e drives" (locais /
  // removíveis / cd / etc.) e "Locais de rede" (kind `network`). A seção de rede
  // só aparece quando há drive de rede. (Cloud drives dedicados = #869.)
  const dispositivos = drives.filter((d) => d.kind !== "network");
  const rede = drives.filter((d) => d.kind === "network");

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl border bg-card p-4">
      <SecaoDrives
        titulo={t.arquivos.driveSecaoDispositivos}
        drives={dispositivos}
        onNavegar={onNavegar}
      />
      <SecaoDrives
        titulo={t.arquivos.driveSecaoRede}
        drives={rede}
        onNavegar={onNavegar}
      />
    </div>
  );
}

/** Uma seção de drives (título + grade). Some quando não há drive na categoria. */
function SecaoDrives({
  titulo,
  drives,
  onNavegar,
}: {
  titulo: string;
  drives: DriveInfo[];
  onNavegar: (path: string) => void;
}) {
  if (drives.length === 0) return null;
  return (
    <div>
      <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
        {titulo}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {drives.map((d) => (
          <DriveCard key={d.path} drive={d} onNavegar={onNavegar} />
        ))}
      </div>
    </div>
  );
}

/**
 * Card de um drive: rótulo (nome + letra), barra de uso colorida por faixa e o
 * detalhe usado/total + livre. `used = totalSpace − freeSpace`; o percentual
 * guarda `totalSpace === 0` (drive sem tamanho reportado → sem barra). O card
 * inteiro é um botão (foco/teclado nativos) e serve de gatilho do tooltip.
 */
function DriveCard({
  drive,
  onNavegar,
}: {
  drive: DriveInfo;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();

  // #1288: a letra sai do helper, que nao duplica quando o nome ja a traz (e o
  // caso dos drives de rede, cujo nome vem do redirector com a letra dentro).
  const rotulo = rotuloDrive(drive.name, drive.path);

  const total = drive.totalSpace;
  const livre = Math.max(0, drive.freeSpace);
  const usado = Math.max(0, total - livre);
  const pct = total > 0 ? Math.min(100, (usado / total) * 100) : 0;
  const pctArredondado = Math.round(pct);

  // Faixa de uso → cor por token de tema (nao-inventar-ui: bg-success/bg-warning/
  // bg-destructive vêm do index.css). <75% ok · 75–90% aviso · >90% crítico.
  const corBarra =
    pct > 90 ? "bg-destructive" : pct >= 75 ? "bg-warning" : "bg-success";

  // #855 refino: linha estilo Win11 "X livre de Y".
  const livreDeTotal = preencher(t.arquivos.driveLivreDeTotal, {
    livre: formatBytes(livre),
    total: formatBytes(total),
  });
  const tooltip = preencher(t.arquivos.driveTooltip, {
    usado: formatBytes(usado),
    total: formatBytes(total),
    livre: formatBytes(livre),
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onNavegar(drive.path)}
          className="block w-full rounded-xl text-left outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Card className="gap-3 py-4 transition-colors hover:bg-accent/40">
            <CardContent className="flex flex-col gap-3 px-4">
              <div className="flex items-center gap-2.5">
                <HardDrive className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {rotulo}
                </span>
              </div>
              {total > 0 && (
                <>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
                    role="progressbar"
                    aria-valuenow={pctArredondado}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={livreDeTotal}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        corBarra,
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">
                    {livreDeTotal}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
