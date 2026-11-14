<template>
  <header class="ost-nav" data-cy="ost-top-bar">
    <div class="ost-nav__brand">Ombuto<span class="ost-nav__slash"> / </span>OST</div>
    <FileMenu />

    <template v-if="doc.hasDocument">
      <input
        v-model="draft"
        class="ost-input ost-nav__name"
        aria-label="Tree name"
        autocomplete="off"
        spellcheck="false"
        :maxlength="DOCUMENT_NAME_MAX"
        data-cy="ost-doc-name"
        @focus="onFocus"
        @input="live.touch"
        @keydown.enter.prevent="blurTarget"
        @keydown.esc.prevent="cancel"
        @blur="commit"
      />
      <span class="ost-nav__state" :class="{ 'is-dirty': doc.dirty }" role="status" :title="stateTitle" data-cy="ost-save-state">{{
        stateText
      }}</span>
    </template>

    <div class="ost-nav__right">
      <PrivacyIndicator />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * The slim top bar (54px): brand · File menu · the tree's name (editable) · saved / unsaved state ·
 * the privacy indicator on the right.
 *
 * The name reaches the document a moment after typing stops, and on Enter / blur; Escape puts back
 * the name the field had when it was focused. It is part of the file, so renaming is a change to
 * save like any other.
 */
import { computed, ref, watch } from 'vue';

import { DOCUMENT_NAME_MAX } from '@/doc/document';
import { useDocumentStore } from '@/doc/document.store';
import { useLiveCommit } from '@/doc/pending-edits';
import PrivacyIndicator from '@/privacy/PrivacyIndicator.vue';

import FileMenu from './FileMenu.vue';

const doc = useDocumentStore();

const draft = ref(doc.name);
const editing = ref(false);
/** The name when the field took focus: what Escape goes back to. */
let initial = doc.name;

// While typing: a usable name goes into the document; an empty field waits for blur (which names it).
const live = useLiveCommit(() => {
  if (draft.value.trim() && draft.value.trim() !== doc.name) doc.rename(draft.value);
});

function onFocus() {
  editing.value = true;
  initial = doc.name;
}

// Follow the document (another file, a name cleaned on save) unless the user is typing.
watch(
  () => doc.name,
  name => {
    if (!editing.value) draft.value = name;
  },
);

const blurTarget = (event: Event) => (event.target as HTMLElement).blur();

function cancel(event: KeyboardEvent) {
  live.cancel();
  if (doc.name !== initial) doc.rename(initial);
  draft.value = doc.name;
  (event.target as HTMLInputElement).select();
}

function commit() {
  live.cancel();
  editing.value = false;
  if (draft.value.trim() !== doc.name) doc.rename(draft.value);
  draft.value = doc.name;
}

/** A download is a copy the app handed to the browser; it cannot see whether the browser kept it. */
const downloaded = computed(() => doc.savedBy === 'download');

const stateText = computed(() => {
  if (doc.dirty) return 'Unsaved changes';
  if (!doc.fileName) return '';
  return downloaded.value ? 'Downloaded a copy' : 'Saved';
});

const stateTitle = computed(() => {
  if (doc.dirty) return 'These changes are kept in this browser, but not yet saved to a file on your computer.';
  if (!doc.fileName) return '';
  const at = doc.lastSavedAt ? new Date(doc.lastSavedAt) : null;
  const time = at && !Number.isNaN(at.getTime()) ? ` at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return downloaded.value
    ? `A copy was sent to your browser’s downloads as ${doc.fileName}${time}. The app cannot see whether it arrived: look in your downloads folder.`
    : `Saved to ${doc.fileName}${time}`;
});
</script>

<style scoped>
.ost-nav {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  height: 54px;
  flex: none;
  border-bottom: 1px solid var(--color-divider);
}

.ost-nav__brand {
  margin-right: 8px;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.ost-nav__slash {
  color: var(--color-accent);
}

.ost-nav .ost-nav__name {
  flex: 0 1 300px;
  min-width: 90px;
  min-height: 30px;
  padding: 3px 8px;
  font-size: 14px;
  font-weight: 500;
  background: transparent;
  border-color: transparent;
  text-overflow: ellipsis;
}
.ost-nav .ost-nav__name:hover {
  border-color: var(--color-neutral-700);
}

.ost-nav__state {
  font-size: 11.5px;
  color: var(--color-neutral-500);
  white-space: nowrap;
}
.ost-nav__state.is-dirty {
  color: var(--color-accent-300);
}

.ost-nav__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

@media (max-width: 720px) {
  .ost-nav {
    gap: 8px;
    padding: 0 10px;
  }
  .ost-nav__brand {
    display: none;
  }
}
</style>
