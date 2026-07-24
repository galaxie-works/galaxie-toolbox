import { useEffect, useState } from "react";
import { StarsBackground } from "@/components/animate-ui/components/backgrounds/stars";
import { cn } from "@/lib/utils";

/**
 * Observa a classe .dark no <html>. O demo do Animate UI usa next-themes;
 * aqui o tema e uma classe no documento, entao um observer faz o mesmo papel.
 */
export function useIsDark() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const alvo = document.documentElement;
    const obs = new MutationObserver(() =>
      setDark(alvo.classList.contains("dark"))
    );
    obs.observe(alvo, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Fundo estrelado, igual ao demo oficial (cores e gradiente radial). */
export function Estrelas({ className }: { className?: string }) {
  const dark = useIsDark();
  return (
    <StarsBackground
      // remonta ao trocar o tema: a cor entra no box-shadow, gerado uma vez
      key={dark ? "dark" : "light"}
      starColor={dark ? "#FFF" : "#000"}
      className={cn(
        "absolute inset-0 flex items-center justify-center",
        // Mesmas cores do demo. A diferenca e o TAMANHO da elipse: sem medida,
        // o CSS estica ate o canto mais distante e, numa janela de ~1400px, a
        // transicao fica tao gradual que parece plana. Limitando a elipse a
        // 120% x 70% a partir da base, o efeito radial aparece como no demo.
        "dark:bg-[radial-gradient(ellipse_120%_70%_at_50%_100%,_#262626_0%,_#000_100%)]",
        "bg-[radial-gradient(ellipse_120%_70%_at_50%_100%,_#f5f5f5_0%,_#fff_100%)]",
        className
      )}
    />
  );
}
