import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

// NOTA: usamos react-resizable-panels v3 (API clássica: PanelGroup / Panel /
// PanelResizeHandle + prop `direction`). NÃO regenerar via reui/shadcn com
// --overwrite: a versão deles usa a API v4 (Group/Separator/orientation), que
// não existe na v3 e deixa `ResizablePrimitive.Group` undefined -> tela branca.

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

// #1667: `style` está FORA do tipo (`Omit<…, "style">`). Passar `style` a este
// componente — sob qualquer alias, spread ou forma dinâmica — é ERRO DE
// COMPILAÇÃO. A âncora do gate de texto (`resizable-ponto-unico.test.ts`) casa o
// literal `<ResizableHandle` e um `import { ResizableHandle as RH }` a
// contornava (589/589 verde com `style` proibido presente, achado @Íris/@Lúmen);
// o compilador não se deixa contornar por alias. Margem/fundo/hover vêm do ponto
// único abaixo, e `style` é a MESMA porta por outra prop.
function ResizableHandle({
  withHandle,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>,
  "style"
> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      // #1279: o PADRÃO do splitter do app mora AQUI, num ponto único — barra
      // transparente com `hover:bg-border` + a margem `mx-1.5`. Antes cada uso
      // (Files, Bridge, People) repetia `mx-1.5 bg-transparent hover:bg-border`
      // e o Files divergiu (ficou sem o hover). Agora todo `ResizableHandle`
      // nasce no padrão; um uso só passa `className` pra ALGO A MAIS (ex.
      // `print:hidden`), nunca pra repetir a barra/hover/margem.
      // #1667: `className` do uso vem PRIMEIRO e o padrão DEPOIS. No
      // tailwind-merge o último ganha o conflito, então a barra/margem/hover do
      // ponto único vencem um `mx-4` etc. que um uso passe; o aditivo legítimo
      // sem conflito (`print:hidden`) continua a aplicar-se. Assim o padrão não
      // depende da guarda de texto para não ser sobreposto.
      className={cn(
        className,
        "relative mx-1.5 flex w-px items-center justify-center bg-transparent hover:bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90"
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
