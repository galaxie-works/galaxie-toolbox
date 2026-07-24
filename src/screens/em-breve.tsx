import type { LucideIcon } from "lucide-react";

/** Placeholder das telas que ainda vao ser construidas. */
export function EmBreveScreen({
  titulo,
  icone: Icone,
  descricao,
  itens,
}: {
  titulo: string;
  icone: LucideIcon;
  descricao: string;
  itens?: string[];
}) {
  return (
    <div className="max-w-3xl">
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icone className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{titulo}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          {descricao}
        </p>
        {itens && itens.length > 0 && (
          <ul className="mx-auto mt-5 grid max-w-sm gap-2 text-left">
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
      </div>
    </div>
  );
}
