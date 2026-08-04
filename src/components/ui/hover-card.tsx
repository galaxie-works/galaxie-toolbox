/**
 * #478 (épico #476): hover cards migrados pro Animate UI. Este arquivo é o
 * **ponto único de troca** — re-exporta o componente `radix` do Animate UI
 * (mesma API do Radix: `openDelay`/`closeDelay`, `open`/`onOpenChange`
 * controlado, `asChild` no trigger, `align`/`sideOffset`/`className` no content),
 * só troca a animação Tailwind (`data-[state]`) por `motion`. Os consumidores
 * (`PersonHoverCard`, `footnote-node`) seguem importando daqui, sem mudança.
 */
export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/animate-ui/components/radix/hover-card";
