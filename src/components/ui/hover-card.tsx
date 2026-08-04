/**
 * Hover card do app — ponto único de troca (#478, épico #476 Radix→animate-ui).
 *
 * Re-exporta o componente do **animate-ui** (`@animate-ui/components-radix-hover-card`,
 * instalado pelo registry) preservando os mesmos exports e a mesma API que os
 * 3 consumidores já usam (`openDelay`/`closeDelay`, `open`/`onOpenChange`
 * controlado, `asChild` no trigger, `align`/`sideOffset`/`className`). Como a
 * base do animate-ui mantém o estilo (bg-popover/border/rounded/p-4/w-64), o
 * visual fica igual e só ganha a animação de entrada/saída.
 */
export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  type HoverCardProps,
  type HoverCardTriggerProps,
  type HoverCardContentProps,
} from "@/components/animate-ui/components/radix/hover-card";
