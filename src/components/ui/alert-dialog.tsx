import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useRegistroOverlayWebview } from "@/lib/navigator-overlay"
/**
 * #480 (épico #476): dialogs migrados pro Animate UI. **Ponto único de troca** —
 * envolve o primitivo `radix` do Animate UI (overlay/content via `motion`,
 * `AnimatePresence` + estado controlado por `useControlledState(open/onOpenChange)`).
 *
 * Preservado de propósito, envolvendo o PRIMITIVO em vez de re-exportar o
 * componente pronto:
 * - toda a estilização custom (prop `size`, `AlertDialogMedia`, header em grid);
 * - `AlertDialogAction`/`Cancel` seguem envolvendo o `Button` (mantém o
 *   `variant="destructive"` do #482 e o hold-on-submit via `e.preventDefault()`);
 * - `open`/`onOpenChange` controlado chega intacto ao Radix → o
 *   `useOcultarWebviewEnquantoAberto` (#275, P0) e a trava de fechar durante o
 *   Graph continuam valendo.
 *
 * A animação é sobrescrita pra zoom+fade com o `translate(-50%,-50%)` embutido no
 * transform do motion — sem isso o transform do motion sobrescreveria o
 * `translate` de centralização do Tailwind e o dialog ficaria fora do centro.
 */
import {
  AlertDialog as AlertDialogPrimitive,
  AlertDialogTrigger as AlertDialogTriggerPrimitive,
  AlertDialogPortal as AlertDialogPortalPrimitive,
  AlertDialogOverlay as AlertDialogOverlayPrimitive,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogAction as AlertDialogActionPrimitive,
  AlertDialogCancel as AlertDialogCancelPrimitive,
  type AlertDialogProps,
  type AlertDialogTriggerProps,
  type AlertDialogPortalProps,
  type AlertDialogTitleProps,
  type AlertDialogDescriptionProps,
  type AlertDialogActionProps,
  type AlertDialogCancelProps,
} from "@/components/animate-ui/primitives/radix/alert-dialog"

function AlertDialog({ open, onOpenChange, ...props }: AlertDialogProps) {
  // #1163 D2: cede a webview do Navigator sozinho (controlado OU por trigger).
  const aoMudarAbertura = useRegistroOverlayWebview(open, onOpenChange)
  return (
    <AlertDialogPrimitive
      data-slot="alert-dialog"
      open={open}
      onOpenChange={aoMudarAbertura}
      {...props}
    />
  )
}

function AlertDialogTrigger(props: AlertDialogTriggerProps) {
  return (
    <AlertDialogTriggerPrimitive data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal(props: AlertDialogPortalProps) {
  return (
    <AlertDialogPortalPrimitive data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogOverlayPrimitive>) {
  return (
    <AlertDialogOverlayPrimitive
      data-slot="alert-dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogContentPrimitive> & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortalPrimitive>
      <AlertDialogOverlay />
      <AlertDialogContentPrimitive
        data-slot="alert-dialog-content"
        data-size={size}
        // Zoom+fade com o translate de centralização embutido no transform do
        // motion (não dá pra deixar o `translate-x/y-[-50%]` no className: o
        // transform inline do motion o sobrescreveria).
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
          "group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg",
          className
        )}
        {...props}
      />
    </AlertDialogPortalPrimitive>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return (
    <AlertDialogTitlePrimitive
      data-slot="alert-dialog-title"
      className={cn(
        "text-lg font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: AlertDialogDescriptionProps) {
  return (
    <AlertDialogDescriptionPrimitive
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-16 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: AlertDialogActionProps &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogActionPrimitive
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogCancelProps &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogCancelPrimitive
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
