import { cn } from "@/lib/utils";
import galaxieLight from "@/assets/brand/galaxie_logo_light.png";
import galaxieDark from "@/assets/brand/galaxie_logo_dark.png";

/**
 * Logo da Galaxie Works. Monocromatico por tema: a versao clara e usada no
 * tema claro e vice-versa. Renderiza as duas e alterna via classe .dark.
 */
export function GalaxieMark({ className }: { className?: string }) {
  return (
    <>
      <img
        src={galaxieLight}
        alt="Galaxie Works"
        draggable={false}
        className={cn("w-auto object-contain dark:hidden", className)}
      />
      <img
        src={galaxieDark}
        alt="Galaxie Works"
        draggable={false}
        className={cn("hidden w-auto object-contain dark:block", className)}
      />
    </>
  );
}

/** Marca do produto para a barra superior: logo Galaxie + nome do app. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <GalaxieMark className="h-7" />
      <div className="h-6 w-px bg-border" />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Toolbox</div>
        <div className="text-[11px] text-muted-foreground">Acesso aos arquivos</div>
      </div>
    </div>
  );
}
