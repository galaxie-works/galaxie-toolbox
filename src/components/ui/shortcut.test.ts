import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatShortcut,
  shortcutAccessibleLabel,
} from "./shortcut.ts"

const WINDOWS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
const MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"

test("formats the primary modifier as Ctrl on Windows", () => {
  assert.equal(
    formatShortcut({ primary: true, key: "B" }, WINDOWS_USER_AGENT),
    "Ctrl+B"
  )
  assert.equal(
    formatShortcut(
      { primary: true, shift: true, key: "M" },
      WINDOWS_USER_AGENT
    ),
    "Ctrl+Shift+M"
  )
})

test("keeps the native modifier labels on Apple platforms", () => {
  assert.equal(
    formatShortcut({ primary: true, key: "B" }, MAC_USER_AGENT),
    "⌘+B"
  )
  assert.equal(
    formatShortcut(
      { primary: true, shift: true, key: "M" },
      MAC_USER_AGENT
    ),
    "⌘+⇧+M"
  )
})

test("builds a descriptive accessible name with the visible shortcut", () => {
  assert.equal(
    shortcutAccessibleLabel(
      "Strikethrough",
      { primary: true, shift: true, key: "M" },
      WINDOWS_USER_AGENT
    ),
    "Strikethrough, Ctrl+Shift+M"
  )
})
