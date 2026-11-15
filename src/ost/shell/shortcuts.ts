/*
 * App-wide keyboard shortcuts for the document: Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves as,
 * Ctrl/Cmd+O opens a file. They replace the browser's own "save page" and "open file", which have
 * no use in this app.
 *
 * Ctrl/Cmd+Z undoes the last change to the tree; Ctrl/Cmd+Shift+Z and Ctrl+Y redo it. Not while
 * the focus is in a text field: there the keys stay the browser's own undo of what was typed in
 * that field, and never also undo a tree edit.
 */
import { onBeforeUnmount, onMounted, watch } from 'vue';

import { useDocumentStore } from '@/doc/document.store';

import { useOstUiStore } from '../stores/ost-ui.store';

const isMac = (): boolean => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

/** "Ctrl+S" / "⌘S" — the shortcut as this platform writes it (shown next to the menu items). */
export function shortcutLabel(key: string, shift = false): string {
  return isMac() ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** The redo shortcut as this platform writes it: "Ctrl+Y" / "⇧⌘Z". */
export const redoShortcutLabel = (): string => (isMac() ? shortcutLabel('Z', true) : shortcutLabel('Y'));

export type DocumentShortcut = 'save' | 'saveAs' | 'open' | 'undo' | 'redo';

/** Which document shortcut a key press is, if any. */
export function matchShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): DocumentShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 's') return event.shiftKey ? 'saveAs' : 'save';
  if (key === 'o' && !event.shiftKey) return 'open';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  // Ctrl+Y only: with Cmd it is the browser's history on a Mac.
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}

/** Input types that hold no text: a tick box or a button has no undo of its own. */
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image']);

/** Is `target` somewhere text is typed (where undo / redo belong to the browser)? */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !NOT_TEXT.has((el as HTMLInputElement).type);
}

/**
 * Listens for the document shortcuts while the calling component is mounted.
 *
 * Text still being typed in a field is the document store's business: `request`, `save`, `saveAs`,
 * `undo` and `redo` each take it into the document first (doc/pending-edits.ts), whichever way they
 * are reached. Focus stays where it is.
 *
 * It also tells the history when a field is left: what is typed in one field, in one go, is one
 * step to undo, and leaving the field ends the step.
 */
export function useDocumentShortcuts() {
  const doc = useDocumentStore();
  const ui = useOstUiStore();

  async function onKeydown(event: KeyboardEvent) {
    const shortcut = matchShortcut(event);
    if (!shortcut) return;
    if (shortcut === 'undo' || shortcut === 'redo') {
      if (isTextEntry(event.target)) return;
      // Ours even when there is nothing to undo: the browser would otherwise reach into the text
      // field that was edited last and change it behind the user's back.
      event.preventDefault();
      // Not under a dialog (delete confirmation, unsaved changes): it is asking about the tree as it is.
      if (!doc.hasDocument || doc.pendingAction || ui.confirmId) return;
      await (shortcut === 'undo' ? doc.undo() : doc.redo());
      return;
    }
    // Always ours: the browser's own dialog for these keys must never open over the app.
    event.preventDefault();
    if (event.repeat || doc.pendingAction) return;
    if (shortcut === 'open') {
      await doc.request('open');
      return;
    }
    if (!doc.hasDocument) return;
    await (shortcut === 'save' ? doc.save() : doc.saveAs());
  }

  /** Runs after the field's own blur handler has committed what was typed (blur comes before focusout). */
  function onFocusOut(event: FocusEvent) {
    if (doc.hasDocument && isTextEntry(event.target)) doc.sealHistory();
  }
  // A rename on the canvas that ends with Enter or Escape takes its field away without a focusout.
  watch(
    () => ui.editingId,
    editing => {
      if (!editing && doc.hasDocument) doc.sealHistory();
    },
  );

  onMounted(() => {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('focusout', onFocusOut);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('focusout', onFocusOut);
  });
}
