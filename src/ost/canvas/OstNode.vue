<template>
  <div
    ref="root"
    class="ost-node"
    :class="[
      `ost-node--${node.type}`,
      {
        'is-selected': selected,
        'is-match': match,
        'is-dimmed': dimmed,
        'is-target': legalTarget,
        'is-drop': dropTarget,
        'is-editing': editing,
        'has-priority': isOpportunity,
      },
    ]"
    :style="{ width: `${box.w}px`, minHeight: `${box.h}px` }"
    :data-cy="`ost-node-${node.id}`"
    :data-node-key="node.id"
    :data-node-type="node.type"
    :data-drop-target="legalTarget ? 'true' : undefined"
    :data-drop-hover="dropTarget ? 'true' : undefined"
    tabindex="0"
    role="group"
    aria-roledescription="node"
    :aria-label="accessibleName"
    :aria-keyshortcuts="SHORTCUTS"
    @keydown="onKeydown"
  >
    <Handle type="target" :position="Position.Top" class="ost-node__handle" :connectable="false" />

    <div class="ost-node__kicker">{{ box.label }}</div>
    <!-- The + comes first in tab order (it is absolutely positioned top-right). -->
    <AddChildMenu
      v-if="canAdd && addMenuOpen"
      :parent-type="node.type"
      :parent-title="node.title"
      :trigger="addButton"
      :can-move-top="canMoveTop"
      @choose="emit('addChoose', $event)"
      @move-top="emit('moveTop')"
      @close="onMenuClose"
    />
    <button
      v-if="canAdd"
      ref="addButton"
      type="button"
      class="ost-node__add ost-hit nodrag nopan"
      :class="{ 'is-open': addMenuOpen }"
      :title="canMoveTop ? 'Add child, or move to top level' : 'Add child'"
      :aria-label="canMoveTop ? `Add a child under ${node.title}, or move it to the top level` : `Add a child under ${node.title}`"
      aria-haspopup="menu"
      :aria-expanded="addMenuOpen"
      :data-cy="`ost-node-add-${node.id}`"
      @click.stop="emit('add')"
    >
      +
    </button>
    <NodeTitleEditor
      v-if="editing"
      :type="node.type"
      :label="box.label.toLowerCase()"
      :value="editDraft ?? node.title"
      :error="editError"
      @commit="emit('renameCommit', $event)"
      @draft="emit('renameDraft', $event)"
      @cancel="emit('renameCancel')"
    />
    <div v-else class="ost-node__title" data-cy="ost-node-title" :title="node.title" @dblclick.stop="emit('rename')">{{ node.title }}</div>

    <div v-if="node.type !== 'project'" class="ost-node__meta">
      <span v-if="node.status" class="ost-node__badge" :class="`ost-node__badge--${tone}`" :data-tone="tone" data-cy="ost-node-status">{{
        node.status
      }}</span>
      <span v-if="node.type === 'assumption'" class="ost-node__metric" data-cy="ost-node-metric">{{ node.conf }}% confidence</span>
      <span v-else-if="isOpportunity" class="ost-node__money" title="Opportunity value" data-cy="ost-node-value"
        ><span class="ost-node__money-on">{{ '$'.repeat(value) }}</span
        ><span class="ost-node__money-off">{{ '$'.repeat(5 - value) }}</span></span
      >
    </div>

    <div
      v-if="isOpportunity"
      class="ost-node__priority"
      :title="`Priority ${node.priority} · ${priorityLabel(node.priority)}`"
      data-cy="ost-node-priority"
    >
      <i v-for="dot in priorityDots" :key="dot.step" :data-filled="dot.fill > 0" :data-color="dot.color" :style="dot.style" />
    </div>

    <button
      v-if="childCount > 0"
      type="button"
      class="ost-node__toggle ost-hit nodrag nopan"
      :class="{ 'is-collapsed': collapsed }"
      :title="collapsed ? `Expand (${childCount} ${childCount === 1 ? 'child' : 'children'})` : 'Collapse'"
      :aria-label="collapsed ? `Expand, ${childCount} ${childCount === 1 ? 'child' : 'children'}` : 'Collapse'"
      :aria-expanded="!collapsed"
      :data-cy="`ost-collapse-${node.id}`"
      @click.stop="emit('toggle')"
    >
      {{ collapsed ? `+${childCount}` : '–' }}
    </button>

    <Handle type="source" :position="Position.Bottom" class="ost-node__handle" :connectable="false" />
  </div>
</template>

<script setup lang="ts">
/**
 * One tree node on the canvas (Vue Flow custom node body). Type is carried by frame + fill weight,
 * never hue. Purely presentational: the canvas computes every flag from the stores and handles the
 * emitted events.
 *
 * One metric per type: assumptions show confidence, opportunities show value. A solution's evidence
 * strength belongs in the detail panel, not on the card.
 *
 * Editing: the `+` opens AddChildMenu, a double-click on the title (or F2) swaps in NodeTitleEditor,
 * and legal drop targets carry `is-target` / `data-drop-target` (the one under the pointer also
 * `is-drop`). The node itself is focusable: Enter/Space activates (select, or attach the armed
 * palette type), F2 renames, Delete asks to delete, Alt+Left / Alt+Right moves it among its
 * siblings, Alt+Up moves it out one level — the canvas decides what is allowed.
 */
