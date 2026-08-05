'use client';

import * as React from 'react';

import {
  useLinkToolbarButton,
  useLinkToolbarButtonState,
} from '@platejs/link/react';
// #500: ícone animado do registry (lucide-animated) no lugar do lucide estático.
import { LinkIcon } from '@/components/ui/link';

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
      aria-label="Link"
      data-plate-focus
      tooltip="Link"
    >
      <LinkIcon />
    </ToolbarButton>
  );
}
