import { Kbd } from "@/components/ui/kbd"
import {
  formatShortcut,
  type ShortcutDefinition,
} from "@/components/ui/shortcut"

function ShortcutTooltip({
  label,
  shortcut,
}: {
  label: string
  shortcut: ShortcutDefinition
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {label}
      <Kbd>{formatShortcut(shortcut)}</Kbd>
    </div>
  )
}

export { ShortcutTooltip }
