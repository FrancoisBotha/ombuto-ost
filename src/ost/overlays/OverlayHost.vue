<template>
  <ConfirmDeleteDialog v-if="ui.confirmId" />
  <div v-if="message" class="ost-toast" role="alert" data-cy="ostError">
    <span>{{ message }}</span>
    <button type="button" class="ost-btn ost-btn--ghost" data-cy="ostErrorDismiss" @click="dismiss">Dismiss</button>
  </div>
</template>

<script setup lang="ts">
/**
 * Every OST overlay in one place, rendered inside .ost-root so the tokens apply: the delete
 * confirmation, and the toast for a failed tree edit or file action.
 */
import { computed } from 'vue';

import { useDocumentStore } from '@/doc/document.store';

import { useOstTreeStore } from '../stores/ost-tree.store';
import { useOstUiStore } from '../stores/ost-ui.store';

import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue';

const tree = useOstTreeStore();
const ui = useOstUiStore();
const doc = useDocumentStore();

const message = computed(() => tree.error ?? doc.error);

function dismiss() {
  tree.clearError();
  doc.clearError();
}
</script>

<style scoped>
.ost-toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  /* above dialogs (1050), which sit above the app chrome (OstDialog.vue) */
  z-index: 1060;
  max-width: 380px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 14px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-neutral-700);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
</style>
