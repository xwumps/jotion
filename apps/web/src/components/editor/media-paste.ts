'use client';

import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api-client';
import { dataUrlToBlob, uploadFile } from '@/lib/upload';

const MAX_FILES_PER_PASTE = 20;
/** Uploads, die in diesem Tab laufen (verwaiste Kennungen nach Neuladen zeigen den Platzhalter) */
const activeUploads = new Set<string>();
export const isUploadActive = (id: unknown) => typeof id === 'string' && activeUploads.has(id);

/** Blocktyp für den Platzhalter (der Server entscheidet am Inhalt endgültig). */
function guessType(file: File): 'image' | 'video' | 'audio' | 'pdf' | 'file' {
  if (/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf') return 'pdf';
  return 'file';
}

function findUpload(doc: PMNode, uploadId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.uploadId === uploadId) found = { node, pos };
    return !found;
  });
  return found;
}

/** Lädt hoch und ersetzt den Platzhalter mit der Kennung uploadId durch den fertigen Block. */
async function finishUpload(
  editor: Editor,
  ws: string,
  uploadId: string,
  blob: Blob | Promise<Blob | null>,
  name?: string,
): Promise<void> {
  activeUploads.add(uploadId);
  try {
    const data = await blob;
    if (!data) throw new Error('unreadable');
    const res = await uploadFile(ws, data, name);
    if (editor.isDestroyed) return;
    const hit = findUpload(editor.state.doc, uploadId);
    if (!hit) return;
    const type = editor.schema.nodes[res.kind] ?? hit.node.type;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(hit.pos, type, {
        ...hit.node.attrs,
        src: res.url,
        name: res.name ?? name ?? null,
        size: res.size,
        mime: res.mime,
        uploadId: null,
        pendingData: null,
      }),
    );
  } catch (err) {
    if (editor.isDestroyed) return;
    toast.error(
      err instanceof Error && err.message === 'unreadable' ? 'Upload' : errorMessage(err),
    );
    const hit = findUpload(editor.state.doc, uploadId);
    // Platzhalter bleibt (zum erneuten Hochladen), nur die Kennung entfällt
    if (hit)
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, uploadId: null }),
      );
  } finally {
    activeUploads.delete(uploadId);
  }
}

/**
 * Dateien einfügen oder hineinziehen: Platzhalter sofort einfügen, im Hintergrund hochladen.
 * Bilder aus eingefügtem HTML (data:-URL) werden ebenfalls hochgeladen; die data:-URL landet
 * nie im Dokument.
 */
export function createMediaPaste(getWorkspaceId: () => string) {
  return Extension.create({
    name: 'jotionMediaPaste',
    addProseMirrorPlugins() {
      const editor = this.editor;
      const insertFiles = (files: File[], pos?: number) => {
        const list = files.slice(0, MAX_FILES_PER_PASTE);
        const nodes = list.map((file) => {
          const uploadId = crypto.randomUUID();
          const type = editor.schema.nodes[guessType(file)]!;
          activeUploads.add(uploadId);
          void Promise.resolve().then(() =>
            finishUpload(editor, getWorkspaceId(), uploadId, file, file.name),
          );
          return type.create({ uploadId, name: file.name.slice(0, 255) });
        });
        const tr = editor.state.tr;
        if (pos === undefined) tr.replaceSelectionWith(Fragment.from(nodes).firstChild!, false);
        if (pos === undefined && nodes.length > 1)
          tr.insert(tr.selection.to, Fragment.from(nodes.slice(1)));
        if (pos !== undefined) tr.insert(pos, Fragment.from(nodes));
        editor.view.dispatch(tr.scrollIntoView());
      };
      return [
        new Plugin({
          key: new PluginKey('jotion-media-paste'),
          // Endet Eingefügtes mit einem Block wie einem Bild, ist danach der Block markiert und
          // die nächste Eingabe würde ihn ersetzen. Stattdessen den Cursor dahinter setzen.
          appendTransaction: (trs, _old, state) => {
            if (!trs.some((tr) => tr.getMeta('uiEvent') === 'paste')) return null;
            const sel = state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.isInline) return null;
            const tr = state.tr;
            const next = TextSelection.findFrom(state.doc.resolve(sel.to), 1, true);
            if (next) return tr.setSelection(next);
            const paragraph = state.schema.nodes.paragraph;
            if (
              !paragraph ||
              !sel.$to.parent.canReplaceWith(sel.$to.index(), sel.$to.index(), paragraph)
            )
              return null;
            tr.insert(sel.to, paragraph.create());
            return tr.setSelection(TextSelection.create(tr.doc, sel.to + 1));
          },
          props: {
            handlePaste: (_view, event) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (!files.length || !editor.isEditable) return false;
              // Mit HTML (z. B. aus Office) übernimmt die normale Verarbeitung, Bilder darin als data:-URL
              if (
                event.clipboardData?.getData('text/html') &&
                files.every((f) => f.type.startsWith('image/'))
              )
                return false;
              insertFiles(files);
              return true;
            },
            handleDrop: (view, event, _slice, moved) => {
              if (moved || !editor.isEditable) return false;
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (!files.length) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!at) return false;
              event.preventDefault();
              const $pos = view.state.doc.resolve(at.pos);
              // Auf Blockgrenze einfügen
              const blockPos = $pos.depth > 0 ? $pos.after(1) : at.pos;
              insertFiles(files, Math.min(blockPos, view.state.doc.content.size));
              return true;
            },
            transformPasted: (slice) => {
              const pending: { uploadId: string; data: string }[] = [];
              const map = (fragment: Fragment): Fragment => {
                const out: PMNode[] = [];
                fragment.forEach((node) => {
                  if (
                    node.type.name === 'image' &&
                    typeof node.attrs.pendingData === 'string' &&
                    pending.length >= MAX_FILES_PER_PASTE
                  ) {
                    out.push(node.type.create({ ...node.attrs, pendingData: null }));
                  } else if (
                    node.type.name === 'image' &&
                    typeof node.attrs.pendingData === 'string'
                  ) {
                    const uploadId = crypto.randomUUID();
                    activeUploads.add(uploadId);
                    pending.push({ uploadId, data: node.attrs.pendingData });
                    out.push(node.type.create({ ...node.attrs, pendingData: null, uploadId }));
                  } else out.push(node.copy(map(node.content)));
                });
                return Fragment.from(out);
              };
              const content = map(slice.content);
              for (const p of pending)
                setTimeout(
                  () =>
                    void finishUpload(
                      editor,
                      getWorkspaceId(),
                      p.uploadId,
                      dataUrlToBlob(p.data),
                      'bild.png',
                    ),
                  0,
                );
              return pending.length ? new Slice(content, slice.openStart, slice.openEnd) : slice;
            },
          },
        }),
      ];
    },
  });
}
