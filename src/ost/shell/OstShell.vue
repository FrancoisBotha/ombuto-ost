<template>
  <div class="ost-root ost-shell" data-cy="ostShell">
    <TopBar />

    <main class="ost-shell__body">
      <div v-if="!doc.ready" class="ost-shell__loading" data-cy="ostLoading" aria-live="polite">Opening…</div>
      <CanvasPage v-else-if="doc.hasDocument && tree.loaded" :key="doc.session" />
      <EmptyState v-else />
    </main>

    <OverlayHost />
    <UnsavedChangesDialog v-if="doc.pendingAction" />
  </div>
</template>

<script setup lang="ts">
/**
 * The app shell: the top bar, then either the empty state (no document open) or the tree canvas,
 * and every overlay. On start it restores the document this browser was working on; while a
 * document has changes not saved to a file, closing the tab asks first.
 *
 * The canvas page is keyed by the document session, so opening another document starts from a
 * fresh canvas (fitted view, nothing armed or half-edited).
 */
import { onMounted } from 'vue';

import { useDocumentStore } from '@/doc/document.store';
import { useUnsavedWarning } from '@/doc/unsaved-warning';

import OverlayHost from '../overlays/OverlayHost.vue';
import CanvasPage from '../pages/CanvasPage.vue';
import { useOstTreeStore } from '../stores/ost-tree.store';
import '../styles/ost-styles';

import EmptyState from './EmptyState.vue';
import TopBar from './TopBar.vue';
import UnsavedChangesDialog from './UnsavedChangesDialog.vue';
import { useDocumentShortcuts } from './shortcuts';

const doc = useDocumentStore();
const tree = useOstTreeStore();

useDocumentShortcuts();
useUnsavedWarning();

onMounted(() => doc.init());
</script>

<style scoped>
.ost-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* clip, not hidden: a hidden-overflow box can still be scrolled by focus/scrollIntoView,
     which would push the 54px top bar off screen. */
  overflow: clip;
}

.ost-shell__body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: clip;
}

.ost-shell__loading {
  padding: 32px;
  color: var(--color-neutral-400);
}
</style>
