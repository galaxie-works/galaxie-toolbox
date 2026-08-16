import { AlertCircle, FolderOpen } from "lucide-react";

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

/**
 * #1063 (UX11): estados de carregando/erro/vazio do Explorer reusando o `Empty`
 * do registry — o MESMO componente que Bridge/People/Agenda já usam (12+
 * superfícies). Antes eram três blocos manuais duplicados em `content-pane.tsx`
 * (e um gêmeo em `resultados-busca.tsx`); centralizar aqui dá a mesma aparência
 * do resto do app e um único ponto testável. As chaves i18n (`t.arquivos.*`)
 * seguem vindo de fora — este componente é presentacional puro.
 */
export type EstadoConteudo = "carregando" | "erro" | "vazio";

interface EstadoConteudoExplorerProps {
  estado: EstadoConteudo;
  /** rótulo já traduzido (t.arquivos.erroLer / t.arquivos.vazio). Ausente em `carregando`. */
  rotulo?: string;
}

export function EstadoConteudoExplorer({
  estado,
  rotulo,
}: EstadoConteudoExplorerProps) {
  if (estado === "carregando") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia>
            <Spinner className="size-5 text-muted-foreground" />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    );
  }

  const Icone = estado === "erro" ? AlertCircle : FolderOpen;
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icone />
        </EmptyMedia>
        {rotulo ? <EmptyTitle>{rotulo}</EmptyTitle> : null}
      </EmptyHeader>
    </Empty>
  );
}
