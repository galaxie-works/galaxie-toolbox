type ShortcutDefinition = {
  key: string
  primary?: boolean
  shift?: boolean
}

function isApplePlatform(userAgent?: string): boolean {
  const value =
    userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent)

  return /Mac|iPhone|iPad|iPod/i.test(value)
}

function formatShortcut(
  shortcut: ShortcutDefinition,
  userAgent?: string
): string {
  const apple = isApplePlatform(userAgent)
  const keys = [
    shortcut.primary ? (apple ? "⌘" : "Ctrl") : null,
    shortcut.shift ? (apple ? "⇧" : "Shift") : null,
    shortcut.key,
  ].filter(Boolean)

  return keys.join("+")
}

function shortcutAccessibleLabel(
  label: string,
  shortcut: ShortcutDefinition,
  userAgent?: string
): string {
  return `${label}, ${formatShortcut(shortcut, userAgent)}`
}

export {
  formatShortcut,
  shortcutAccessibleLabel,
  type ShortcutDefinition,
}
