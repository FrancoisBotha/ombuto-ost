<template>
  <OstDialog title="Save your changes first?" width="400px" data-cy="ostUnsavedDialog" @close="answer('cancel')">
    <p class="ost-unsaved__text" data-cy="ostUnsavedText">
      “{{ doc.name }}” has changes that are not saved to a file. {{ CONSEQUENCE[doc.pendingAction ?? 'new'] }} without saving loses them.
    </p>
    <template #actions>
      <button type="button" class="ost-btn" data-cy="ostUnsavedCancel" autofocus :disabled="busy" @click="answer('cancel')">Cancel</button>
      <button type="button" class="ost-btn ost-btn--destructive" data-cy="ostUnsavedDiscard" :disabled="busy" @click="answer('discard')">
        Don’t save
      </button>
      <button type="button" class="ost-btn ost-btn--primary" data-cy="ostUnsavedSave" :disabled="busy" @click="answer('save')">Save</button>
    </template>
  </OstDialog>
</template>

<script setup lang="ts">
/**
 * Asked before New tree / Open file / Load example replaces a document that has changes not yet
 * saved to a file: Cancel, Don't save, or Save (which carries on only when the save went through).
 */
import { ref } from 'vue';

import { type ReplaceAction, useDocumentStore } from '@/doc/document.store';

import OstDialog from '../overlays/OstDialog.vue';

const CONSEQUENCE: Record<ReplaceAction, string> = {
  new: 'Starting a new tree',
  open: 'Opening another file',
  example: 'Loading the example',
};

const doc = useDocumentStore();
const busy = ref(false);

async function answer(choice: 'save' | 'discard' | 'cancel') {
  if (busy.value) return;
  busy.value = true;
  try {
    await doc.resolvePending(choice);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.ost-unsaved__text {
  margin: 0;
  text-wrap: pretty;
}
</style>
