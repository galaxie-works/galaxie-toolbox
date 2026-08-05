'use client';

import { LinkRules } from '@platejs/link';
import { LinkPlugin, triggerFloatingLink } from '@platejs/link/react';

import { LinkElement } from '@/components/ui/link-node';
import { LinkFloatingToolbar } from '@/components/ui/link-toolbar';

export const LinkKit = [
  LinkPlugin.configure({
    // #549: Ctrl+K abre o input flutuante de link (padrão Outlook/Word). Wire no
    // onKeyDown do próprio plugin (mesmo padrão do Ctrl+Shift+L da lista) —
    // dispara só dentro do editor; o keymap central do Bridge é bypassado por
    // `isTypingTarget` no contenteditable.
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          triggerFloatingLink(editor, { focused: true });
        }
      },
    },
    inputRules: [
      LinkRules.markdown(),
      LinkRules.autolink({ variant: 'paste' }),
      LinkRules.autolink({ variant: 'space' }),
      LinkRules.autolink({ variant: 'break' }),
    ],
    render: {
      node: LinkElement,
      afterEditable: () => <LinkFloatingToolbar />,
    },
  }),
];
