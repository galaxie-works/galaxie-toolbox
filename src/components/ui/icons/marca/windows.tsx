import { cn } from "@/lib/utils";

/**
 * Logo do Windows (2021) — 4 quadrados na cor da marca (#0078d4). É um logo
 * COLORIDO (como Outlook/OneDrive/Copilot): mantemos o `fill` da marca em vez de
 * `currentColor`, então a cor NÃO segue o tema (fica azul no claro e no escuro).
 * `shrink-0` + `className` pra dimensionar igual aos outros ícones do nav.
 */
export function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 4875 4875"
    >
      <path
        fill="#0078d4"
        d="M0 0h2311v2310H0zm2564 0h2311v2310H2564zM0 2564h2311v2311H0zm2564 0h2311v2311H2564"
      />
    </svg>
  );
}
