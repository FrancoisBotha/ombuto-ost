<template>
  <div class="ost-field">
    <div class="ost-field__label ost-field__label--split ost-field__label--7">
      <span :id="labelId">Colour</span><span data-cy="ost-color-label">{{ currentLabel }}</span>
    </div>
    <div ref="group" class="ost-colors" role="radiogroup" :aria-labelledby="labelId" data-cy="ost-colors" @keydown="onKeydown">
      <button
        v-for="option in OPTIONS"
        :key="option.id"
        type="button"
        role="radio"
        class="ost-colors__swatch ost-tap"
        :class="{ 'is-on': option.color === current }"
        :aria-checked="option.color === current"
        :aria-label="option.label"
        :title="option.label"
        :tabindex="option.color === current ? 0 : -1"
        :data-ost-color="option.color ?? undefined"
        :data-cy="`ost-color-${option.id}`"
        @click="pick(option.color)"
      >
        <PhCheck v-if="option.color === current" :size="13" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The node's background colour: a row of swatches, "Default" (the normal look of the node's type)
 * first, then the fixed palette of node-colors.ts. A radio group: one swatch is checked, each has
 * the colour's name as its accessible name and tooltip.
 *
 * Keyboard: Tab lands on the checked swatch; the arrow keys, Home and End move between swatches
 * WITHOUT choosing (each choice is a step in the undo history, so passing over five colours must
 * not leave five steps behind); Space or Enter chooses the focused one.
 *
 * The swatch gets its colours from the `data-ost-color` attribute (ost-tokens.css), like the node.
 */
import { computed, ref } from 'vue';

import { PhCheck } from '@phosphor-icons/vue';

import { DEFAULT_COLOR_LABEL, NODE_COLORS, NODE_COLOR_LABEL, type NodeColor, toNodeColor } from '../../domain/node-colors';

const props = defineProps<{ value: NodeColor | null | undefined }>();
const emit = defineEmits<{ change: [color: NodeColor | null] }>();

const OPTIONS: { id: string; color: NodeColor | null; label: string }[] = [
  { id: 'default', color: null, label: DEFAULT_COLOR_LABEL },
  ...NODE_COLORS.map(color => ({ id: color, color, label: NODE_COLOR_LABEL[color] })),
];

const labelId = `ost-color-${Math.random().toString(36).slice(2, 9)}`;
const group = ref<HTMLElement | null>(null);

const current = computed(() => toNodeColor(props.value));
const currentLabel = computed(() => (current.value ? NODE_COLOR_LABEL[current.value] : DEFAULT_COLOR_LABEL));

function pick(color: NodeColor | null) {
  if (color !== current.value) emit('change', color);
}

function onKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const swatches = Array.from(group.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
  const at = swatches.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  let next: number;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % swatches.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + swatches.length) % swatches.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = swatches.length - 1;
  else return;
  event.preventDefault();
  swatches[next].focus();
}
</script>

<style scoped>
.ost-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ost-colors__swatch {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  color: var(--color-text);
  border-radius: var(--radius-sm);
  /* "Default" carries no data-ost-color: it shows the plain surface a node normally has. */
  background: var(--node-fill, var(--color-surface));
  border: 1px solid var(--node-edge, var(--color-neutral-600));
}

.ost-colors__swatch:hover {
  border-width: 2px;
}

.ost-colors__swatch.is-on {
  border: 2px solid var(--color-text);
}
</style>
