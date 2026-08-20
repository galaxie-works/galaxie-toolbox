// #1285 (B2): Home view — a área de conteúdo quando o caminho é a HOME do
// usuário. No estilo do This PC (drives-view): a home vira uma grade de cards
// das suas subpastas, com ícone semântico pras conhecidas (Desktop, Documents,
// Downloads, Pictures, Music, Videos) e o Folder genérico pras demais — em vez
// da lista crua. Presentational + fetch próprio: lista `homePath` no mount.
//
// Navegação por CLIQUE ÚNICO no card — o mesmo dos cards de drive do This PC
// (#855) e o que o teclado espera (Enter/Espaço no <button>). O card do #1285
// dizia "duplo-clique", mas casar com o This PC e a a11y do botão vale mais que
// a letra; registrado na entrega.
import { useEffect, useState } from "react";
import { House } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useIdioma } from "@/lib/idioma";
import { listarDir } from "@/lib/api";
import type { FsEntry } from "@/lib/types";
// #1285 (B2): o mapa de ícone semântico mora em `.ts` próprio (lint
// only-export-components — arquivo de componente exporta só componentes).
import { iconeDaPasta } from "./home-view-icones";

export function HomeView({
  homePath,
  onNavegar,
}: {
  homePath: string;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();
  const [pastas, setPastas] = useState<FsEntry[] | null>(null);

  useEffect(() => {
    let vivo = true;
    setPastas(null);
    void listarDir(homePath)
      .then((entradas) => {
        if (!vivo) return;
        // Só subpastas (o AC é sobre pastas como tiles); ocultas fora.
        setPastas(entradas.filter((e) => e.isDir && !e.isHidden));
      })
      .catch(() => vivo && setPastas([]));
    return () => {
      vivo = false;
    };
  }, [homePath]);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 px-1">
        <House className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">{t.arquivos.home}</p>
      </div>

      {pastas === null ? (
        <div className="flex items-center gap-2 p-2">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : pastas.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{t.arquivos.vazio}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pastas.map((pasta) => (
            <PastaCard key={pasta.path} pasta={pasta} onNavegar={onNavegar} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Card de uma subpasta da home: ícone semântico + nome; clique navega. */
function PastaCard({
  pasta,
  onNavegar,
}: {
  pasta: FsEntry;
  onNavegar: (path: string) => void;
}) {
  const Icon = iconeDaPasta(pasta.name);
  return (
    <button
      type="button"
      onClick={() => onNavegar(pasta.path)}
      className="block w-full rounded-xl text-left outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="gap-3 py-4 transition-colors hover:bg-accent/40">
        <CardContent className="flex items-center gap-2.5 px-4">
          <Icon className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {pasta.name}
          </span>
        </CardContent>
      </Card>
    </button>
  );
}
