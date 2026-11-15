<template>
  <div ref="root" class="ost-file-menu">
    <button
      ref="trigger"
      type="button"
      class="ost-file-menu__button ost-hit"
      :class="{ 'is-open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      data-cy="ost-file-menu"
      @click="toggle"
      @keydown.down.prevent="openMenu"
    >
      File
      <PhCaretDown :size="11" aria-hidden="true" />
    </button>

    <div v-if="open" ref="menu" class="ost-file-menu__list" role="menu" aria-label="File" data-cy="ost-file-menu-list" @keydown="onMenuKey">
      <button type="button" role="menuitem" class="ost-file-menu__item" data-cy="ost-file-new" @click="run(() => doc.request('new'))">
        <span>New tree</span>
      </button>
      <button type="button" role="menuitem" class="ost-file-menu__item" data-cy="ost-file-open" @click="run(() => doc.request('open'))">
        <span>Open file…</span><kbd>{{ shortcut('O') }}</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        class="ost-file-menu__item"
        title="Open the built-in example tree as a new, unsaved tree"
        data-cy="ost-file-example"
        @click="run(() => doc.request('example'))"
      >
        <span>Open example</span>
      </button>
      <button
        type="button"
        role="menuitem"
        class="ost-file-menu__item"
        :disabled="!doc.hasDocument"
        :title="doc.savesInPlace ? `Save to ${doc.fileName}` : 'Save to your computer'"
        data-cy="ost-file-save"
        @click="run(() => doc.save())"
      >
        <span>Save</span><kbd>{{ shortcut('S') }}</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        class="ost-file-menu__item"
        :disabled="!doc.hasDocument"
        title="Save to your computer under a new name"
        data-cy="ost-file-save-as"
        @click="run(() => doc.saveAs())"
      >
        <span>Save as…</span><kbd>{{ shortcut('S', true) }}</kbd>
      </button>
      <i class="ost-file-menu__rule" role="separator"></i>
      <div class="ost-file-menu__sub" @pointerenter="onSubEnter" @pointerleave="onSubLeave">
        <button
          ref="exportItem"
          type="button"
          role="menuitem"
          class="ost-file-menu__item"
          aria-haspopup="menu"
          :aria-expanded="exportOpen"
          :disabled="!doc.hasDocument"
          data-cy="ost-file-export"
          @click="openExport"
          @keydown.right.prevent.stop="openExport"
          @keydown.enter.prevent.stop="openExport"
          @keydown.space.prevent.stop="openExport"
        >
          <span>Export</span><PhCaretRight :size="11" aria-hidden="true" />
        </button>
        <div
          v-if="exportOpen"
          ref="exportMenu"
          class="ost-file-menu__list ost-file-menu__list--sub"
          role="menu"
          aria-label="Export"
          data-cy="ost-file-export-list"
          @keydown.stop="onExportKey"
        >
          <button
            v-for="item in EXPORTS"
            :key="item.id"
            type="button"
            role="menuitem"
            class="ost-file-menu__item"
            :data-cy="`ost-file-export-${item.id}`"
            @click="runExport(item)"
          >
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The File menu: New tree, Open file, Open example, Save, Save as, and Export ▸ PNG / SVG / Markdown.
 *
 * New tree, Open file and Open example all replace the document through `doc.request`, which takes
 * in text still being typed and asks about unsaved changes first.
 *
 * The export items call `exportPng` / `exportSvg` / `exportMarkdown` from '@/export' with no
 * arguments; a rejected promise is shown as an error toast (its Error message, when it has one).
 *
 * Keyboard (WAI-ARIA menu button): ↓ on the button opens; in a menu ↑/↓/Home/End move, Escape
 * closes and returns focus, Tab closes; → / Enter on Export opens the submenu, ← or Escape leaves
 * it. A pointer press outside closes everything.
 */
import { PhCaretDown, PhCaretRight } from '@phosphor-icons/vue';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import { useDocumentStore } from '@/doc/document.store';
import { exportMarkdown, exportPng, exportSvg } from '@/export';

import { shortcutLabel } from './shortcuts';

const EXPORTS = [
  { id: 'png', label: 'PNG image', run: exportPng },
  { id: 'svg', label: 'SVG image', run: exportSvg },
  { id: 'markdown', label: 'Markdown outline', run: exportMarkdown },
] as const;

