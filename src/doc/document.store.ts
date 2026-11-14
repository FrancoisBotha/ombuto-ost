import { computed, markRaw, ref, shallowRef } from 'vue';

import { defineStore } from 'pinia';

import { useOstTreeStore } from '@/ost/stores/ost-tree.store';
import { COLLAPSED_STORAGE_KEY, useOstUiStore } from '@/ost/stores/ost-ui.store';

import { type AutosaveRecord, type AutosaveStore, MIGRATED_SLOT_ID, defaultAutosave } from './autosave';
import { slotCollapsedKey } from './autosave-slots';
import {
  DocumentFormatError,
  type OstDocument,
  emptyDocument,
  fileNameFor,
  parseDocument,
  serializeDocument,
  validateDocument,
} from './document';
import {
  FileChangedError,
  FileTooLargeError,
  downloadFile,
  fileStamp,
  pickFileToOpen,
  pickFileToSave,
  supportsFileHandles,
  writeToHandle,
} from './file-access';
import LocalDocumentService, { readTree } from './local-document-service';
import { flushPendingEdits } from './pending-edits';
import { sampleDocument } from './sample';

/** How long after the last change the working document is written to the browser's storage. */
export const AUTOSAVE_DELAY_MS = 400;

/** Something that replaces the open document, and so needs a warning when there are unsaved changes. */
export type ReplaceAction = 'new' | 'open' | 'example';

/** How the last save reached the computer (see AutosaveRecord.savedBy). */
export type SavedBy = 'file' | 'download';

/** A working copy found in this browser that could not be read. It is kept until the user decides. */
export interface UnreadableCopy {
  /** Names the stored copy (for deleting it); null when it is no longer in storage. */
  id: string | null;
  /** Its raw contents as text, to save to a file. */
  text: string;
}

const RECOVERED_FILE_NAME = 'Ombuto OST recovered working copy.json';

/**
 * The document on screen: its name, whether it has changes not yet saved to a file, the file it
 * came from, and New / Open / Save / Save as. It owns the local document service the tree store
 * works against, and keeps a copy of the working document in the browser (autosave) so a reload,
 * a closed tab or a crash does not lose the tree.
 *
 * Two rules run through everything here. A document replaces the one on screen only after it has
 * been loaded completely, so a file that cannot be shown leaves the open tree untouched. And text
 * still being typed in a field is taken into the document (`flushPendingEdits`) before the
 * document is saved, autosaved for the last time, or replaced.
 */
