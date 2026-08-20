// #1287: view genérica de uma raiz semântica (Cloud drives / Locais de rede /
// Acesso rápido) na área de conteúdo — grade de cards no estilo do This PC
// (DrivesView, #855) e da HomeView (#1285). Cada raiz vira uma sentinela de
// caminho (ver `caminho.ts`) que o shell roteia pra cá com os itens já mapeados.
// Presentational puro: sem fetch e sem estado — o shell é dono dos dados (já tem
// cloud/rede/acesso) e do ícone de cada item.
//
// Navegação por CLIQUE ÚNICO no card, igual ao This PC e à Home: o card é um
// <button> (foco/teclado nativos, Enter/Espaço), e clicar navega pro `path`.
import type { ElementType } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Um item da grade: caminho pra navegar, rótulo e ícone semântico. */
export interface ItemRaiz {
  path: string;
  label: string;
  Icon: ElementType;
  /** #1288: atalho de rede indisponível segue listado, só esmaecido — nunca some. */
  indisponivel?: boolean;
}

export function RootView({
  titulo,
  icone: IconeTitulo,
  itens,
  vazioLabel,
  onNavegar,
}: {
  titulo: string;
  icone: ElementType;
  itens: ItemRaiz[];
  vazioLabel: string;
  onNavegar: (path: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 px-1">
        <IconeTitulo className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">{titulo}</p>
      </div>

      {itens.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{vazioLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((item) => (
            <ItemCard key={item.path} item={item} onNavegar={onNavegar} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Card de um item da raiz: ícone semântico + rótulo; clique navega. */
function ItemCard({
  item,
  onNavegar,
}: {
  item: ItemRaiz;
  onNavegar: (path: string) => void;
}) {
  const { Icon } = item;
  return (
    <button
      type="button"
      onClick={() => onNavegar(item.path)}
      className="block w-full rounded-xl text-left outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card
        className={cn(
          "gap-3 py-4 transition-colors hover:bg-accent/40",
          item.indisponivel && "opacity-60",
        )}
      >
        <CardContent className="flex items-center gap-2.5 px-4">
          <Icon className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {item.label}
          </span>
        </CardContent>
      </Card>
    </button>
  );
}
