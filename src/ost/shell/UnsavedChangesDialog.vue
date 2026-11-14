<template>
  <OstDialog
    :title="doc.pendingDownloaded ? 'Check your downloads' : 'Save your changes first?'"
    width="400px"
    data-cy="ostUnsavedDialog"
    @close="answer('cancel')"
  >
    <p v-if="doc.pendingDownloaded" class="ost-unsaved__text" data-cy="ostUnsavedDownloaded">
      A copy of “{{ doc.name }}” was sent to your browser’s downloads as {{ doc.fileName }}. The app cannot see whether it arrived. Check
      that it is there, then carry on: {{ CONSEQUENCE[doc.pendingAction ?? 'new'].toLowerCase() }} replaces the tree that is open.
    </p>
    <p v-else class="ost-unsaved__text" data-cy="ostUnsavedText">
      “{{ doc.name }}” has changes that are not saved to a file. {{ CONSEQUENCE[doc.pendingAction ?? 'new'] }} without saving loses them.
    </p>
    <template #actions>
      <button type="button" class="ost-btn" data-cy="ostUnsavedCancel" autofocus :disabled="busy" @click="answer('cancel')">Cancel</button>
      <template v-if="doc.pendingDownloaded">
        <button type="button" class="ost-btn" data-cy="ostUnsavedSave" :disabled="busy" @click="answer('save')">Download again</button>
        <button type="button" class="ost-btn ost-btn--primary" data-cy="ostUnsavedContinue" :disabled="busy" @click="answer('discard')">
          Carry on
        </button>
      </template>
      <template v-else>
        <button type="button" class="ost-btn ost-btn--destructive" data-cy="ostUnsavedDiscard" :disabled="busy" @click="answer('discard')">
          Don’t save
        </button>
        <button type="button" class="ost-btn ost-btn--primary" data-cy="ostUnsavedSave" :disabled="busy" @click="answer('save')">
          Save
        </button>
      </template>
    </template>
  </OstDialog>
</template>

<script setup lang="ts">
/**
 * Asked before New tree / Open file / Load example replaces a document that has changes not yet
 * saved to a file: Cancel, Don't save, or Save (which carries on only when the save went through).
 *
 * Where Save can only download a copy (no save picker in this browser), the app cannot see whether
 * the download arrived. The dialog then stays, says so, and waits for "Carry on": the open tree is
 * never replaced on the strength of a download nobody has checked.
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
