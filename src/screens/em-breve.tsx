import type { IconeNav } from "@/lib/navegacao";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** Placeholder das telas que ainda vao ser construidas. */
export function EmBreveScreen({
  titulo,
  icone: Icone,
  descricao,
  itens,
}: {
  titulo: string;
  icone: IconeNav;
  descricao: string;
  itens?: string[];
}) {
  return (
    <div className="max-w-3xl">
      <Empty className="border border-border bg-card/40 p-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icone className="size-6" />
          </EmptyMedia>
          <EmptyTitle>{titulo}</EmptyTitle>
          <EmptyDescription>{descricao}</EmptyDescription>
        </EmptyHeader>
        {itens && itens.length > 0 && (
          <ul className="grid w-full max-w-sm gap-2 text-left">
            {itens.map((i) => (
              <li
                key={i}
                className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-[13px] text-muted-foreground"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                {i}
              </li>
            ))}
          </ul>
        )}
      </Empty>
    </div>
  );
}
