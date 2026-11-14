<template>
  <div class="ost-field">
    <label class="ost-field__label ost-field__label--6" :for="id">Owner</label>
    <input
      :id="id"
      v-model="draft"
      class="ost-input ost-owner"
      placeholder="Who is testing this?"
      autocomplete="off"
      :maxlength="OWNER_MAX"
      data-cy="ost-owner"
      @focus="focused = true"
      @keydown.enter.prevent="blurTarget"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    />
  </div>
</template>

<script setup lang="ts">
/** Assumption owner: free text (a name, a team, anything). Commits on Enter / blur; Escape reverts. */
import { ref, watch } from 'vue';

import { OWNER_MAX } from '@/doc/document';

const props = defineProps<{ value: string }>();
const emit = defineEmits<{ change: [owner: string] }>();

const id = `ost-owner-${Math.random().toString(36).slice(2, 9)}`;
const draft = ref(props.value);
const focused = ref(false);

// Follow the stored owner (the saved value, a rollback) unless the user is typing.
watch(
  () => props.value,
  v => {
    if (!focused.value) draft.value = v;
  },
);

const blurTarget = (event: Event) => (event.target as HTMLElement).blur();

function cancel(event: KeyboardEvent) {
  draft.value = props.value;
  (event.target as HTMLInputElement).select();
}

function commit() {
  focused.value = false;
  const next = draft.value.trim();
  draft.value = next;
  if (next !== props.value) emit('change', next);
}
</script>

<style scoped>
.ost-field .ost-owner {
  min-height: 32px;
  font-size: 13px;
  padding: 4px 8px;
  background: transparent;
}
</style>
