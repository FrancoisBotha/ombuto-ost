/** Test-only: mounts shell components against real stores, with the working document kept in memory. */
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { type AutosaveRecord, memoryAutosave } from '@/doc/autosave';
import { useDocumentStore } from '@/doc/document.store';
import { sampleDocument } from '@/doc/sample';

import { useOstTreeStore } from '../stores/ost-tree.store';
import { useOstUiStore } from '../stores/ost-ui.store';

/** An autosave record of the example tree (what a returning visitor's browser holds). */
export const exampleRecord = (extra: Partial<AutosaveRecord> = {}): AutosaveRecord => ({
  doc: sampleDocument(new Date('2026-01-02T03:04:05Z')),
  dirty: false,
  fileName: null,
  handle: null,
  savedAt: null,
  ...extra,
});

/** Fresh stores. `restored` is what the browser's autosave holds (null: a first visit). */
export function setupShellStores(restored: AutosaveRecord | null = null) {
  localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  const doc = useDocumentStore();
  doc.setAutosaveStore(memoryAutosave(restored));
  return { pinia, doc, tree: useOstTreeStore(), ui: useOstUiStore() };
}

export async function mountShell<T>(component: T, pinia: ReturnType<typeof createPinia>, stubs: Record<string, Component> = {}) {
  const wrapper = mount(component as any, { attachTo: document.body, global: { plugins: [pinia], stubs } });
  await flushPromises();
  return wrapper;
}

export const key = (name: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
