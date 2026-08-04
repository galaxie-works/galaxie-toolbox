import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
/**
 * #479 (épico #476): sheets laterais migradas pro Animate UI. Este é o **ponto
 * único de troca** — troca o primitivo Radix cru por `@animate-ui/.../radix/sheet`
 * (slide/overlay via `motion` em vez de animação Tailwind `data-[state]`).
 *
 * As **larguras e o layout originais são preservados** de propósito: o componente
 * pronto do Animate UI usa base `w-[350px]`, mas várias sheets do app passam só
 * `sm:max-w-lg`/`sm:max-w-md` (sem `w-*`) e dependem da base `w-3/4 sm:max-w-sm`.
 * Por isso envolvemos o PRIMITIVO aqui com as mesmas classes de sempre, em vez de
 * re-exportar o componente. `side`, `showCloseButton` e o `onOpenChange`
 * controlado (que TRAVA o fechar durante merge/envio) seguem iguais — o primitivo
 * usa `useControlledState(open/onOpenChange)`, então a trava continua valendo.
 */
import {
  Sheet as SheetPrimitive,
  SheetTrigger as SheetTriggerPrimitive,
  SheetClose as SheetClosePrimitive,
  SheetPortal as SheetPortalPrimitive,
  SheetOverlay as SheetOverlayPrimitive,
  SheetContent as SheetContentPrimitive,
  SheetTitle as SheetTitlePrimitive,
  SheetDescription as SheetDescriptionPrimitive,
  type SheetProps,
  type SheetTriggerProps,
  type SheetCloseProps,
  type SheetContentProps,
  type SheetTitleProps,
  type SheetDescriptionProps,
} from "@/components/animate-ui/primitives/radix/sheet"

function Sheet(props: SheetProps) {
  return <SheetPrimitive data-slot="sheet" {...props} />
}

function SheetTrigger(props: SheetTriggerProps) {
  return <SheetTriggerPrimitive data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: SheetCloseProps) {
  return <SheetClosePrimitive data-slot="sheet-close" {...props} />
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetContentProps & {
  showCloseButton?: boolean
}) {
  return (
    <SheetPortalPrimitive>
      <SheetOverlayPrimitive className="fixed inset-0 z-50 bg-black/50" />
      <SheetContentPrimitive
        data-slot="sheet-content"
        side={side}
        // O primitivo já fixa `position:fixed` + inset por `side` (inline). Aqui
        // ficam só tamanho/borda/layout — as MESMAS classes do sheet original,
        // sem as classes de animação Tailwind (o `motion` cuida do slide).
        className={cn(
          "z-50 flex flex-col gap-4 bg-background shadow-lg",
          (side === "right" || side === "left") && "h-full w-3/4 sm:max-w-sm",
          side === "right" && "border-l",
          side === "left" && "border-r",
          side === "top" && "h-auto border-b",
          side === "bottom" && "h-auto border-t",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetClosePrimitive className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetClosePrimitive>
        )}
      </SheetContentPrimitive>
    </SheetPortalPrimitive>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <SheetTitlePrimitive
      data-slot="sheet-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return (
    <SheetDescriptionPrimitive
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
