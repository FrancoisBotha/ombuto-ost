<template>
  <div class="ost-start">
    <div v-if="doc.unreadable" class="ost-start__recover" role="alert" data-cy="ost-unreadable">
      <p class="ost-start__recover-text">
        <strong>A working copy kept in this browser could not be read.</strong> It has not been deleted. You can save its contents to your
        computer to look at them or repair them, or delete it.
      </p>
      <div class="ost-start__actions">
        <button type="button" class="ost-btn" data-cy="ost-unreadable-save" @click="doc.saveUnreadable()">
          Save its contents to your computer
        </button>
        <button type="button" class="ost-btn ost-btn--ghost" data-cy="ost-unreadable-discard" @click="doc.discardUnreadable()">
          Delete it
        </button>
      </div>
    </div>
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
        <button type="button" class="ost-btn" data-cy="ost-empty-example" @click="doc.request('example')">Open example</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * First run, or no document open: New tree · Open file · Open example.
 *
 * When a working copy from an earlier visit turned out to be unreadable, this is also where the app
 * says so: the copy is kept until the user saves its contents or deletes it.
 */
import { useDocumentStore } from '@/doc/document.store';

const doc = useDocumentStore();
</script>

<style scoped>
.ost-start {
  height: 100%;
  overflow: auto;
  padding: 0 16px;
}

.ost-start__recover {
  max-width: 520px;
  margin: 24px auto 0;
  padding: 12px 14px;
  font-size: 13px;
  border: 1px solid var(--color-accent-700);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.ost-start__recover-text {
  margin: 0 0 4px;
  text-wrap: pretty;
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
