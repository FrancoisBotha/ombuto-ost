/*
 * App-wide keyboard shortcuts for the document: Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves as,
 * Ctrl/Cmd+O opens a file. They replace the browser's own "save page" and "open file", which have
 * no use in this app.
 */
import { onBeforeUnmount, onMounted } from 'vue';

import { useDocumentStore } from '@/doc/document.store';

const isMac = (): boolean => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

/** "Ctrl+S" / "⌘S" — the shortcut as this platform writes it (shown next to the menu items). */
export function shortcutLabel(key: string, shift = false): string {
  return isMac() ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

export type DocumentShortcut = 'save' | 'saveAs' | 'open';

/** Which document shortcut a key press is, if any. */
export function matchShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): DocumentShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 's') return event.shiftKey ? 'saveAs' : 'save';
  if (key === 'o' && !event.shiftKey) return 'open';
  return null;
}

/**
 * Listens for the document shortcuts while the calling component is mounted.
 *
 * Text still being typed in a field is the document store's business: `request`, `save` and
 * `saveAs` each take it into the document first (doc/pending-edits.ts), whichever way they are
 * reached. Focus stays where it is.
 */
export function useDocumentShortcuts() {
  const doc = useDocumentStore();

  async function onKeydown(event: KeyboardEvent) {
    const shortcut = matchShortcut(event);
    if (!shortcut) return;
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

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
