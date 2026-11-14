import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryAutosave } from './autosave';
import { MAX_FILE_BYTES } from './document';
import { FileTooLargeError, downloadFile, pickFileToOpen, pickFileToSave, supportsFileHandles, writeToHandle } from './file-access';
import { sampleDocument } from './sample';

type Globals = typeof globalThis & { showOpenFilePicker?: unknown; showSaveFilePicker?: unknown };
const globals = globalThis as Globals;

const abort = () => new DOMException('The user aborted a request.', 'AbortError');

/** A file handle double that records what was written to it. */
function fakeHandle(name = 'tree.ost', permission: PermissionState = 'granted', afterRequest: PermissionState = 'granted') {
  const written: string[] = [];
  const closed = vi.fn(async () => undefined);
  const handle = {
    name,
    getFile: async () => new File(['{"x":1}'], name),
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => afterRequest),
    createWritable: vi.fn(async () => ({
      write: async (text: string) => {
        written.push(text);
      },
      close: closed,
    })),
  };
  return { handle: handle as unknown as FileSystemFileHandle, raw: handle, written, closed };
}

describe('file access', () => {
  afterEach(() => {
    delete globals.showOpenFilePicker;
    delete globals.showSaveFilePicker;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('with the File System Access API', () => {
    beforeEach(() => {
      globals.showOpenFilePicker = vi.fn();
      globals.showSaveFilePicker = vi.fn();
    });

    it('is detected only when both pickers exist', () => {
      expect(supportsFileHandles()).toBe(true);
      delete globals.showSaveFilePicker;
      expect(supportsFileHandles()).toBe(false);
    });

    it('Open file reads the chosen file and keeps its handle', async () => {
      const { handle } = fakeHandle('meals.ost');
      globals.showOpenFilePicker = vi.fn(async () => [handle]);
      expect(await pickFileToOpen()).toEqual({ text: '{"x":1}', fileName: 'meals.ost', handle });
      const options = vi.mocked(
        globals.showOpenFilePicker as (o: { multiple: boolean; types: { accept: Record<string, string[]> }[] }) => unknown,
      ).mock.calls[0][0];
      expect(options.multiple).toBe(false);
      expect(options.types[0].accept).toEqual({ 'application/json': ['.ost'] });
    });

    it('closing the open picker is not an error', async () => {
      globals.showOpenFilePicker = vi.fn(async () => {
        throw abort();
      });
      expect(await pickFileToOpen()).toBeNull();
    });

    it('any other picker failure is passed on', async () => {
      globals.showOpenFilePicker = vi.fn(async () => {
        throw new DOMException('no gesture', 'SecurityError');
      });
      await expect(pickFileToOpen()).rejects.toMatchObject({ name: 'SecurityError' });
    });

    it('refuses a file too large to be a tree without reading it', async () => {
      const big = { size: MAX_FILE_BYTES + 1, name: 'huge.ost', text: vi.fn() };
      globals.showOpenFilePicker = vi.fn(async () => [{ getFile: async () => big }]);
      await expect(pickFileToOpen()).rejects.toBeInstanceOf(FileTooLargeError);
      expect(big.text).not.toHaveBeenCalled();
    });

    it('Save as writes to the chosen place and returns its handle', async () => {
      const { handle, written, closed } = fakeHandle('new.ost');
      globals.showSaveFilePicker = vi.fn(async () => handle);
      expect(await pickFileToSave('My tree.ost', 'CONTENT')).toBe(handle);
      expect(vi.mocked(globals.showSaveFilePicker as (o: { suggestedName: string }) => unknown).mock.calls[0][0].suggestedName).toBe(
        'My tree.ost',
      );
      expect(written).toEqual(['CONTENT']);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('closing the save picker saves nothing', async () => {
      globals.showSaveFilePicker = vi.fn(async () => {
        throw abort();
      });
      expect(await pickFileToSave('My tree.ost', 'CONTENT')).toBeNull();
    });

    it('writing to a handle asks for permission again when it lapsed (after a reload)', async () => {
      const { handle, raw, written } = fakeHandle('tree.ost', 'prompt', 'granted');
      await writeToHandle(handle, 'A');
      expect(raw.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
      expect(written).toEqual(['A']);
    });

    it('writing without permission fails and writes nothing', async () => {
      const { handle, raw } = fakeHandle('tree.ost', 'prompt', 'denied');
      await expect(writeToHandle(handle, 'A')).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(raw.createWritable).not.toHaveBeenCalled();
    });

    it('always closes the file, even when the write fails', async () => {
      const { handle, raw, closed } = fakeHandle();
      raw.createWritable.mockResolvedValue({ write: () => Promise.reject(new Error('disk full')), close: closed });
      await expect(writeToHandle(handle, 'A')).rejects.toThrow('disk full');
      expect(closed).toHaveBeenCalledTimes(1);
    });
  });

  describe('without it (file input and download)', () => {
    it('is detected', () => {
      expect(supportsFileHandles()).toBe(false);
    });

    it('Save as has no picker to offer', async () => {
      expect(await pickFileToSave('My tree.ost', 'CONTENT')).toBeNull();
    });

    /** Lets pickFileToOpen create its input, then hands the test that input instead of a real file dialog. */
    function interceptInput(): Promise<HTMLInputElement> {
      return new Promise(resolve => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
          resolve(this);
        });
      });
    }

    it('Open file uses a plain file input limited to .ost files, and removes it afterwards', async () => {
      const shown = interceptInput();
      const opening = pickFileToOpen();
      const input = await shown;
      expect(input.type).toBe('file');
      expect(input.accept).toBe('.ost,application/json');
      expect(input.multiple).toBe(false);
      Object.defineProperty(input, 'files', { value: [new File(['{"y":2}'], 'picked.ost')] });
      input.dispatchEvent(new Event('change'));
      expect(await opening).toEqual({ text: '{"y":2}', fileName: 'picked.ost', handle: null });
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it('cancelling the file dialog resolves null', async () => {
      const shown = interceptInput();
      const opening = pickFileToOpen();
      (await shown).dispatchEvent(new Event('cancel'));
      expect(await opening).toBeNull();
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it('Save downloads the file through a temporary same-page blob link', () => {
      vi.useFakeTimers();
      const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local/1');
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      downloadFile('My tree.ost', 'CONTENT');
      const link = click.mock.contexts[0] as HTMLAnchorElement | undefined;
      expect(link?.download).toBe('My tree.ost');
      expect(link?.getAttribute('href')).toBe('blob:local/1');
      const blob = create.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/json');
      expect(blob.size).toBe(7);
      // The link does not stay in the page, and the object URL is released.
      expect(document.querySelector('a')).toBeNull();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith('blob:local/1');
      vi.useRealTimers();
    });

    it('downloads a Blob as it is (exports pass their own media type)', () => {
      const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local/2');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const png = new Blob(['x'], { type: 'image/png' });
      downloadFile('tree.png', png);
      expect(create.mock.calls[0][0]).toBe(png);
      downloadFile('tree.svg', '<svg/>', 'image/svg+xml');
      expect((create.mock.calls[1][0] as Blob).type).toBe('image/svg+xml');
    });
  });
});

describe('autosave store (in memory)', () => {
  it('keeps one record: load, save, replace, clear', async () => {
    const store = memoryAutosave();
    expect(await store.load()).toBeNull();
    const record = { doc: sampleDocument(), dirty: true, fileName: 'a.ost', handle: null, savedAt: null };
    await store.save(record);
    expect(await store.load()).toBe(record);
    await store.save({ ...record, dirty: false });
    expect((await store.load())?.dirty).toBe(false);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
