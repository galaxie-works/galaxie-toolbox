'use client';

import * as React from 'react';

import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorReadOnly } from 'platejs/react';

import { plateLabel } from '@/lib/plate-labels';
import { AIToolbarButton } from './ai-toolbar-button';
import { CommentToolbarButton } from './comment-toolbar-button';
import { InlineEquationToolbarButton } from './equation-toolbar-button';
import { LinkToolbarButton } from './link-toolbar-button';
import { MoreToolbarButton } from './more-toolbar-button';
import { ShortcutMarkToolbarButton } from './shortcut-mark-toolbar-button';
import { SuggestionToolbarButton } from './suggestion-toolbar-button';
import { ToolbarGroup } from './toolbar';
import { TurnIntoToolbarButton } from './turn-into-toolbar-button';

export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();

  return (
    <>
      {!readOnly && (
        <>
          <ToolbarGroup>
            <AIToolbarButton tooltip={plateLabel('aiCommands')}>
              <WandSparklesIcon />
              Ask AI
            </AIToolbarButton>
          </ToolbarGroup>

          <ToolbarGroup>
            <TurnIntoToolbarButton />

            <ShortcutMarkToolbarButton
              nodeType={KEYS.bold}
              label="Bold"
              shortcut={{ primary: true, key: 'B' }}
            >
              <BoldIcon />
            </ShortcutMarkToolbarButton>

            <ShortcutMarkToolbarButton
              nodeType={KEYS.italic}
              label="Italic"
              shortcut={{ primary: true, key: 'I' }}
            >
              <ItalicIcon />
            </ShortcutMarkToolbarButton>

            <ShortcutMarkToolbarButton
              nodeType={KEYS.underline}
              label="Underline"
              shortcut={{ primary: true, key: 'U' }}
            >
              <UnderlineIcon />
            </ShortcutMarkToolbarButton>

            <ShortcutMarkToolbarButton
              nodeType={KEYS.strikethrough}
              label="Strikethrough"
              shortcut={{ primary: true, shift: true, key: 'M' }}
            >
              <StrikethroughIcon />
            </ShortcutMarkToolbarButton>

            <ShortcutMarkToolbarButton
              nodeType={KEYS.code}
              label="Code"
              shortcut={{ primary: true, key: 'E' }}
            >
              <Code2Icon />
            </ShortcutMarkToolbarButton>

            <InlineEquationToolbarButton />

            <LinkToolbarButton />
          </ToolbarGroup>
        </>
      )}

      <ToolbarGroup>
        <CommentToolbarButton />
        <SuggestionToolbarButton />

        {!readOnly && <MoreToolbarButton />}
      </ToolbarGroup>
    </>
  );
}
