import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ShipWheelIcon } from "@/components/ui/ship-wheel";
import { ShipIcon as ShipAnim } from "@/components/ui/ship";
import { AtomIcon as AtomAnim } from "@/components/ui/atom";
import { SatelliteDishIcon } from "@/components/ui/satellite-dish";
import { BotMessageSquareIcon } from "@/components/ui/bot-message-square";

/** Handle comum dos ícones lucide-animated (todos têm o mesmo formato). */
type AnimHandle = { startAnimation: () => void; stopAnimation: () => void };
export type AnimIcon = React.ForwardRefExoticComponent<
  { className?: string; size?: number } & React.RefAttributes<AnimHandle>
>;

/**
 * Ícones da navegação — lucide-animated (motion). Usam `currentColor`, então
 * herdam a cor do tema (legíveis no claro e no escuro). O box é dimensionado
 * pelo className da sidebar/header (ex.: `size-5!`) e o `[&_svg]:size-full`
 * faz o svg preencher.
 *
 * Animação: em vez do hover do próprio ícone, comandamos via ref (modo
 * "controlado" do componente) a partir do hover da LINHA inteira — achamos o
 * `<a>`/`<button>` ancestral e disparamos start/stop nele. Assim o ícone anima
 * quando o mouse passa por qualquer ponto da linha (ícone + texto).
 */
export function IconeAnim({ Comp, className }: { Comp: AnimIcon; className?: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const handle = useRef<AnimHandle>(null);

  useEffect(() => {
    const linha = spanRef.current?.closest("a,button");
    if (!linha) return;
    const entrar = () => handle.current?.startAnimation();
    const sair = () => handle.current?.stopAnimation();
    linha.addEventListener("mouseenter", entrar);
    linha.addEventListener("mouseleave", sair);
    return () => {
      linha.removeEventListener("mouseenter", entrar);
      linha.removeEventListener("mouseleave", sair);
    };
  }, []);

  return (
    <span
      ref={spanRef}
      className={cn(
        "inline-flex items-center justify-center [&_svg]:size-full",
        "size-5",
        className
      )}
    >
      <Comp ref={handle} className="flex size-full items-center justify-center" size={20} />
    </span>
  );
}

/**
 * Ícone de ITEM de sidebar (tela Apps) — renderiza o lucide-animated do MESMO
 * jeito que o Bridge renderiza os ícones de pasta (`<Ico size={16}
 * className="shrink-0 text-muted-foreground" />`, control-room.tsx): 16px, cor
 * `muted`, `currentColor`. Ao contrário do `IconeAnim` da app-rail (span
 * `size-5` + ícone `size={20}`, que saía MAIOR), aqui o box é `display:contents`
 * — some do layout e o ícone fica pixel-idêntico ao do Bridge. Anima no hover da
 * LINHA inteira: acha o `<a>/<button>` ancestral e comanda start/stop via ref.
 */
export function IconeItemAnim({ Comp, className }: { Comp: AnimIcon; className?: string }) {
  const ancoraRef = useRef<HTMLSpanElement>(null);
  const handle = useRef<AnimHandle>(null);

  useEffect(() => {
    const linha = ancoraRef.current?.closest("a,button");
    if (!linha) return;
    const entrar = () => handle.current?.startAnimation();
    const sair = () => handle.current?.stopAnimation();
    linha.addEventListener("mouseenter", entrar);
    linha.addEventListener("mouseleave", sair);
    return () => {
      linha.removeEventListener("mouseenter", entrar);
      linha.removeEventListener("mouseleave", sair);
    };
  }, []);

  return (
    <span ref={ancoraRef} className="contents">
      <Comp
        ref={handle}
        size={16}
        className={cn("shrink-0 text-muted-foreground", className)}
      />
    </span>
  );
}

/** Bridge (Control room) — timão (ship-wheel). */
export function BridgeIcon({ className }: { className?: string }) {
  return <IconeAnim Comp={ShipWheelIcon as unknown as AnimIcon} className={className} />;
}

/**
 * Bridge para o HEADER do conteúdo (#231). Diferente do da sidebar: aqui não há
 * linha `<a>/<button>` ancestral pra comandar o hover, então animamos na ENTRADA
 * (mount) e no hover do PRÓPRIO ícone — usando o modo controlado do
 * `ShipWheelIcon` (mesmo componente do registry, sem inventar UI).
 */
export function BridgeHeaderIcon({ className }: { className?: string }) {
  const handle = useRef<AnimHandle>(null);

  useEffect(() => {
    handle.current?.startAnimation();
    const t = window.setTimeout(() => handle.current?.stopAnimation(), 1200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center [&_svg]:size-full",
        "size-6",
        className
      )}
      onMouseEnter={() => handle.current?.startAnimation()}
      onMouseLeave={() => handle.current?.stopAnimation()}
    >
      <ShipWheelIcon
        ref={handle}
        className="flex size-full items-center justify-center"
        size={24}
      />
    </span>
  );
}

/** Navigator (navegador embutido) — nave (ship). */
export function NavigatorIcon({ className }: { className?: string }) {
  return <IconeAnim Comp={ShipAnim as unknown as AnimIcon} className={className} />;
}

/** Atoms (home / dashboard) — átomo (elétrons orbitando no hover). */
export function AtomIcon({ className }: { className?: string }) {
  return <IconeAnim Comp={AtomAnim as unknown as AnimIcon} className={className} />;
}

/** Comms — antena parabólica (satellite-dish). */
export function CommsIcon({ className }: { className?: string }) {
  return <IconeAnim Comp={SatelliteDishIcon as unknown as AnimIcon} className={className} />;
}

/** Astro — assistente (bot-message-square). */
export function AstroIcon({ className }: { className?: string }) {
  return <IconeAnim Comp={BotMessageSquareIcon as unknown as AnimIcon} className={className} />;
}