import { computed, ref } from 'vue';

import { Handle, Position } from '@vue-flow/core';

import { statusTone } from '../domain/derive';
import { TYPE_BOX, priorityColor, priorityLabel } from '../domain/rules';
import type { NodeType, OstNode } from '../domain/types';

import AddChildMenu from './AddChildMenu.vue';
import NodeTitleEditor from './NodeTitleEditor.vue';

const props = withDefaults(
  defineProps<{
    node: OstNode;
    selected?: boolean;
    dimmed?: boolean;
    match?: boolean;
    /** a legal target for the node / palette type being dragged or armed */
    legalTarget?: boolean;
    /** the legal target currently under the pointer */
    dropTarget?: boolean;
    /** direct children (shown as +n when collapsed) */
    childCount?: number;
    collapsed?: boolean;
    /** only for types that permit children */
    canAdd?: boolean;
    addMenuOpen?: boolean;
    editing?: boolean;
    /** rename field start value and message (after a refused save); defaults to the title */
    editDraft?: string | null;
    editError?: string | null;
  }>(),
  {
    selected: false,
    dimmed: false,
    match: false,
    legalTarget: false,
    dropTarget: false,
    childCount: 0,
    collapsed: false,
    canAdd: false,
    addMenuOpen: false,
    editing: false,
    editDraft: null,
    editError: null,
  },
);

const emit = defineEmits<{
  add: [];
  addChoose: [type: NodeType];
  addClose: [];
  toggle: [];
  activate: [];
  rename: [];
  renameCommit: [title: string];
  /** a valid title typed so far, to store without closing the field */
  renameDraft: [title: string];
  renameCancel: [];
  delete: [];
  /** one place earlier (-1) or later (+1) among the node's siblings */
  reorder: [step: -1 | 1];
  /** out one level: from under its parent to under its parent's parent */
  outdent: [];
  /** a sub-project, to the top level (the + menu) */
  moveTop: [];
}>();

const SHORTCUTS = 'Enter F2 Delete Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp';

const root = ref<HTMLElement | null>(null);
const addButton = ref<HTMLButtonElement | null>(null);

const box = computed(() => TYPE_BOX[props.node.type]);
const isOpportunity = computed(() => props.node.type === 'opportunity');
/** A sub-project: its + menu also offers the way back to the top level. */
const canMoveTop = computed(() => props.node.type === 'project' && props.node.parent !== null);
const tone = computed(() => statusTone(props.node.status));
const value = computed(() => Math.min(5, Math.max(0, Math.round(props.node.value || 0))));

/** "Opportunity: Faster onboarding, exploring, selected" — type + title + status (+ state). */
const accessibleName = computed(() =>
  [`${box.value.label}: ${props.node.title}`, props.node.status, props.selected ? 'selected' : '', props.collapsed ? 'collapsed' : '']
    .filter(Boolean)
    .join(', '),
);

/** Keys on the node itself (not on its buttons or the rename field, which handle their own). */
function onKeydown(event: KeyboardEvent) {
  if (event.target !== root.value) return;
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) emit('reorder', event.key === 'ArrowLeft' ? -1 : 1);
  else if (event.altKey && event.key === 'ArrowUp') emit('outdent');
  else if (event.altKey || event.ctrlKey || event.metaKey) return;
  else if (event.key === 'Enter' || event.key === ' ') emit('activate');
  else if (event.key === 'F2') emit('rename');
  else if (event.key === 'Delete') emit('delete');
  else return;
  event.preventDefault();
  event.stopPropagation();
}

function onMenuClose(refocus: boolean) {
  emit('addClose');
  if (refocus) addButton.value?.focus({ preventScroll: true });
}

defineExpose({ focus: () => root.value?.focus({ preventScroll: true }) });

/** Five dots, top = highest band; each fills over its 20-point band and grows 4.5 → 7px. */
const priorityDots = computed(() =>
  [5, 4, 3, 2, 1].map(step => {
    const p = props.node.priority;
    const fill = Math.max(0, Math.min(1, (p - (step - 1) * 20) / 20));
    const size = (4.5 + fill * 2.5).toFixed(1);
    const color = fill > 0 ? priorityColor(p) : 'var(--color-neutral-800)';
    return {
      step,
      fill,
      color,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        background: color,
        opacity: fill > 0 ? String(0.35 + fill * 0.65) : '1',
      },
    };
  }),
);
</script>

<style scoped>
.ost-node {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 9px 11px 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-neutral-800);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-body);
  user-select: none;
  cursor: pointer;
  transition: opacity 0.18s ease;
}

