<template>
  <div class="ost-link" :data-cy="`ost-link-row-${link.id}`">
    <div class="ost-link__head">
      <span class="ost-link__dot"></span>
      <input
        ref="nameInput"
        v-model="name"
        class="ost-input ost-link__name"
        aria-label="Link name"
        :maxlength="LINK_NAME_MAX"
        data-cy="ost-link-name"
        @focus="onFocus"
        @input="liveName.touch"
        @keydown.enter.prevent="blurTarget"
        @keydown.esc.prevent="cancel($event)"
        @blur="commitName"
      />
      <a
        v-if="openable"
        class="ost-link__open ost-tap"
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="`Open ${link.name}`"
        :aria-label="`Open ${link.name} in a new tab`"
        data-cy="ost-link-open"
      >
        <PhArrowSquareOut :size="13" aria-hidden="true" />
      </a>
      <button
        type="button"
        class="ost-link__remove ost-tap"
        title="Remove"
        :aria-label="`Remove ${link.name}`"
        data-cy="ost-link-remove"
        @click="emit('remove')"
      >
        <PhX :size="12" aria-hidden="true" />
      </button>
    </div>
    <input
      ref="urlInput"
      v-model="url"
      class="ost-input ost-link__url"
      aria-label="Link URL"
      placeholder="https://"
      :maxlength="LINK_URL_MAX"
      data-cy="ost-link-url"
      @focus="onFocus"
      @input="liveUrl.touch"
      @keydown.enter.prevent="blurTarget"
      @keydown.esc.prevent="cancel($event)"
      @blur="commitUrl"
    />
    <div v-if="invalid" class="ost-link__error" role="alert" data-cy="ost-link-error">{{ invalid }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * One link: name + URL, edited inline, openable, removable. A valid name or URL reaches the document
 * a moment after typing stops, and on Enter / blur (which is also when an invalid one is refused,
 * with the reason); Escape puts back the link the row had when the field was focused.
 * Only an http(s) or mailto URL is rendered as a clickable link: a file may carry anything, and
 * nothing else is ever put in an href.
 */
import { computed, ref, watch } from 'vue';

import { PhArrowSquareOut, PhX } from '@phosphor-icons/vue';

import { LINK_NAME_MAX, LINK_URL_MAX } from '@/doc/document';
import { useLiveCommit } from '@/doc/pending-edits';

import { isSafeLinkUrl } from '../../domain/rules';
import type { LinkRef } from '../../domain/types';
import { LINK_URL_RULE } from '../panel-format';

const props = defineProps<{ link: LinkRef }>();
const emit = defineEmits<{ save: [patch: { name?: string; url?: string }]; remove: [] }>();

const name = ref(props.link.name);
const url = ref(props.link.url);
const invalid = ref<string | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const urlInput = ref<HTMLInputElement | null>(null);
let cancelling = false;
/** The link when a field of the row took focus: what Escape goes back to. */
let initial = { name: props.link.name, url: props.link.url };

// While typing: only a value that would be accepted is saved; anything else waits for blur.
const liveName = useLiveCommit(() => {
  const next = name.value.trim();
  if (next && next !== props.link.name) emit('save', { name: next });
});
const liveUrl = useLiveCommit(() => {
  const next = url.value.trim();
  if (isSafeLinkUrl(next) && next !== props.link.url) emit('save', { url: next });
});

function onFocus() {
  initial = { name: props.link.name, url: props.link.url };
}

const openable = computed(() => isSafeLinkUrl(props.link.url));

const focused = (el: HTMLInputElement | null) => !!el && document.activeElement === el;

// Follow the stored link (the saved value, a rollback): each draft resets on its own field's
// change only, and never while the user is typing in it (a save of the other field must not
// wipe what is being typed here).
watch(
  () => props.link.name,
  n => {
    if (!focused(nameInput.value)) name.value = n;
  },
);
watch(
  () => props.link.url,
  u => {
    if (!focused(urlInput.value)) url.value = u;
  },
);

const blurTarget = (event: Event) => (event.target as HTMLElement).blur();

function cancel(event: KeyboardEvent) {
  cancelling = true;
  liveName.cancel();
  liveUrl.cancel();
  const undo: { name?: string; url?: string } = {};
  if (initial.name !== props.link.name) undo.name = initial.name;
  if (initial.url !== props.link.url) undo.url = initial.url;
  if (undo.name !== undefined || undo.url !== undefined) emit('save', undo);
  name.value = initial.name;
  url.value = initial.url;
  invalid.value = null;
  (event.target as HTMLInputElement).blur();
  cancelling = false;
}

function commitName() {
  liveName.cancel();
  if (cancelling) return;
  const next = name.value.trim();
  if (!next) {
    invalid.value = 'Link names cannot be empty.';
    name.value = props.link.name;
    return;
  }
  invalid.value = null;
  if (next !== props.link.name) emit('save', { name: next });
  else name.value = props.link.name;
}

function commitUrl() {
  liveUrl.cancel();
  if (cancelling) return;
  const next = url.value.trim();
  if (!isSafeLinkUrl(next)) {
    invalid.value = LINK_URL_RULE;
    url.value = props.link.url;
    return;
  }
  invalid.value = null;
  if (next !== props.link.url) emit('save', { url: next });
  else url.value = props.link.url;
}
</script>

<style scoped>
.ost-link {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid var(--color-neutral-800);
  border-radius: var(--radius-md);
}

.ost-link__head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.ost-link__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--color-neutral-500);
}

.ost-link .ost-link__name {
  flex: 1;
  min-width: 0;
  min-height: 26px;
  padding: 2px 6px;
  font-size: 12.5px;
  font-weight: 500;
  background: transparent;
  border-color: transparent;
}

.ost-link .ost-link__url {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--color-neutral-300);
  background: var(--color-surface);
}

.ost-link__open,
.ost-link__remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--radius-sm);
}

.ost-link__open {
  color: var(--color-accent-300);
}

.ost-link__remove {
  font: inherit;
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--color-neutral-500);
}

.ost-link__remove:hover {
  color: var(--color-accent-300);
}

.ost-link__error {
  font-size: 11px;
  color: var(--color-accent-300);
}
</style>
