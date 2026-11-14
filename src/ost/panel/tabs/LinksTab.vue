<template>
  <div v-if="node" class="ost-tab ost-links" data-cy="ostTab-links">
    <LinkRow v-for="link in node.links" :key="link.id ?? link.name" :link="link" @save="save(link.id, $event)" @remove="remove(link.id)" />
    <p v-if="!node.links.length" class="ost-links__empty" data-cy="ost-links-empty">No links yet.</p>

    <form v-if="adding" class="ost-links__form" data-cy="ost-link-form" novalidate @submit.prevent="submit">
      <input
        ref="nameInput"
        v-model="draft.name"
        class="ost-input ost-links__input"
        aria-label="New link name"
        placeholder="Name"
        :maxlength="LINK_NAME_MAX"
        data-cy="ost-link-new-name"
        @keydown.esc.prevent="closeForm"
      />
      <input
        v-model="draft.url"
        class="ost-input ost-links__input"
        aria-label="New link URL"
        placeholder="https://"
        :maxlength="LINK_URL_MAX"
        data-cy="ost-link-new-url"
        @keydown.esc.prevent="closeForm"
      />
      <div v-if="formError" class="ost-links__error" role="alert" data-cy="ost-link-error">{{ formError }}</div>
      <div class="ost-links__form-actions">
        <button type="button" class="ost-btn ost-links__small" data-cy="ost-link-new-cancel" @click="closeForm">Cancel</button>
        <button type="submit" class="ost-btn ost-btn--primary ost-links__small" :disabled="busy" data-cy="ost-link-new-save">Add</button>
      </div>
    </form>
    <button v-else ref="addButton" type="button" class="ost-btn ost-links__add" data-cy="ost-link-add" @click="openForm">+ Add link</button>
  </div>
</template>

<script setup lang="ts">
/**
 * Links tab: plain named URLs. Rows edit inline, remove, and open in a new tab; "Add link" takes a
 * name and an http(s) or mailto URL.
 */
import { computed, nextTick, reactive, ref } from 'vue';

import { LINK_NAME_MAX, LINK_URL_MAX } from '@/doc/document';

import { isSafeLinkUrl } from '../../domain/rules';
import { useOstTreeStore } from '../../stores/ost-tree.store';
import LinkRow from '../fields/LinkRow.vue';
import { usePanelAction } from '../panel-action';
import { LINK_URL_RULE } from '../panel-format';

const props = defineProps<{ nodeKey: string }>();
const tree = useOstTreeStore();
const { run } = usePanelAction();

const node = computed(() => tree.byId(props.nodeKey));

const adding = ref(false);
const busy = ref(false);
const draft = reactive({ name: '', url: 'https://' });
const formError = ref<string | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const addButton = ref<HTMLButtonElement | null>(null);

function save(linkId: number | undefined, patch: { name?: string; url?: string }) {
  if (linkId === undefined) return;
  void run(() => tree.updateLink(props.nodeKey, linkId, patch));
}

function remove(linkId: number | undefined) {
  if (linkId === undefined) return;
  void run(() => tree.removeLink(props.nodeKey, linkId));
}

async function openForm() {
  draft.name = '';
  draft.url = 'https://';
  formError.value = null;
  adding.value = true;
  await nextTick();
  nameInput.value?.focus();
}

/** Closing the form (Cancel, Escape, or after adding) hands focus back to "+ Add link". */
async function closeForm() {
  adding.value = false;
  formError.value = null;
  await nextTick();
  addButton.value?.focus();
}

async function submit() {
  if (busy.value) return;
  const name = draft.name.trim();
  const url = draft.url.trim();
  if (!name) {
    formError.value = 'Give the link a name.';
    return;
  }
  if (!isSafeLinkUrl(url)) {
    formError.value = LINK_URL_RULE;
    return;
  }
  formError.value = null;
  busy.value = true;
  try {
    const ok = await run(() => tree.addLink(props.nodeKey, { name, url }));
    if (ok) void closeForm();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.ost-links {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.ost-links__empty {
  margin: 0;
  font-size: 12px;
  color: var(--color-neutral-500);
}

.ost-links__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px dashed var(--color-accent-600);
  border-radius: var(--radius-md);
}

.ost-links__form .ost-links__input {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 12.5px;
}

.ost-links__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.ost-links .ost-links__small {
  height: 28px;
  font-size: 12px;
}

.ost-links .ost-links__add {
  height: 30px;
  font-size: 12px;
}

.ost-links__error {
  font-size: 11px;
  color: var(--color-accent-300);
}
</style>
