'use client';

import { blockRangeByIndex } from '@jotion/editor';
import type { Editor } from '@tiptap/react';
import { useEffect } from 'react';

const START_THRESHOLD = 5;
const SCROLL_EDGE = 40;

/**
 * Rechteckauswahl mit der Maus (wie bei Notion): Ziehen im Seitenrand oder auf freier Fläche
 * markiert alle berührten Blöcke der obersten Ebene. Danach wirken Entf, Strg+C/X wie bei Text.
 */
export function BlockSelectionLayer({ editor }: { editor: Editor }) {
  useEffect(() => {
    const view = editor.view;
    const area = view.dom.closest<HTMLElement>('[data-editor-area]');
    if (!area) return;
    const scroller = area.closest<HTMLElement>('main') ?? document.documentElement;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !editor.isEditable) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, button, a, [role="button"], [data-no-block-select]'))
        return;
      // Im Text selbst bleibt die normale Textauswahl; Start nur außerhalb der Blöcke
      const insideBlock = target !== view.dom && view.dom.contains(target);
      if (insideBlock) return;
      if (target.closest('.jt-drag-handle')) return;

      const startX = e.clientX;
      const startY = e.clientY + scroller.scrollTop;
      let rect: HTMLDivElement | null = null;
      let lastY = e.clientY;
      let lastX = e.clientX;
      let frame = 0;

      const update = () => {
        const top = Math.min(startY, lastY + scroller.scrollTop) - scroller.scrollTop;
        const bottom = Math.max(startY, lastY + scroller.scrollTop) - scroller.scrollTop;
        const left = Math.min(startX, lastX);
        const right = Math.max(startX, lastX);
        if (rect) {
          rect.style.left = `${left}px`;
          rect.style.top = `${top}px`;
          rect.style.width = `${right - left}px`;
          rect.style.height = `${bottom - top}px`;
        }
        const hits: number[] = [];
        let pos = 0;
        view.state.doc.forEach((node, offset, index) => {
          pos = offset;
          const dom = view.nodeDOM(pos) as HTMLElement | null;
          if (!dom?.getBoundingClientRect) return;
          const r = dom.getBoundingClientRect();
          if (r.bottom >= top && r.top <= bottom && r.right >= left && r.left <= right)
            hits.push(index);
          void node;
        });
        if (hits.length) {
          const sel = blockRangeByIndex(view.state.doc, hits[0]!, hits[hits.length - 1]!);
          if (sel && !sel.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(sel));
        }
      };

      const autoScroll = () => {
        if (!rect) return;
        const box = scroller.getBoundingClientRect();
        if (lastY < box.top + SCROLL_EDGE) scroller.scrollTop -= 12;
        else if (lastY > box.bottom - SCROLL_EDGE) scroller.scrollTop += 12;
        update();
        frame = requestAnimationFrame(autoScroll);
      };

      const move = (ev: PointerEvent) => {
        lastX = ev.clientX;
        lastY = ev.clientY;
        if (!rect) {
          if (
            Math.hypot(lastX - startX, ev.clientY + scroller.scrollTop - startY) < START_THRESHOLD
          )
            return;
          rect = document.createElement('div');
          rect.className = 'jt-select-rect';
          rect.setAttribute('data-testid', 'select-rect');
          document.body.appendChild(rect);
          document.body.classList.add('jt-selecting');
          window.getSelection()?.removeAllRanges();
          frame = requestAnimationFrame(autoScroll);
        }
        ev.preventDefault();
        update();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        cancelAnimationFrame(frame);
        if (rect) {
          rect.remove();
          document.body.classList.remove('jt-selecting');
          // Tastatur (Entf, Strg+C) geht an den Editor
          view.focus();
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    area.addEventListener('pointerdown', onDown);
    return () => area.removeEventListener('pointerdown', onDown);
  }, [editor]);

  return null;
}