export const useDocumentStore = defineStore('document', () => {
  const tree = useOstTreeStore();
  const service = markRaw(new LocalDocumentService());
  tree.setServiceFactory(() => service);

  let autosave: AutosaveStore = defaultAutosave();
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The autosave writes, one after another; resolves to whether the last one was kept. */
  let pendingWrite: Promise<boolean> = Promise.resolve(true);
  /** Goes up with every change to the document, and when another document is shown. */
  let revision = 0;
  /** The revision the browser's storage is known to hold. */
  let autosavedRevision = -1;
  /** The revision for which leaving the page was cleared (the update reload, see `clearToReload`). */
  let reloadClearedAt = -1;
  /** The opened file as this tab last saw it on disk (see `fileStamp`). */
  let stamp: string | null = null;

  // ---- state -----------------------------------------------------------------------------------
  /** False until the autosaved document (if any) has been looked for. */
  const ready = ref(false);
  const hasDocument = ref(false);
  const name = ref('');
  /** Changes not yet saved to a file (they are still kept in this browser). */
  const dirty = ref(false);
  /** The file this document was opened from or last saved to. */
  const fileName = ref<string | null>(null);
  const handle = shallowRef<FileSystemFileHandle | null>(null);
  /** ISO time of the last save to a file. */
  const lastSavedAt = ref<string | null>(null);
  /** How that save was made; a download is a copy the app cannot confirm arrived. */
  const savedBy = ref<SavedBy | null>(null);
  /**
   * Autosave is off: the working copy cannot be kept in this browser (its storage is full, blocked
   * or missing), so only a saved file is safe. Follows every write: it clears when one goes through.
   */
  const autosaveFailed = ref(autosave.persistent === false);
  /** A file action that failed, in words for the user; cleared by clearError(). */
  const error = ref<string | null>(null);
  /** Counts the documents shown: a new value means another document is on screen (the canvas starts afresh). */
  const session = ref(0);
  /** A replace action waiting for the user to decide about unsaved changes. */
  const pendingAction = ref<ReplaceAction | null>(null);
  /**
   * The pending action's "Save" downloaded a copy (no save picker in this browser). The app cannot
   * see whether that download arrived, so the action waits for the user to say carry on.
   */
  const pendingDownloaded = ref(false);
  /** A working copy from an earlier visit that could not be read (start-up). */
  const unreadable = ref<UnreadableCopy | null>(null);

  /** Save writes straight back to the opened file (Chromium); otherwise it downloads a copy. */
  const savesInPlace = computed(() => handle.value !== null);

  // ---- autosave --------------------------------------------------------------------------------
  function writeAutosave(): Promise<boolean> {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const doc = service.snapshot();
    const written = revision;
    const record: AutosaveRecord | null = doc
      ? {
          doc,
          dirty: dirty.value,
          fileName: fileName.value,
          handle: handle.value,
          savedAt: lastSavedAt.value,
          savedBy: savedBy.value,
          fileStamp: stamp,
        }
      : null;
    // One write at a time, in order; a failed write (storage full or blocked) never breaks editing,
    // but it is not silent: `autosaveFailed` tells the user to save a file.
    pendingWrite = pendingWrite
      .then(() => {
        const store = autosave;
        return (record ? store.save(record) : store.clear()).then(() => store.persistent !== false);
      })
      .then(
        kept => kept,
        () => false,
      )
      .then(kept => {
        autosaveFailed.value = !kept;
        if (kept) autosavedRevision = Math.max(autosavedRevision, written);
        return kept;
      });
    return pendingWrite;
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void writeAutosave(), AUTOSAVE_DELAY_MS);
  }

  /**
   * Takes whatever is still being typed into the document and writes a pending autosave now (the
   * page is being hidden, closed or reloaded). Resolves true only when the browser's storage is
   * known to hold the document exactly as it is on screen.
   */
  async function flushAutosave(): Promise<boolean> {
    flushPendingEdits();
    const kept = await (autosaveTimer ? writeAutosave() : pendingWrite);
    return kept && autosavedRevision === revision;
  }

  service.onChange(() => {
    revision += 1;
    dirty.value = true;
    name.value = service.name;
    scheduleAutosave();
  });

  /** Each tab keeps the collapsed branches of its own working copy. */
  function followSlot() {
    const slot = autosave.slotId?.() ?? null;
    useOstUiStore().useCollapsedKey(slot ? slotCollapsedKey(slot) : COLLAPSED_STORAGE_KEY, slot === MIGRATED_SLOT_ID);
  }

  // ---- helpers -----------------------------------------------------------------------------------
  /**
   * Makes `doc` the document on screen. Everything that can fail happens before anything is
   * replaced: when this throws, the document that was open is still open, untouched, and nothing
   * was autosaved.
   */
  async function show(
    doc: OstDocument,
    origin: {
      fileName?: string | null;
      handle?: FileSystemFileHandle | null;
      dirty?: boolean;
      savedAt?: string | null;
      savedBy?: SavedBy | null;
      stamp?: string | null;
      restored?: boolean;
    } = {},
  ) {
    let nodes;
    try {
      nodes = tree.prepare(readTree(doc));
    } catch {
      throw new DocumentFormatError('This file cannot be opened: its tree could not be laid out.');
    }
    // From here on nothing can fail.
    service.open(doc);
    tree.install(nodes, { keepCollapsed: origin.restored === true });
    revision += 1;
    name.value = service.name;
    dirty.value = origin.dirty ?? false;
    fileName.value = origin.fileName ?? null;
    handle.value = origin.handle ? markRaw(origin.handle) : null;
    lastSavedAt.value = origin.savedAt ?? null;
    savedBy.value = origin.savedBy ?? (origin.fileName ? 'file' : null);
    stamp = origin.stamp ?? null;
    hasDocument.value = true;
    error.value = null;
    session.value += 1;
    if (origin.restored) autosavedRevision = revision;
    else await writeAutosave();
  }

  /**
   * Records a save that has just finished. `saved` is the document as it was when the save started:
   * an edit made while the picker was open or the file was being written is not in the file, so the
   * document stays unsaved; and when another document was opened meanwhile, nothing is recorded.
   */
  function markSaved(saved: { revision: number; session: number }, savedTo: string, savedHandle: FileSystemFileHandle | null, by: SavedBy) {
    if (saved.session !== session.value) return;
    if (saved.revision === revision) dirty.value = false;
    fileName.value = savedTo;
    handle.value = savedHandle ? markRaw(savedHandle) : null;
    lastSavedAt.value = new Date().toISOString();
    savedBy.value = by;
    void writeAutosave();
  }

  const describe = (err: unknown, fallback: string): string =>
    err instanceof DocumentFormatError || err instanceof FileTooLargeError ? err.message : fallback;

  /** The raw contents of a stored working copy, as text a person (or a tool) can read. */
  function rawText(value: unknown): string {
    try {
      return `${JSON.stringify(value, null, 2)}\n`;
    } catch {
      return String(value);
    }
  }

  // ---- actions: lifecycle ----------------------------------------------------------------------
  /** Test seam: where the working document is kept between visits. */
  function setAutosaveStore(store: AutosaveStore) {
    autosave = store;
    autosaveFailed.value = store.persistent === false;
  }

  function clearError() {
    error.value = null;
  }

  /** Shows a message about a failed file action (the export menu reports through this too). */
  function reportError(message: string) {
    error.value = message;
  }

  /** Restores the document this tab was working on, or one a closed tab left behind. Call once at start-up. */
  async function init() {
    let record: AutosaveRecord | null = null;
    try {
      record = await autosave.load();
    } catch {
      // Blocked storage: start from the empty state, and say that autosave is off.
      autosaveFailed.value = true;
    }
    followSlot();
    try {
      if (record) {
        await show(validateDocument(record.doc), {
          fileName: record.fileName,
          handle: record.handle,
          dirty: record.dirty === true,
          savedAt: record.savedAt,
          savedBy: record.savedBy ?? null,
          stamp: record.fileStamp ?? null,
          restored: true,
        });
      }
    } catch {
      // A working copy that cannot be read. It is somebody's work: it is never deleted or written
      // over here. It is set aside (this tab continues in a fresh copy) and the user is told, with
      // the choice to save its contents to a file.
      let id: string | null = null;
      try {
        id = (await autosave.setAside?.()) ?? null;
      } catch {
        // storage stopped answering: the copy stays where it is
      }
      followSlot();
      unreadable.value = { id, text: rawText(record?.doc) };
    } finally {
      ready.value = true;
    }
  }

  /** Saves the contents of the unreadable working copy to the user's computer, exactly as stored. */
  function saveUnreadable() {
    if (unreadable.value) downloadFile(RECOVERED_FILE_NAME, unreadable.value.text);
  }

  /** Deletes the unreadable working copy (the user asked) and stops mentioning it. */
  async function discardUnreadable() {
    const copy = unreadable.value;
    unreadable.value = null;
    try {
      if (copy?.id) await autosave.discard?.(copy.id);
    } catch {
      // It stays in storage; it will be offered again.
    }
  }

  // ---- actions: replace the document (New / Open file / Load example) ----------------------------
  /** Starts a replace action; with unsaved changes it first waits for `resolvePending`. */
  async function request(action: ReplaceAction) {
    // Text still in a field counts: it is a change, and it must not vanish with the document.
    flushPendingEdits();
    if (hasDocument.value && dirty.value) {
      pendingDownloaded.value = false;
      pendingAction.value = action;
      return;
    }
    await perform(action);
  }

  /**
   * The user's answer to "you have changes not saved to a file": `save` saves first and carries on
   * only when the save went through, `discard` carries on, `cancel` keeps the document as it is.
   *
   * Where "Save" can only download a copy, the app cannot see whether the download arrived, so the
   * action stays pending (`pendingDownloaded`) until the user answers again: `discard` then means
   * "carry on", with the copy in their downloads.
   */
  async function resolvePending(choice: 'save' | 'discard' | 'cancel') {
    const action = pendingAction.value;
    if (!action) return;
    if (choice === 'save') {
      if (!(await save())) return void (pendingAction.value = null);
      if (savedBy.value === 'download') return void (pendingDownloaded.value = true);
    }
    pendingAction.value = null;
    pendingDownloaded.value = false;
    if (choice === 'cancel') return;
    await perform(action);
  }

  async function perform(action: ReplaceAction) {
    if (action === 'open') return void (await openFile());
    try {
      if (action === 'new') await newDocument();
      else await show(sampleDocument());
    } catch (err) {
      error.value = describe(err, 'The tree could not be started.');
    }
  }

  /** A new tree: one product, ready to be named. */
  async function newDocument() {
    await show(emptyDocument());
    const created = await tree.createProduct();
    // Creating the first product is part of "New", not a change the user has to save or lose.
    if (created) {
      dirty.value = false;
      await writeAutosave();
    }
  }

  /**
   * "Open file": the user chooses a `.ost` file from their computer. False when nothing was opened;
   * the document that was open is then still open.
   */
  async function openFile(): Promise<boolean> {
    try {
      const opened = await pickFileToOpen();
      if (!opened) return false;
      await show(parseDocument(opened.text), { fileName: opened.fileName, handle: opened.handle, stamp: opened.stamp ?? null });
      return true;
    } catch (err) {
      // A picker may only open straight after a click or key press; after a save dialog that moment has passed.
      const needsGesture = err instanceof DOMException && err.name === 'SecurityError';
      error.value = needsGesture ? 'Choose “Open file” again to pick the file.' : describe(err, 'That file could not be opened.');
      return false;
    }
  }

  // ---- actions: save ---------------------------------------------------------------------------
  /**
   * "Save": writes back to the opened file where the browser allows it; otherwise the same as
   * "Save as". True when the document was written to a file, or handed to the browser's downloads.
   */
  async function save(): Promise<boolean> {
    flushPendingEdits();
    const doc = service.snapshot();
    if (!doc) return false;
    const target = handle.value;
    if (!target) return saveAs();
    const saved = { revision, session: session.value };
    try {
      await writeToHandle(target, serializeDocument(doc), stamp);
    } catch (err) {
      if (err instanceof FileChangedError) {
        error.value = `“${fileName.value ?? target.name}” was changed outside this tab since it was opened or last saved here, so it was not overwritten. Choose where to save this version.`;
      }
      // Otherwise the file moved, or permission was not given. Either way: ask where to save instead.
      return saveAs();
    }
    const written = await fileStamp(target);
    if (saved.session === session.value) stamp = written;
    markSaved(saved, fileName.value ?? target.name, target, 'file');
    return true;
  }

  /** "Save as": the user chooses where to save (or, without a save picker, a copy is downloaded). */
  async function saveAs(): Promise<boolean> {
    flushPendingEdits();
    const doc = service.snapshot();
    if (!doc) return false;
    const text = serializeDocument(doc);
    const suggested = fileNameFor(doc.name);
    const saved = { revision, session: session.value };
    try {
      if (supportsFileHandles()) {
        const target = await pickFileToSave(suggested, text);
        if (!target) return false;
        const written = await fileStamp(target);
        if (saved.session === session.value) stamp = written;
        markSaved(saved, target.name, target, 'file');
      } else {
        // The browser takes it from here. Whether the download is kept, blocked or cancelled is
        // not something a page can see, so this is recorded as a download, not as a saved file.
        downloadFile(suggested, text);
        if (saved.session === session.value) stamp = null;
        markSaved(saved, suggested, null, 'download');
      }
      return true;
    } catch {
      error.value = 'The tree could not be saved to your computer.';
      return false;
    }
  }

  /** Renames the document (the name is part of the file, so this is a change to save). */
  function rename(next: string) {
    if (hasDocument.value) name.value = service.rename(next);
  }

  // ---- leaving the page ------------------------------------------------------------------------
  /**
   * Call after `flushAutosave()` resolved true, just before reloading for a new version of the app:
   * the tree as it is now is in the browser's storage and comes back after the reload, so the
   * browser need not ask. Any later edit withdraws this.
   */
  function clearToReload() {
    reloadClearedAt = revision;
  }

  /** Should the browser ask before this page is closed or reloaded? */
  function warnsBeforeLeaving(): boolean {
    return hasDocument.value && dirty.value && reloadClearedAt !== revision;
  }

  return {
    // state
    ready,
    hasDocument,
    name,
    dirty,
    fileName,
    lastSavedAt,
    savedBy,
    autosaveFailed,
    error,
    pendingAction,
    pendingDownloaded,
    unreadable,
    session,
    savesInPlace,
    // the document itself (read it with `service.snapshot()`)
    service,
    // actions
    setAutosaveStore,
    clearError,
    reportError,
    init,
    saveUnreadable,
    discardUnreadable,
    request,
    resolvePending,
    openFile,
    save,
    saveAs,
    rename,
    flushAutosave,
    clearToReload,
    warnsBeforeLeaving,
  };
});
