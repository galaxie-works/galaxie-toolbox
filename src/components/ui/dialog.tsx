import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
/**
 * #480 (épico #476): dialogs migrados pro Animate UI. **Ponto único de troca** —
 * envolve o primitivo `radix` do Animate UI (overlay/content via `motion` +
 * `AnimatePresence` + estado controlado por `useControlledState(open/onOpenChange)`).
 *
 * Preservado (envolvendo o PRIMITIVO em vez de re-exportar o componente pronto):
 * estilização/centralização, `showCloseButton` (Content e Footer), e o
 * `open`/`onOpenChange` controlado — crítico pro 🔴 `useOcultarWebviewEnquantoAberto`
 * (#275, P0): os dialogs do Navigator escondem a webview por estado controlado, e
 * esse estado chega intacto ao Radix. A animação embute o `translate(-50%,-50%)`
 * no transform do motion (senão o motion sobrescreveria a centralização Tailwind).
 */
import {
  Dialog as DialogPrimitive,
  DialogTrigger as DialogTriggerPrimitive,
  DialogPortal as DialogPortalPrimitive,
  DialogOverlay as DialogOverlayPrimitive,
  DialogContent as DialogContentPrimitive,
  DialogClose as DialogClosePrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  type DialogProps,
  type DialogTriggerProps,
  type DialogPortalProps,
  type DialogCloseProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
} from "@/components/animate-ui/primitives/radix/dialog"

function Dialog(props: DialogProps) {
  return <DialogPrimitive data-slot="dialog" {...props} />
}

function DialogTrigger(props: DialogTriggerProps) {
  return <DialogTriggerPrimitive data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: DialogPortalProps) {
  return <DialogPortalPrimitive data-slot="dialog-portal" {...props} />
}

function DialogClose(props: DialogCloseProps) {
  return <DialogClosePrimitive data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogOverlayPrimitive>) {
  return (
    <DialogOverlayPrimitive
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogContentPrimitive> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortalPrimitive data-slot="dialog-portal">
      <DialogOverlay />
      <DialogContentPrimitive
        data-slot="dialog-content"
        initial={{
          opacity: 0,
          transform: "translate(-50%, -50%) scale(0.95)",
        }}
        animate={{
          opacity: 1,
          transform: "translate(-50%, -50%) scale(1)",
        }}
        exit={{
          opacity: 0,
          transform: "translate(-50%, -50%) scale(0.95)",
        }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClosePrimitive
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClosePrimitive>
        )}
      </DialogContentPrimitive>
    </DialogPortalPrimitive>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClosePrimitive asChild>
          <Button variant="outline">Close</Button>
        </DialogClosePrimitive>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogTitlePrimitive
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <DialogDescriptionPrimitive
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
