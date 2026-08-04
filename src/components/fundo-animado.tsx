import { MotionConfig } from "motion/react";

import { Estrelas } from "@/components/estrelas";
import { GravityStarsBackground } from "@/components/animate-ui/components/backgrounds/gravity-stars";
import { HexagonBackground } from "@/components/animate-ui/components/backgrounds/hexagon";
import { HoleBackground } from "@/components/animate-ui/components/backgrounds/hole";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import type { TipoFundoAnimado } from "@/store/personalization-slice";

/**
 * #474: os 4 fundos animados (Animate UI). Os nomes são próprios (não traduzem);
 * a ordem é a mesma do preview no Settings. Cada valor mapeia 1:1 pra um
 * componente do registry, usado como vem (sem customização) — a única exceção é
 * o Starry, que já tinha adaptação de tema justificada (ver `estrelas.tsx`).
 */
export const FUNDOS_ANIMADOS: { valor: TipoFundoAnimado; rotulo: string }[] = [
  { valor: "starry", rotulo: "Starry" },
  { valor: "supernova", rotulo: "Super nova" },
  { valor: "spacehive", rotulo: "Space hive" },
  { valor: "gravity", rotulo: "Gravity" },
];

/**
 * Renderiza UM fundo animado (sem ler o store) — reusado pela superfície do app
 * e pelos previews do Settings. Os componentes do registry são `size-full`; o
 * `absolute inset-0` os encaixa no container relativo (igual ao Starry).
 *
 * `MotionConfig reducedMotion="user"` faz os fundos baseados em `motion`
 * (Starry/Super nova) respeitarem `prefers-reduced-motion` sem tocar no registry;
 * como envolve o render único, vale tanto na app quanto nos previews.
 */
export function RenderFundoAnimado({
  tipo,
  className,
}: {
  tipo: TipoFundoAnimado;
  className?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      {tipo === "starry" && <Estrelas className={className} />}
      {tipo === "supernova" && (
        <HoleBackground className={cn("absolute inset-0", className)} />
      )}
      {tipo === "spacehive" && (
        <HexagonBackground className={cn("absolute inset-0", className)} />
      )}
      {tipo === "gravity" && (
        <GravityStarsBackground className={cn("absolute inset-0", className)} />
      )}
    </MotionConfig>
  );
}

/**
 * Fundo animado da app: lê o switcher (`fundosAnimadosAtivo`) e a escolha
 * (`fundoAnimado`) do store. Desligado = nada (o tema pinta atrás, como o Starry
 * fazia).
 */
export function FundoAnimado({ className }: { className?: string }) {
  const ativo = useAppStore((s) => s.fundosAnimadosAtivo);
  const tipo = useAppStore((s) => s.fundoAnimado);
  if (!ativo) return null;

  return <RenderFundoAnimado tipo={tipo} className={className} />;
}
