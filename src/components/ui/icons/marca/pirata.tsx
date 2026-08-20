import { useLottie } from "lottie-react";

import pirata from "@/components/ui/icons/marca/pirate-costume.json";
import { cn } from "@/lib/utils";

/**
 * Ícone PIRATA do hero da aba privada (#273) — Lottie em loop. O asset vem com 2
 * cores (teal + preto); aqui forçamos fill/stroke pra a **cor primária do tema**
 * via CSS (`!fill-primary`/`!stroke-primary`), então fica numa cor só e
 * **theme-aware** (segue claro/escuro pelo token `--primary`), sem editar o JSON.
 * O canvas do asset é 500x500 COM padding, então o desenho visível fica menor
 * que o box: `[&_svg]:size-full` + `scale` compensam pra casar com os ícones da
 * marca. (#1328: aqui havia uma remissão a um wrapper Lottie genérico que era
 * código morto e foi removido. A regra do apontamento vale pro comentário
 * também: nome de símbolo apagado é a mesma armadilha em outro lugar.)
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
