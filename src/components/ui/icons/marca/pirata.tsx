import { useLottie } from "lottie-react";

import pirata from "@/components/ui/icons/marca/pirate-costume.json";
import { cn } from "@/lib/utils";

/**
 * Ícone PIRATA do hero da aba privada (#273) — Lottie em loop. O asset vem com 2
 * cores (teal + preto); aqui forçamos fill/stroke pra a **cor primária do tema**
 * via CSS (`!fill-primary`/`!stroke-primary`), então fica numa cor só e
 * **theme-aware** (segue claro/escuro pelo token `--primary`), sem editar o JSON.
 * Mesmo padrão de dimensionamento do LottieIcon (canvas 500x500 com padding →
 * `[&_svg]:size-full` + `scale` pra casar com os ícones da marca).
 */
export function PirataIcon({ className }: { className?: string }) {
  const { View } = useLottie({
    animationData: pirata as object,
    autoplay: true,
    loop: true,
  });

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center text-primary",
        "[&_svg]:size-full [&_svg]:scale-[1.35]",
        "[&_path]:!fill-primary [&_path]:!stroke-primary",
        "size-10",
        className,
      )}
    >
      {View}
    </span>
  );
}
