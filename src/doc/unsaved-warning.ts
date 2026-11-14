/*
 * Leaving the page: the browser asks before closing a tab that has changes not saved to a file,
 * and a pending autosave is written when the page is hidden (a mobile browser may never fire
 * `beforeunload`, and a hidden tab can be discarded without notice).
 */
import { onBeforeUnmount, onMounted } from 'vue';

import { useDocumentStore } from './document.store';

export function useUnsavedWarning() {
  const doc = useDocumentStore();

  function onBeforeUnload(event: BeforeUnloadEvent) {
    void doc.flushAutosave();
    if (!doc.hasDocument || !doc.dirty) return;
    // The browser shows its own wording; both lines are needed across browsers.
    event.preventDefault();
    event.returnValue = '';
  }

  function onPageHide() {
    void doc.flushAutosave();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') void doc.flushAutosave();
  }

  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
}