/* ---- frames: type is carried by frame, never hue ------------------------------------------- */
.ost-node--project {
  background: var(--color-accent-900);
  border-color: var(--color-accent-700);
  justify-content: center;
}
.ost-node--outcome {
  background: var(--color-accent-900);
  border-color: var(--color-accent-600);
}
.ost-node--opportunity {
  background: var(--color-surface);
  border-color: var(--color-accent-500);
  padding-right: 20px;
}
.ost-node--solution {
  background: var(--color-neutral-900);
  border-color: var(--color-neutral-700);
}
.ost-node--assumption {
  background: transparent;
  border: 1px dashed var(--color-accent-500);
}
.ost-node--evidence {
  background: transparent;
  border-color: var(--color-neutral-800);
  font-style: italic;
}

/* ---- states ---------------------------------------------------------------------------------- */
/* The browser's own focus outline is replaced by the ring below. This rule comes BEFORE the state
   rules on purpose: a focused node keeps its selected / target / drop outline and match halo. */
.ost-node:focus-visible {
  outline: none;
}
.ost-node.is-match {
  border-style: solid;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-800);
}
.ost-node.is-target {
  outline: 1px dashed var(--color-accent-400);
  outline-offset: 3px;
  cursor: copy;
}
.ost-node.is-selected {
  border-color: var(--color-accent-300);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
  outline: 3px solid var(--color-accent-300);
  outline-offset: 2px;
  box-shadow:
    0 0 0 6px color-mix(in srgb, var(--color-accent) 22%, transparent),
    0 0 22px color-mix(in srgb, var(--color-accent) 30%, transparent);
}
/* The legal target under the pointer. */
.ost-node.is-drop {
  outline: 2px dashed var(--color-accent);
  outline-offset: 4px;
  background: var(--color-accent-800);
}
/*
 * Keyboard focus: a ring on its own layer (::after), 7–9px outside the border — beyond every state
 * outline (selected 2–5px, target 3–4px, drop 4–6px) and the match halo (0–3px), so it never hides
 * or replaces them. The pseudo-element is positioned from the padding box (1px border).
 */
.ost-node:focus-visible::after {
  content: '';
  position: absolute;
  inset: -10px;
  border: 2px solid var(--color-accent-300);
  border-radius: calc(var(--radius-md) + 8px);
  pointer-events: none;
}
.ost-node.is-dimmed {
  opacity: 0.24;
}

/* ---- content --------------------------------------------------------------------------------- */
.ost-node__kicker {
  font-family: var(--font-heading);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-style: normal;
  opacity: 0.7;
}

.ost-node__title {
  margin-top: 6px;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 15px;
  line-height: 1.18;
  text-wrap: pretty;
  overflow: hidden;
  overflow-wrap: anywhere;
  /* Clamped so a node never grows into the edge elbow below it (layout ROW_PITCH 156; the elbow
     sits halfway between the layout box bottom and the next row). The full title is the tooltip,
     the accessible name and the panel title. Types with a two-line meta row get two lines. */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}
.ost-node--project .ost-node__title,
.ost-node--solution .ost-node__title,
.ost-node--assumption .ost-node__title {
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.ost-node__meta {
  margin-top: auto;
  padding-top: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-style: normal;
}

.ost-node__badge {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  white-space: nowrap;
}
.ost-node__badge--good {
  background: var(--color-accent-800);
  color: var(--color-accent-200);
}
.ost-node__badge--flight {
  background: transparent;
  border-color: var(--color-accent-600);
  color: var(--color-accent-300);
}
.ost-node__badge--bad {
  background: var(--color-neutral-900);
  color: var(--color-neutral-300);
}

.ost-node__metric {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.7;
  min-width: 0; /* wraps ("20% / confidence") rather than overflow the card */
}
.ost-node__money {
  font-size: 11px;
  letter-spacing: -0.04em;
  white-space: nowrap;
}
.ost-node__money-on {
  color: var(--color-accent-300);
}
.ost-node__money-off {
  color: var(--color-neutral-700);
}

.ost-node__priority {
  position: absolute;
  right: 6px;
  top: 24px;
  bottom: 9px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
}
.ost-node__priority i {
  display: block;
  border-radius: 50%;
}

.ost-node__add {
  position: absolute;
  right: -1px;
  top: -1px;
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  padding: 0;
  font: inherit;
  font-style: normal;
  font-size: 13px;
  line-height: 1;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-neutral-700);
  color: var(--color-accent-300);
  cursor: pointer;
}
.ost-node__add:hover,
.ost-node__add.is-open {
  background: var(--color-accent-800);
  border-color: var(--color-accent-600);
  color: var(--color-accent-200);
}

.ost-node__toggle {
  position: absolute;
  left: 50%;
  bottom: -11px;
  transform: translateX(-50%);
  min-width: 24px;
  height: 20px;
  padding: 0 6px;
  font: inherit;
  font-style: normal;
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 0.04em;
  line-height: 1;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-neutral-800);
  cursor: pointer;
  z-index: 20;
}
.ost-node__toggle.is-collapsed {
  background: var(--color-accent-800);
  color: var(--color-accent-200);
  border-color: var(--color-accent-600);
}

.ost-node__handle {
  opacity: 0;
  pointer-events: none;
}
</style>
