'use client';

import * as React from 'react';

import { ListStyleType, someList, toggleList } from '@platejs/list';
import {
  useIndentTodoToolBarButton,
  useIndentTodoToolBarButtonState,
} from '@platejs/list/react';
import { ListOrdered, ListTodoIcon } from 'lucide-react';
import { useEditorRef, useEditorSelector } from 'platejs/react';

// #500: ícone de lista animado do animate-ui (registry) na bulleted list.
import { ListIcon } from '@/components/animate-ui/icons/list';
// #529: rótulos config-driven do editor (helper não-hook, padrão textoUi).
import { plateLabel } from '@/lib/plate-labels';
// #549: atalho Ctrl+Shift+L (wire no ListKit via onKeyDown) → kbd no tooltip.
import {
  shortcutAccessibleLabel,
  type ShortcutDefinition,
} from '@/components/ui/shortcut';
import { ShortcutTooltip } from '@/components/ui/shortcut-tooltip';

const ATALHO_LISTA: ShortcutDefinition = { key: 'L', primary: true, shift: true };

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  ToolbarButton,
  ToolbarSplitButton,
  ToolbarSplitButtonPrimary,
  ToolbarSplitButtonSecondary,
} from './toolbar';

export function BulletedListToolbarButton() {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  const pressed = useEditorSelector(
    (editor) =>
      someList(editor, [
        ListStyleType.Disc,
        ListStyleType.Circle,
        ListStyleType.Square,
      ]),
    []
  );

  return (
    <ToolbarSplitButton pressed={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarSplitButtonPrimary
            aria-label={shortcutAccessibleLabel(
              plateLabel("bulletedList"),
              ATALHO_LISTA
            )}
            className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            onClick={() => {
              toggleList(editor, {
                listStyleType: ListStyleType.Disc,
              });
            }}
            data-state={pressed ? 'on' : 'off'}
          >
            <ListIcon
              animateOnHover
              className="size-4 pointer-events-auto"
            />
          </ToolbarSplitButtonPrimary>
        </TooltipTrigger>
        <TooltipContent>
          <ShortcutTooltip
            label={plateLabel("bulletedList")}
            shortcut={ATALHO_LISTA}
          />
        </TooltipContent>
      </Tooltip>

      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ToolbarSplitButtonSecondary
                aria-label={plateLabel("bulletedListOptions")}
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{plateLabel("bulletedListOptions")}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" alignOffset={-32}>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.Disc,
                })
              }
            >
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full border border-current bg-current" />
                {plateLabel("listDisc")}
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.Circle,
                })
              }
            >
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full border border-current" />
                {plateLabel("listCircle")}
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.Square,
                })
              }
            >
              <div className="flex items-center gap-2">
                <div className="size-2 border border-current bg-current" />
                {plateLabel("listSquare")}
              </div>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ToolbarSplitButton>
  );
}

export function NumberedListToolbarButton() {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  const pressed = useEditorSelector(
    (editor) =>
      someList(editor, [
        ListStyleType.Decimal,
        ListStyleType.LowerAlpha,
        ListStyleType.UpperAlpha,
        ListStyleType.LowerRoman,
        ListStyleType.UpperRoman,
      ]),
    []
  );

  return (
    <ToolbarSplitButton pressed={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarSplitButtonPrimary
            aria-label="Numbered list"
            className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            onClick={() =>
              toggleList(editor, {
                listStyleType: ListStyleType.Decimal,
              })
            }
            data-state={pressed ? 'on' : 'off'}
          >
            <ListOrdered className="size-4" />
          </ToolbarSplitButtonPrimary>
        </TooltipTrigger>
        <TooltipContent>Numbered list</TooltipContent>
      </Tooltip>

      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ToolbarSplitButtonSecondary aria-label="Numbered list options" />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Numbered list options</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" alignOffset={-32}>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.Decimal,
                })
              }
            >
              Decimal (1, 2, 3)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.LowerAlpha,
                })
              }
            >
              Lower Alpha (a, b, c)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.UpperAlpha,
                })
              }
            >
              Upper Alpha (A, B, C)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.LowerRoman,
                })
              }
            >
              Lower Roman (i, ii, iii)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                toggleList(editor, {
                  listStyleType: ListStyleType.UpperRoman,
                })
              }
            >
              Upper Roman (I, II, III)
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ToolbarSplitButton>
  );
}

export function TodoListToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const state = useIndentTodoToolBarButtonState({ nodeType: 'todo' });
  const { props: buttonProps } = useIndentTodoToolBarButton(state);

  return (
    <ToolbarButton {...props} {...buttonProps} tooltip="Todo">
      <ListTodoIcon />
    </ToolbarButton>
  );
}
