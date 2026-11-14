<template>
  <div class="ost-start">
    <div class="ost-state ost-start__card" data-cy="ost-empty-state">
      <h1 class="ost-state__title">Start a tree</h1>
      <p class="ost-state__text">
        An Opportunity Solution Tree maps an outcome to the opportunities behind it, the solutions you could try and the assumptions each
        one rests on.
      </p>
      <p class="ost-state__text">
        A tree is a file on your own computer. It is stored on this device only: nothing you type is sent anywhere.
      </p>
      <div class="ost-start__actions">
        <button type="button" class="ost-btn ost-btn--primary" data-cy="ost-empty-new" @click="doc.request('new')">New tree</button>
        <button type="button" class="ost-btn" data-cy="ost-empty-open" @click="doc.request('open')">Open file</button>
        <button type="button" class="ost-btn" data-cy="ost-empty-example" @click="doc.request('example')">Load example</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** First run, or no document open: New tree · Open file · Load example. */
import { useDocumentStore } from '@/doc/document.store';

const doc = useDocumentStore();
</script>

<style scoped>
.ost-start {
  height: 100%;
  overflow: auto;
  padding: 0 16px;
}

.ost-start .ost-start__card {
  gap: 12px;
}

.ost-start h1.ost-state__title {
  margin: 0;
}

.ost-start .ost-state__text {
  margin: 0;
}

.ost-start__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
</style>
