import { FundoAnimado } from "@/components/fundo-animado";

/**
 * Fundo do app (#474): o fundo animado escolhido (ou nada, se o switcher estiver
 * desligado — aí o tema pinta atrás). Delegado ao `FundoAnimado`, que lê o store
 * e respeita `prefers-reduced-motion`.
 */
export function FundoApp({ className }: { className?: string }) {
  return <FundoAnimado className={className} />;
}
