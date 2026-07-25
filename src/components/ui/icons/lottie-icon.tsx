import { useLottie } from "lottie-react";

import { cn } from "@/lib/utils";

/**
 * Ícone Lottie reutilizável para a sidebar. Fica parado no primeiro frame e só
 * anima no hover — como o hover cai no <button> da linha, os handlers de mouse
 * do wrapper disparam junto. O className vindo da sidebar (ex.: `size-5!`)
 * dimensiona o box, e o `[&_svg]:size-full` faz o svg do Lottie preencher.
 */
export function LottieIcon({
  data,
  className,
}: {
  data: unknown;
  className?: string;
}) {
  const { View, goToAndPlay, goToAndStop } = useLottie({
    animationData: data as object,
    autoplay: false,
    loop: false,
  });

  return (
    <span
      className={cn(
        // scale-[1.35]: as animações vêm com padding no canvas 500x500, então o
        // ícone visível fica menor que o box — o scale compensa pra casar com os
        // ícones lucide (que preenchem os 20px).
        "inline-flex items-center justify-center [&_svg]:size-full [&_svg]:scale-[1.35]",
        "size-5",
        className
      )}
      onMouseEnter={() => goToAndPlay(0, true)}
      onMouseLeave={() => goToAndStop(0, true)}
    >
      {View}
    </span>
  );
}
