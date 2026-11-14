/*
 * App-wide keyboard shortcuts for the document: Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves as,
 * Ctrl/Cmd+O opens a file. They replace the browser's own "save page" and "open file", which have
 * no use in this app.
 */
import { nextTick, onBeforeUnmount, onMounted } from 'vue';

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
 * A field that commits on blur (a title, notes, a link) holds text the document does not have yet.
 * Blurring it first makes "Save" save what is on screen; focus goes straight back.
 */
async function commitFocusedField(): Promise<void> {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
  active.blur();
  await nextTick();
  if (document.contains(active)) active.focus({ preventScroll: true });
  await nextTick();
}

/** Listens for the document shortcuts while the calling component is mounted. */
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
    await commitFocusedField();
    await (shortcut === 'save' ? doc.save() : doc.saveAs());
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
