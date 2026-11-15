import { afterEach, describe, expect, it, vi } from 'vitest';

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

import { exampleRecord, setupShellStores } from '@/ost/shell/shell.test-util';

import UpdatePrompt from './UpdatePrompt.vue';
import { SERVICE_WORKER_URL, appUpdateWatcher, createUpdateWatcher } from './update-watcher';

enableAutoUnmount(afterEach);

/** A stand-in service worker: a state, a message log and `statechange` events. */
class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  constructor(public state: ServiceWorkerState) {
    super();
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;

  /** The browser found a newer sw.js and starts installing it. */
  findUpdate() {
    const worker = new FakeWorker('installing');
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
  /** The installing worker finished: it waits when another one is active, otherwise it takes over. */
  finishInstall() {
    const worker = this.installing!;
    this.installing = null;
    if (this.active) {
      this.waiting = worker;
      worker.become('installed');
    } else {
      worker.become('installed');
      this.active = worker;
      worker.become('activated');
    }
  }
}

function setup(prepare: (registration: FakeRegistration) => void = () => undefined) {
  const registration = new FakeRegistration();
  prepare(registration);
  const register = vi.fn(async () => registration as unknown as ServiceWorkerRegistration);
  const reload = vi.fn();
  const watcher = createUpdateWatcher({ register }, reload);
  return { registration, register, reload, watcher };
}

describe('update watcher', () => {
  it('registers the worker by a relative address, so the app works from any folder', async () => {
    const { watcher, register } = setup();
    await watcher.start();
    expect(SERVICE_WORKER_URL).toBe('./sw.js');
    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('a first visit installs quietly: there is nothing to reload for', async () => {
    const { watcher, registration } = setup(r => r.findUpdate());
    await watcher.start();
    registration.finishInstall();
    expect(watcher.updateReady.value).toBe(false);
  });

  it('a newer version that finishes installing behind the running one is announced, not applied', async () => {
    const { watcher, registration, reload } = setup(r => (r.active = new FakeWorker('activated')));
    await watcher.start();
    expect(watcher.updateReady.value).toBe(false);
    const next = registration.findUpdate();
    expect(watcher.updateReady.value).toBe(false);
    registration.finishInstall();
    expect(watcher.updateReady.value).toBe(true);
    // Nothing is switched or reloaded until the user asks.
    expect(next.messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a version already waiting when the app opens is announced at once', async () => {
    const { watcher } = setup(r => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await watcher.start();
    expect(watcher.updateReady.value).toBe(true);
  });

  it('apply tells the waiting worker to take over and reloads once it has', async () => {
    const { watcher, registration, reload } = setup(r => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await watcher.start();
    const next = registration.waiting!;
    watcher.apply();
    expect(next.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();
    next.become('activating');
    expect(reload).not.toHaveBeenCalled();
    next.become('activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('apply just reloads when another tab already switched to the new version', async () => {
    const { watcher, registration, reload } = setup(r => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await watcher.start();
    registration.waiting = null;
    watcher.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a browser that refuses the worker leaves the app running without it', async () => {
    const reload = vi.fn();
    const watcher = createUpdateWatcher({ register: () => Promise.reject(new Error('SecurityError')) }, reload);
    await expect(watcher.start()).resolves.toBeUndefined();
    expect(watcher.updateReady.value).toBe(false);
  });

  it('is not used outside a production build (no worker in development or tests)', () => {
    expect(appUpdateWatcher()).toBeNull();
  });
});

describe('UpdatePrompt', () => {
  async function mounted(record: ReturnType<typeof exampleRecord> | null = exampleRecord()) {
    const ctx = setupShellStores(record);
    await ctx.doc.init();
    const fake = setup(r => (r.active = new FakeWorker('activated')));
    const w = mount(UpdatePrompt, { attachTo: document.body, props: { watcher: fake.watcher }, global: { plugins: [ctx.pinia] } });
    await flushPromises();
    const find = () => w.find('[data-cy="ost-update-prompt"]');
    const announce = async () => {
      fake.registration.findUpdate();
      fake.registration.finishInstall();
      await flushPromises();
    };
    return { ...ctx, ...fake, w, find, announce };
  }

  it('renders nothing when there is no watcher (development, or a browser without service workers)', async () => {
    const { pinia } = setupShellStores();
    const w = mount(UpdatePrompt, { props: { watcher: null }, global: { plugins: [pinia] } });
    await flushPromises();
    expect(w.find('[data-cy="ost-update-prompt"]').exists()).toBe(false);
  });

  it('registers the worker when mounted and stays hidden until a new version is waiting', async () => {
    const { register, find, announce } = await mounted();
    expect(register).toHaveBeenCalledTimes(1);
    expect(find().exists()).toBe(false);
    await announce();
    expect(find().attributes('role')).toBe('status');
    expect(find().get('[data-cy="ost-update-text"]').text()).toBe(
      'A new version is ready. Your tree is kept in this browser and comes back after the reload.',
    );
  });

  it('Reload writes the pending autosave first, then switches version', async () => {
    const { find, announce, tree, doc, registration, reload } = await mounted();
    await announce();
    await tree.patchNode('project-1', { title: 'Typed just now' });
    const flush = vi.spyOn(doc, 'flushAutosave');
    await find().get('[data-cy="ost-update-reload"]').trigger('click');
    await flushPromises();
    expect(flush).toHaveBeenCalledTimes(1);
    const next = registration.waiting!;
    expect(next.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    next.become('activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Reload with unsaved changes: once the working copy is stored, the browser is not made to ask "Leave site?"', async () => {
    const { find, announce, tree, doc } = await mounted();
    await announce();
    await tree.patchNode('project-1', { title: 'Unsaved, but kept in the browser' });
    expect(doc.warnsBeforeLeaving()).toBe(true);
    await find().get('[data-cy="ost-update-reload"]').trigger('click');
    await flushPromises();
    expect(doc.warnsBeforeLeaving()).toBe(false);
  });

  it('Reload when the working copy could not be written: no reload yet, the prompt says to save a file, and the warning stays', async () => {
    const { find, announce, tree, doc, registration, reload } = await mounted();
    await announce();
    expect(find().get('[data-cy="ost-update-text"]').text()).toContain('comes back after the reload');
    // Storage fails only now, at the moment of the reload.
    doc.setAutosaveStore({ load: async () => null, save: () => Promise.reject(new Error('quota')), clear: async () => undefined });
    await tree.patchNode('project-1', { title: 'Would be lost' });
    await find().get('[data-cy="ost-update-reload"]').trigger('click');
    await flushPromises();
    expect(registration.waiting!.messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    expect(find().get('[data-cy="ost-update-text"]').text()).toBe('A new version is ready. Save your tree to a file before you reload.');
    expect(doc.warnsBeforeLeaving()).toBe(true);
    // The user insists: the reload goes ahead, and the browser will ask.
    await find().get('[data-cy="ost-update-reload"]').trigger('click');
    await flushPromises();
    expect(registration.waiting!.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(doc.warnsBeforeLeaving()).toBe(true);
  });

  it('Later hides the prompt and changes nothing', async () => {
    const { find, announce, registration, reload } = await mounted();
    await announce();
    await find().get('[data-cy="ost-update-later"]').trigger('click');
    expect(find().exists()).toBe(false);
    expect(registration.waiting!.messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('with no tree open it only says that a new version is ready', async () => {
    const { find, announce } = await mounted(null);
    await announce();
    expect(find().get('[data-cy="ost-update-text"]').text()).toBe('A new version of Pebble OST is ready.');
  });

  it('with autosave off it asks for a save to a file before the reload', async () => {
    const { find, announce, doc, tree } = await mounted();
    doc.setAutosaveStore({ load: async () => null, save: () => Promise.reject(new Error('quota')), clear: async () => undefined });
    await tree.patchNode('project-1', { title: 'Edited' });
    await doc.flushAutosave();
    await announce();
    expect(find().get('[data-cy="ost-update-text"]').text()).toBe('A new version is ready. Save your tree to a file before you reload.');
  });
});
