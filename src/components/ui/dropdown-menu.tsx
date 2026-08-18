"use client"

/**
 * Dropdown menu do app — ponto único de troca (#477, épico #476 Radix→animate-ui).
 *
 * Re-exporta os 14 componentes do `@animate-ui/components-radix-dropdown-menu`
 * (já instalado), preservando exports e API: radio groups / checkbox items /
 * ícones / Label / Separator / Shortcut e os **3 submenus** (Sub/SubTrigger/
 * SubContent), além do `onOpenChange` — que os dropdowns do Navegador usam para
 * **ceder a webview** (P0: sem ele a webview fica por cima). Como a base do
 * animate-ui mantém o estilo (bg-popover/border/indicators), o visual fica igual
 * e só ganha a animação de highlight/entrada.
 *
 * Migra de uma vez os ~17 dropdowns do app que importam daqui. O editor Plate
 * (vendorizado) e os já-no-animate-ui não passam por este ponto.
 *
 * `DropdownMenuPortal` não é exportado pelo animate-ui — mantemos o do Radix
 * (usado só pelo `table-node` do Plate), pra não quebrar o export.
 */
import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { useRegistroOverlayWebview } from "@/lib/navigator-overlay"
import {
  DropdownMenu as DropdownMenuBase,
  type DropdownMenuProps,
} from "@/components/animate-ui/components/radix/dropdown-menu"

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

/**
 * #1163 D2: o dropdown cede a webview do Navigator sozinho (aberto por trigger ou
 * controlado). Antes cada dropdown do Navegador passava `onOpenChange={registrar}`
 * na mão — opt-in que o overlay novo esquecia. Agora é por construção.
 */
function DropdownMenu({ open, onOpenChange, ...props }: DropdownMenuProps) {
  const aoMudarAbertura = useRegistroOverlayWebview(open, onOpenChange)
  return (
    <DropdownMenuBase
      open={open}
      onOpenChange={aoMudarAbertura}
      {...props}
    />
  )
}

export {
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  // Tipos também vêm do ponto único: consumidores que anotam props de menu
  // (ex.: o toolbar de cor do Plate) alinham com o componente animate-ui em vez
  // de importar o tipo do Radix e divergir no `onSelect` (#477).
  type DropdownMenuProps,
  type DropdownMenuTriggerProps,
  type DropdownMenuContentProps,
  type DropdownMenuGroupProps,
  type DropdownMenuItemProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioGroupProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuLabelProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuShortcutProps,
  type DropdownMenuSubProps,
  type DropdownMenuSubTriggerProps,
  type DropdownMenuSubContentProps,
} from "@/components/animate-ui/components/radix/dropdown-menu"
export { DropdownMenu, DropdownMenuPortal }
