import * as React from "react"

import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button"
import { shortcutAccessibleLabel } from "@/components/ui/shortcut"
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip"
import type { ShortcutDefinition } from "@/components/ui/shortcut"

type ShortcutMarkToolbarButtonProps = Omit<
  React.ComponentProps<typeof MarkToolbarButton>,
  "aria-label" | "tooltip"
> & {
  label: string
  shortcut: ShortcutDefinition
}

function ShortcutMarkToolbarButton({
  label,
  shortcut,
  ...props
}: ShortcutMarkToolbarButtonProps) {
  return (
    <MarkToolbarButton
      {...props}
      aria-label={shortcutAccessibleLabel(label, shortcut)}
      tooltip={<ShortcutTooltip label={label} shortcut={shortcut} />}
    />
  )
}

export { ShortcutMarkToolbarButton }
