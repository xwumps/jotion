'use client';

import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { Copy, GripVertical, Link2, Palette, Plus, Repeat2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import * as M from '@radix-ui/react-dropdown-menu';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu';
import { ColorGrid } from './bubble-menu';
import { BLOCK_COMMANDS, type CommandContext } from './commands';

function stripIds(json: JSONContent): JSONContent {
  const { attrs, content, ...rest } = json;
  const nextAttrs = attrs ? { ...attrs, id: null } : attrs;
  return {
    ...rest,
    ...(nextAttrs ? { attrs: nextAttrs } : {}),
    ...(content ? { content: content.map(stripIds) } : {}),
  };
}

const subTriggerClass =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[14px] outline-none data-[highlighted]:bg-hover data-[state=open]:bg-hover';

export function BlockHandle({
  editor,
  ctx,
  blockUrl,
}: {
  editor: Editor;
  ctx: CommandContext;
  blockUrl: (id: string) => string;
}) {
  const t = useTranslations('editor');
  const [target, setTarget] = useState<{ node: PMNode; pos: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const selectInside = () => {
    if (!target) return;
    const inside = Math.min(target.pos + 1, editor.state.doc.content.size);
    editor.chain().focus().setTextSelection(inside).run();
  };

  const remove = () =>
    target &&
    editor
      .chain()
      .focus()
      .deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize })
      .run();
  const duplicate = () =>
    target &&
    editor
      .chain()
      .focus()
      .insertContentAt(
        target.pos + target.node.nodeSize,
        stripIds(target.node.toJSON() as JSONContent),
      )
      .run();
  const copyLink = async () => {
    const id = target?.node.attrs.id as string | undefined;
    if (!id) return;
    await navigator.clipboard.writeText(blockUrl(id));
    toast.success(t('blockLinkCopied'));
  };
  const addBelow = (node: PMNode, pos: number) => {
    const at = pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(at, { type: 'paragraph' })
      .command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, at + 1));
        return true;
      })
      .insertContent('/')
      .focus()
      .run();
  };

  if (!editor.isEditable) return null;

  return (
    <DragHandle
      editor={editor}
      onNodeChange={({ node, pos }) => {
        if (!menuOpen) setTarget(node ? { node, pos } : null);
      }}
      className="jt-drag-handle"
    >
      <div className="flex items-center" data-testid="block-handle">
        <button
          type="button"
          aria-label={t('addBelow')}
          title={t('addBelow')}
          onClick={() => target && addBelow(target.node, target.pos)}
          className="flex size-6 items-center justify-center rounded-[4px] text-fg-subtle hover:bg-hover"
        >
          <Plus className="size-4" />
        </button>
        <Menu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) editor.commands.lockDragHandle?.();
            else editor.commands.unlockDragHandle?.();
          }}
        >
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t('blockMenu')}
              title={t('dragHint')}
              className="flex h-6 w-[18px] cursor-grab items-center justify-center rounded-[4px] text-fg-subtle hover:bg-hover active:cursor-grabbing"
              data-testid="block-menu-trigger"
            >
              <GripVertical className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent side="left" align="start" className="w-[240px]">
            <MenuItem icon={Trash2} onSelect={remove} shortcut="Entf">
              {t('delete')}
            </MenuItem>
            <MenuItem icon={Copy} onSelect={duplicate} shortcut="Strg+D">
              {t('duplicate')}
            </MenuItem>
            <M.Sub>
              <M.SubTrigger className={subTriggerClass}>
                <Repeat2 className="size-4 opacity-80" />
                <span className="flex-1">{t('turnInto')}</span>
              </M.SubTrigger>
              <M.Portal>
                <M.SubContent
                  sideOffset={4}
                  className="z-50 max-h-[360px] w-[220px] overflow-y-auto rounded-lg bg-bg-elevated p-1 text-fg shadow-popover"
                >
                  {BLOCK_COMMANDS.filter((c) => c.turnInto).map((c) => (
                    <MenuItem
                      key={c.id}
                      icon={c.icon}
                      onSelect={() => {
                        selectInside();
                        void c.run(editor, null, ctx);
                      }}
                    >
                      {t(`commands.${c.id}.label`)}
                    </MenuItem>
                  ))}
                </M.SubContent>
              </M.Portal>
            </M.Sub>
            <M.Sub>
              <M.SubTrigger className={subTriggerClass}>
                <Palette className="size-4 opacity-80" />
                <span className="flex-1">{t('color')}</span>
              </M.SubTrigger>
              <M.Portal>
                <M.SubContent
                  sideOffset={4}
                  className="z-50 max-h-[360px] overflow-y-auto rounded-lg bg-bg-elevated text-fg shadow-popover"
                >
                  <ColorGrid
                    onText={(c) => {
                      selectInside();
                      editor
                        .chain()
                        .focus()
                        .setBlockColor(c === 'default' ? null : c)
                        .run();
                      setMenuOpen(false);
                    }}
                    onBackground={(c) => {
                      selectInside();
                      editor
                        .chain()
                        .focus()
                        .setBlockColor(c === 'default' ? null : `${c}_background`)
                        .run();
                      setMenuOpen(false);
                    }}
                  />
                </M.SubContent>
              </M.Portal>
            </M.Sub>
            <MenuSeparator />
            <MenuItem
              icon={Link2}
              onSelect={() => void copyLink()}
              disabled={!target?.node.attrs.id}
            >
              {t('copyBlockLink')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </DragHandle>
  );
}
