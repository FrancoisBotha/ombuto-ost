<template>
  <ConfirmDeleteDialog v-if="ui.confirmId" />
  <div v-if="message" class="ost-toast" role="alert" data-cy="ostError">
    <span>{{ message }}</span>
    <button type="button" class="ost-btn ost-btn--ghost" data-cy="ostErrorDismiss" @click="dismiss">Dismiss</button>
  </div>
  <!-- Always in the page, so a screen reader hears what is put in it; on screen only when asked. -->
  <div class="ost-notice" :class="{ 'ost-sr-only': !ui.notice?.show }" role="status" data-cy="ostNotice">{{ ui.notice?.text ?? '' }}</div>
</template>

<script setup lang="ts">
/**
 * Every OST overlay in one place, rendered inside .ost-root so the tokens apply: the delete
 * confirmation, the toast for a failed tree edit or file action, and the notice of an undo or redo.
 *
 * The notice is always announced to screen readers. It is shown, for NOTICE_MS, only when the
 * change was to a node the canvas does not show (outside the focused project, in a collapsed
 * branch): everywhere else the change itself is what the user sees.
 */
import { computed, onBeforeUnmount, watch } from 'vue';

import { useDocumentStore } from '@/doc/document.store';

import { useOstTreeStore } from '../stores/ost-tree.store';
import { useOstUiStore } from '../stores/ost-ui.store';

import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue';

const tree = useOstTreeStore();
const ui = useOstUiStore();
const doc = useDocumentStore();

const message = computed(() => tree.error ?? doc.error);

/** How long the notice of an undo or redo stays. */
const NOTICE_MS = 4000;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => ui.notice?.seq,
  seq => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = seq === undefined ? null : setTimeout(() => ui.clearNotice(), NOTICE_MS);
  },
);
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
});

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

/* Bottom centre: clear of the error toast (right), the legend (left) and the overview map. */
.ost-notice:not(.ost-sr-only) {
  position: fixed;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  z-index: 1055;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-accent-600);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  pointer-events: none;
}
</style>
