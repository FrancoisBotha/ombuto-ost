/*
 * Reading and writing `.ost` files on the user's own disk. Nothing here talks to a network.
 *
 * - Chromium has the File System Access API: "Open file" hands back a file handle, so "Save" writes
 *   to that same file again.
 * - Firefox and Safari do not: "Open file" is an ordinary file input and "Save" downloads a copy.
 */
import { FILE_EXTENSION, FILE_MIME, MAX_FILE_BYTES } from './document';

/** The parts of the File System Access API this app uses (not yet in TypeScript's DOM library). */
interface PickerWindow {
  showOpenFilePicker(options?: object): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: object): Promise<FileSystemFileHandle>;
}

interface PermissionHandle {
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface OpenedFile {
  text: string;
  fileName: string;
  /** Present only where the browser can write back to the same file. */
  handle: FileSystemFileHandle | null;
}

/** The file is too large to be a tree; nothing was read. */
export class FileTooLargeError extends Error {
  constructor() {
    super('That file is too large to be an Ombuto OST tree.');
    this.name = 'FileTooLargeError';
  }
}

const PICKER_TYPES = [{ description: 'Ombuto OST tree', accept: { [FILE_MIME]: [FILE_EXTENSION] } }];

const pickerWindow = (): PickerWindow | null => {
  const w = globalThis as unknown as Partial<PickerWindow>;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function' ? (w as PickerWindow) : null;
};

/** Can this browser save back to the file it opened? */
export const supportsFileHandles = (): boolean => pickerWindow() !== null;

/** The user closed a picker without choosing: not an error. */
const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

async function readFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();
  return file.text();
}

/** Classic file input, for browsers without the File System Access API. Resolves null on cancel. */
function pickWithInput(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},${FILE_MIME}`;
    input.style.display = 'none';
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** "Open file": lets the user choose a file and reads it. Resolves null when they cancel. */
export async function pickFileToOpen(): Promise<OpenedFile | null> {
  const picker = pickerWindow();
  if (!picker) {
    const file = await pickWithInput();
    return file ? { text: await readFile(file), fileName: file.name, handle: null } : null;
  }
  let handle: FileSystemFileHandle;
  try {
    [handle] = await picker.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
  const file = await handle.getFile();
  return { text: await readFile(file), fileName: file.name, handle };
}

/** Writes to a file the user opened or chose before. May ask for permission again after a reload. */
export async function writeToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const access = handle as FileSystemFileHandle & PermissionHandle;
  if (access.queryPermission && (await access.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const answer = access.requestPermission ? await access.requestPermission({ mode: 'readwrite' }) : 'denied';
    if (answer !== 'granted') throw new DOMException('Permission to write the file was not given.', 'NotAllowedError');
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

/**
 * "Save as" where the browser has a save picker: the user chooses a place, the file is written, and
 * the handle is returned for later saves. Resolves null when they cancel.
 */
export async function pickFileToSave(suggestedName: string, text: string): Promise<FileSystemFileHandle | null> {
  const picker = pickerWindow();
  if (!picker) return null;
  let handle: FileSystemFileHandle;
  try {
    handle = await picker.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
  await writeToHandle(handle, text);
  return handle;
}

/**
 * Saves a file to the user's computer through the browser's download (no file handle to keep).
 * Also what an export uses: pass the content (text or a Blob) and its media type.
 */
export function downloadFile(fileName: string, content: string | Blob, type: string = FILE_MIME): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the object URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