const doc = useDocumentStore();

const open = ref(false);
const exportOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const exportItem = ref<HTMLButtonElement | null>(null);
const exportMenu = ref<HTMLElement | null>(null);

const shortcut = (key: string, shift = false) => shortcutLabel(key, shift);

/** The enabled items of one menu level (a submenu's items belong to the submenu). */
const itemsOf = (list: HTMLElement | null) =>
  Array.from(list?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []).filter(
    el => el.closest('[role="menu"]') === list,
  );

function move(list: HTMLElement | null, delta: number | 'first' | 'last') {
  const items = itemsOf(list);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = delta === 'first' ? 0 : delta === 'last' ? items.length - 1 : (i + delta + items.length) % items.length;
  items[next].focus();
}

async function openMenu() {
  open.value = true;
  await nextTick();
  move(menu.value, 'first');
}

function close(refocus = false) {
  open.value = false;
  exportOpen.value = false;
  if (refocus) trigger.value?.focus();
}

function toggle() {
  if (open.value) close();
  else void openMenu();
}

async function openExport() {
  if (!doc.hasDocument) return;
  exportOpen.value = true;
  await nextTick();
  move(exportMenu.value, 'first');
}

/** Hovering Export with a mouse opens the submenu (touch and pen use the click). */
function onSubEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse' && doc.hasDocument) exportOpen.value = true;
}
function onSubLeave(event: PointerEvent) {
  if (event.pointerType === 'mouse') exportOpen.value = false;
}

function onMenuKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') move(menu.value, 1);
  else if (event.key === 'ArrowUp') move(menu.value, -1);
  else if (event.key === 'Home') move(menu.value, 'first');
  else if (event.key === 'End') move(menu.value, 'last');
  else if (event.key === 'Escape') close(true);
  else if (event.key === 'Tab') close();
  else return;
  if (event.key !== 'Tab') event.preventDefault();
}

function onExportKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') move(exportMenu.value, 1);
  else if (event.key === 'ArrowUp') move(exportMenu.value, -1);
  else if (event.key === 'Home') move(exportMenu.value, 'first');
  else if (event.key === 'End') move(exportMenu.value, 'last');
  else if (event.key === 'Escape' || event.key === 'ArrowLeft') {
    exportOpen.value = false;
    exportItem.value?.focus();
  } else if (event.key === 'Tab') close();
  else return;
  if (event.key !== 'Tab') event.preventDefault();
}

/** Runs a menu action. The menu closes first, so a file picker or dialog never sits under it. */
function run(action: () => unknown) {
  close(true);
  void action();
}

async function runExport(item: (typeof EXPORTS)[number]) {
  close(true);
  try {
    await item.run();
  } catch (err) {
    doc.reportError(err instanceof Error && err.message ? err.message : `The ${item.label} could not be exported.`);
  }
}

function onDocumentPointer(event: Event) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close();
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer));
</script>

<style scoped>
.ost-file-menu {
  position: relative;
}

.ost-file-menu__button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  font: inherit;
  font-family: var(--font-heading);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.ost-file-menu__button:hover,
.ost-file-menu__button.is-open {
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
}

.ost-file-menu__list {
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 100;
  min-width: 208px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--color-surface);
  border: 1px solid var(--color-neutral-700);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.ost-file-menu__sub {
  position: relative;
}

.ost-file-menu__list--sub {
  left: calc(100% - 2px);
  top: -5px;
  min-width: 170px;
}

.ost-file-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  width: 100%;
  min-height: 30px;
  padding: 5px 9px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.ost-file-menu__item:hover:not(:disabled),
.ost-file-menu__item:focus-visible,
.ost-file-menu__item[aria-expanded='true'] {
  background: var(--color-accent-900);
}
.ost-file-menu__item:disabled {
  color: var(--color-neutral-600);
  cursor: default;
}

.ost-file-menu__item kbd {
  font: inherit;
  font-size: 11px;
  color: var(--color-neutral-500);
}

.ost-file-menu__rule {
  display: block;
  height: 1px;
  margin: 3px 4px;
  background: var(--color-divider);
}

@media (pointer: coarse) {
  .ost-file-menu__item {
    min-height: 44px;
  }
}
</style>
