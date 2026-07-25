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
 * Marca do CLIENTE, exibida no topo da sidebar (o slot que no shadcn e o
 * seletor de organizacao).
 *
 * TODO multi-tenant: hoje o arquivo e fixo. Quando entrar o segundo cliente,
 * isto deve virar um asset por tenant (ou a foto/logo vindo do proprio Entra),
 * resolvido a partir do dominio de quem logou.
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
