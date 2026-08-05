'use client';

import * as React from 'react';

import {
  useLinkToolbarButton,
  useLinkToolbarButtonState,
} from '@platejs/link/react';
// #500: ícone animado do registry (lucide-animated) no lugar do lucide estático.
import { LinkIcon } from '@/components/ui/link';
// #529: rótulo config-driven (helper não-hook, padrão textoUi #475/#525).
import { plateLabel } from '@/lib/plate-labels';
// #549: atalho Ctrl+K (wire no LinkKit via triggerFloatingLinkHotkeys) → kbd.
import {
  shortcutAccessibleLabel,
  type ShortcutDefinition,
} from '@/components/ui/shortcut';
import { ShortcutTooltip } from '@/components/ui/shortcut-tooltip';

import { ToolbarButton } from './toolbar';

const ATALHO_LINK: ShortcutDefinition = { key: 'K', primary: true };

export function LinkToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const state = useLinkToolbarButtonState();
  const { props: buttonProps } = useLinkToolbarButton(state);

  return (
    <ToolbarButton
      {...props}
      {...buttonProps}
      aria-label={shortcutAccessibleLabel(plateLabel("link"), ATALHO_LINK)}
      data-plate-focus
      tooltip={
        <ShortcutTooltip label={plateLabel("link")} shortcut={ATALHO_LINK} />
      }
    >
      <LinkIcon />
    </ToolbarButton>
  );
}
