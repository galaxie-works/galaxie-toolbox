import { cn } from "@/lib/utils";
import galaxieLight from "@/assets/brand/galaxie_logo_light.png";
import galaxieDark from "@/assets/brand/galaxie_logo_dark.png";
import galaxieSimbolo from "@/assets/brand/galaxie-symbol.png";
import clienteLight from "@/assets/brand/voaz-cloud-light.png";
import clienteDark from "@/assets/brand/voaz-cloud-dark.png";

/**
 * Símbolo quadrado da Galaxie (só o planeta/galáxia, sem o wordmark). Usado
 * como ícone do grupo Galaxie na sidebar. Colorido de propósito — é a marca,
 * como os ícones de produto do M365. Traz size-4 por padrão porque a sidebar
 * dimensiona SVGs por CSS, e isto é um <img> (o CSS de svg não o alcança).
 */
export function GalaxieSymbol({ className }: { className?: string }) {
  return (
    <img
      src={galaxieSimbolo}
      alt=""
      draggable={false}
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  );
}

/**
 * #541: logo do TENANT vindo do Entra branding (data URLs claro/escuro), limpo
 * — sem box/contorno. Theme-aware: `claro` no tema claro, `escuro` no escuro
 * (cai no claro se não houver dark). É o fallback do multi-tenant que o
 * `ClienteMark` abaixo antecipava. Só renderiza quando há logo; a decisão de
 * mostrar isto vs. o `ClienteMark` estático fica no app-sidebar.
 */
export function TenantLogo({
  claro,
  escuro,
  className,
}: {
  claro: string;
  escuro: string;
  className?: string;
}) {
  return (
    <>
      <img
        src={claro}
        alt=""
        draggable={false}
        className={cn("object-contain dark:hidden", className)}
      />
      <img
        src={escuro}
        alt=""
        draggable={false}
        className={cn("hidden object-contain dark:block", className)}
      />
    </>
  );
}

/**
 * Marca do CLIENTE (fallback estático), exibida no topo da sidebar quando o
 * tenant não tem branding no Entra. Vai dentro de um box `bg-sidebar-primary`.
 *
 * O caso tenant-com-branding é o `TenantLogo` acima (#541), limpo e sem box.
 */
export function ClienteMark({ className }: { className?: string }) {
  return (
    <>
      {/* Vai dentro de um box bg-sidebar-primary, que é escuro no tema claro e
          claro no escuro. Por isso a variante é INVERTIDA em relação ao tema:
          logo branco sobre box escuro, e vice-versa. */}
      <img
        src={clienteDark}
        alt=""
        draggable={false}
        className={cn("object-contain dark:hidden", className)}
      />
      <img
        src={clienteLight}
        alt=""
        draggable={false}
        className={cn("hidden object-contain dark:block", className)}
      />
    </>
  );
}

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
