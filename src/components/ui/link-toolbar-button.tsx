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

import { ToolbarButton } from './toolbar';

export function LinkToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const state = useLinkToolbarButtonState();
  const { props: buttonProps } = useLinkToolbarButton(state);

  return (
    <ToolbarButton
      {...props}
      {...buttonProps}
      aria-label={plateLabel("link")}
      data-plate-focus
      tooltip={plateLabel("link")}
    >
      <LinkIcon />
    </ToolbarButton>
  );
}
