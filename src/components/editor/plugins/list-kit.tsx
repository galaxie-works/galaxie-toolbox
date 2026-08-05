'use client';

import {
  BulletedListRules,
  isOrderedList,
  ListStyleType,
  OrderedListRules,
  TaskListRules,
  toggleList,
} from '@platejs/list';
import { ListPlugin } from '@platejs/list/react';
import { KEYS } from 'platejs';

import { IndentKit } from '@/components/editor/plugins/indent-kit';
import { BlockList } from '@/components/ui/block-list';

export const ListKit = [
  ...IndentKit,
  ListPlugin.configure({
    // #549: Ctrl+Shift+L alterna lista com marcadores (só dentro do editor — o
    // keymap central do Bridge não alcança o contenteditable). O ListPlugin não
    // tem hotkey nativa, então tratamos no onKeyDown do próprio plugin.
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === "l"
        ) {
          event.preventDefault();
          toggleList(editor, { listStyleType: ListStyleType.Disc });
        }
      },
    },
    inputRules: [
      BulletedListRules.markdown({ variant: '-' }),
      BulletedListRules.markdown({ variant: '*' }),
      OrderedListRules.markdown({ variant: '.' }),
      OrderedListRules.markdown({ variant: ')' }),
      TaskListRules.markdown({ checked: false }),
      TaskListRules.markdown({ checked: true }),
    ],
    inject: {
      nodeProps: {
        nodeKey: KEYS.listType,
        query: ({ nodeProps }) => {
          const element = nodeProps.element;

          return !!element?.listStyleType && !isOrderedList(element);
        },
        transformProps: ({ props }) => ({
          ...props,
          role: 'listitem',
          style: {
            ...props.style,
            display: 'list-item',
          },
        }),
      },
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.codeBlock,
        KEYS.toggle,
        KEYS.img,
      ],
    },
    render: {
      belowNodes: BlockList,
    },
  }),
];
