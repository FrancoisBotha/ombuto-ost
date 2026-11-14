<template>
  <div v-if="visible" class="ost-update" role="status" data-cy="ost-update-prompt">
    <span data-cy="ost-update-text">{{ message }}</span>
    <button type="button" class="ost-btn ost-btn--primary" data-cy="ost-update-reload" @click="reload">Reload</button>
    <button type="button" class="ost-btn ost-btn--ghost" data-cy="ost-update-later" @click="dismissed = true">Later</button>
  </div>
</template>

<script setup lang="ts">
/**
 * The quiet "new version" prompt. A newer version of the app never swaps itself in under an open
 * tree: it waits until the user chooses Reload here (or closes every tab of the app). "Later"
 * hides the prompt until the app is next opened.
 */
import { computed, onMounted, ref } from 'vue';

import { useDocumentStore } from '@/doc/document.store';

import { type UpdateWatcher, appUpdateWatcher } from './update-watcher';

const props = defineProps<{ watcher?: UpdateWatcher | null }>();

const doc = useDocumentStore();
const watcher = props.watcher === undefined ? appUpdateWatcher() : props.watcher;
const dismissed = ref(false);

const visible = computed(() => watcher?.updateReady.value === true && !dismissed.value);

const message = computed(() => {
  if (!doc.hasDocument) return 'A new version of Ombuto OST is ready.';
  // With autosave off, a reload would lose whatever is not in a file yet.
  if (doc.autosaveFailed) return 'A new version is ready. Save your tree to a file before you reload.';
  return 'A new version is ready. Your tree is kept in this browser and comes back after the reload.';
});

async function reload() {
  await doc.flushAutosave();
  watcher?.apply();
}

onMounted(() => void watcher?.start());
</script>

<style scoped>
.ost-update {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  /* above the canvas and its controls, below dialogs (1050) and the error toast (1060) */
  z-index: 1040;
  width: max-content;
  max-width: min(520px, calc(100vw - 24px));
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 14px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-neutral-700);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
</style>
