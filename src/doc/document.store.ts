import { computed, markRaw, ref, shallowRef } from 'vue';

import { defineStore } from 'pinia';

import { useOstTreeStore } from '@/ost/stores/ost-tree.store';

import { type AutosaveRecord, type AutosaveStore, defaultAutosave } from './autosave';
import {
  DocumentFormatError,
  type OstDocument,
  emptyDocument,
  fileNameFor,
  parseDocument,
  serializeDocument,
  validateDocument,
} from './document';
import { FileTooLargeError, downloadFile, pickFileToOpen, pickFileToSave, supportsFileHandles, writeToHandle } from './file-access';
import LocalDocumentService from './local-document-service';
import { sampleDocument } from './sample';

/** How long after the last change the working document is written to the browser's storage. */
export const AUTOSAVE_DELAY_MS = 400;

/** Something that replaces the open document, and so needs a warning when there are unsaved changes. */
export type ReplaceAction = 'new' | 'open' | 'example';

/**
 * The document on screen: its name, whether it has changes not yet saved to a file, the file it
 * came from, and New / Open / Save / Save as. It owns the local document service the tree store
 * works against, and keeps a copy of the working document in the browser (autosave) so a refresh
 * or a crash loses nothing.
 */
export const useDocumentStore = defineStore('document', () => {
  const tree = useOstTreeStore();
  const service = markRaw(new LocalDocumentService());
  tree.setServiceFactory(() => service);

  let autosave: AutosaveStore = defaultAutosave();
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingWrite: Promise<void> = Promise.resolve();

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

  /** Save writes straight back to the opened file (Chromium); otherwise it downloads a copy. */
  const savesInPlace = computed(() => handle.value !== null);

  // ---- autosave --------------------------------------------------------------------------------
  function writeAutosave(): Promise<void> {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const doc = service.snapshot();
    const record = doc ? { doc, dirty: dirty.value, fileName: fileName.value, handle: handle.value, savedAt: lastSavedAt.value } : null;
    // One write at a time, in order; a failed write (storage full or blocked) never breaks editing,
    // but it is not silent: `autosaveFailed` tells the user to save a file.
    pendingWrite = pendingWrite
      .then(() => {
        const store = autosave;
        return (record ? store.save(record) : store.clear()).then(() => store.persistent !== false);
      })
      .then(
        kept => void (autosaveFailed.value = !kept),
        () => void (autosaveFailed.value = true),
      );
    return pendingWrite;
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void writeAutosave(), AUTOSAVE_DELAY_MS);
  }

  /** Writes a pending autosave now (the page is being hidden or closed). */
  function flushAutosave(): Promise<void> {
    return autosaveTimer ? writeAutosave() : pendingWrite;
  }

  service.onChange(() => {
    dirty.value = true;
    name.value = service.name;
    scheduleAutosave();
  });

  // ---- helpers -----------------------------------------------------------------------------------
  /** Makes `doc` the document on screen. */
  async function show(
    doc: OstDocument,
    origin: {
      fileName?: string | null;
      handle?: FileSystemFileHandle | null;
      dirty?: boolean;
      savedAt?: string | null;
      restored?: boolean;
    } = {},
  ) {
    service.open(doc);
    name.value = service.name;
    dirty.value = origin.dirty ?? false;
    fileName.value = origin.fileName ?? null;
    handle.value = origin.handle ? markRaw(origin.handle) : null;
    lastSavedAt.value = origin.savedAt ?? null;
    hasDocument.value = true;
    error.value = null;
    await tree.loadTree({ keepCollapsed: origin.restored === true });
    session.value += 1;
    if (!origin.restored) await writeAutosave();
  }

  function markSaved(savedTo: string, savedHandle: FileSystemFileHandle | null) {
    dirty.value = false;
    fileName.value = savedTo;
    handle.value = savedHandle ? markRaw(savedHandle) : null;
    lastSavedAt.value = new Date().toISOString();
    void writeAutosave();
  }

  const describe = (err: unknown, fallback: string): string =>
    err instanceof DocumentFormatError || err instanceof FileTooLargeError ? err.message : fallback;

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

  /** Restores the document this browser was working on, if there is one. Call once at start-up. */
  async function init() {
    let record: AutosaveRecord | null = null;
    try {
      record = await autosave.load();
    } catch {
      // Blocked storage: start from the empty state, and say that autosave is off.
      autosaveFailed.value = true;
    }
    try {
      if (record) {
        await show(validateDocument(record.doc), {
          fileName: record.fileName,
          handle: record.handle,
          dirty: record.dirty === true,
          savedAt: record.savedAt,
          restored: true,
        });
      }
    } catch {
      // A damaged autosave: start from the empty state rather than fail to start.
    } finally {
      ready.value = true;
    }
  }

  // ---- actions: replace the document (New / Open file / Load example) ----------------------------
  /** Starts a replace action; with unsaved changes it first waits for `resolvePending`. */
  async function request(action: ReplaceAction) {
    if (hasDocument.value && dirty.value) {
      pendingAction.value = action;
      return;
    }
    await perform(action);
  }

  /**
   * The user's answer to "you have changes not saved to a file": `save` saves first and carries on
   * only when the save went through, `discard` carries on, `cancel` keeps the document as it is.
   */
  async function resolvePending(choice: 'save' | 'discard' | 'cancel') {
    const action = pendingAction.value;
    pendingAction.value = null;
    if (!action || choice === 'cancel') return;
    if (choice === 'save' && !(await save())) return;
    await perform(action);
  }

  async function perform(action: ReplaceAction) {
    if (action === 'new') await newDocument();
    else if (action === 'example') await show(sampleDocument());
    else await openFile();
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

  /** "Open file": the user chooses a `.ost` file from their computer. False when nothing was opened. */
  async function openFile(): Promise<boolean> {
    try {
      const opened = await pickFileToOpen();
      if (!opened) return false;
      await show(parseDocument(opened.text), { fileName: opened.fileName, handle: opened.handle });
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
   * "Save as". True when the document reached a file.
   */
  async function save(): Promise<boolean> {
    const doc = service.snapshot();
    if (!doc) return false;
    if (!handle.value) return saveAs();
    try {
      await writeToHandle(handle.value, serializeDocument(doc));
      markSaved(fileName.value ?? handle.value.name, handle.value);
      return true;
    } catch {
      // The file moved, or permission was not given: ask where to save instead.
      return saveAs();
    }
  }

  /** "Save as": the user chooses where to save (or, without a save picker, a copy is downloaded). */
  async function saveAs(): Promise<boolean> {
    const doc = service.snapshot();
    if (!doc) return false;
    const text = serializeDocument(doc);
    const suggested = fileNameFor(doc.name);
    try {
      if (supportsFileHandles()) {
        const saved = await pickFileToSave(suggested, text);
        if (!saved) return false;
        markSaved(saved.name, saved);
      } else {
        downloadFile(suggested, text);
        markSaved(suggested, null);
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

  return {
    // state
    ready,
    hasDocument,
    name,
    dirty,
    fileName,
    lastSavedAt,
    autosaveFailed,
    error,
    pendingAction,
    session,
    savesInPlace,
    // the document itself (read it with `service.snapshot()`)
    service,
    // actions
    setAutosaveStore,
    clearError,
    reportError,
    init,
    request,
    resolvePending,
    openFile,
    save,
    saveAs,
    rename,
    flushAutosave,
  };
});
