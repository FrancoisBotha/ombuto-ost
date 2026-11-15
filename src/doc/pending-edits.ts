/*
 * Text being typed that the document does not have yet.
 *
 * A text field keeps a draft while the user types. The draft reaches the document a moment after
 * the last key press (`useLiveCommit`), and at once whenever the document is about to be read or
 * replaced: Save, New / Open / Open example, the autosave before the page is hidden or closed.
 * `flushPendingEdits()` is that "at once": the document store calls it at every one of those
 * points, so no caller has to remember which field has the focus.
 *
 * A flush is synchronous all the way into the document: the tree store applies an edit, and the
 * local document service takes it, before either one first awaits.
 */
import { onBeforeUnmount } from 'vue';

/** How long after the last key press a draft is written into the document. */
export const LIVE_COMMIT_DELAY_MS = 300;

const flushers = new Set<() => void>();

/** Registers a field's "commit what is typed, now". Returns the function that unregisters it. */
export function registerPendingEdit(flush: () => void): () => void {
  flushers.add(flush);
  return () => void flushers.delete(flush);
}

/** Commits every draft that is still waiting. One failing field never stops the others. */
export function flushPendingEdits(): void {
  for (const flush of [...flushers]) {
    try {
      flush();
    } catch {
      // The field keeps its draft; the rest still commit.
    }
  }
}

/**
 * For a text field of a component: `touch()` on every input schedules `commit` a moment later,
 * `flush()` commits now if a commit is waiting, `cancel()` drops the waiting commit (Escape, or a
 * blur handler that commits by itself). A commit still waiting when the field goes away is made.
 */
export function useLiveCommit(commit: () => void, delay = LIVE_COMMIT_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function flush() {
    if (timer === null) return;
    cancel();
    commit();
  }
  function touch() {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      commit();
    }, delay);
  }

  const unregister = registerPendingEdit(flush);
  onBeforeUnmount(() => {
    flush();
    unregister();
  });

  return { touch, flush, cancel };
}
