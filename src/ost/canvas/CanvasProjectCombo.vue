<template>
  <div ref="root" class="ost-project-combo">
    <button
      ref="trigger"
      type="button"
      class="ost-project-combo__button ost-hit"
      :class="{ 'is-open': open }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      data-cy="ost-project-combo"
      @click="open = !open"
      @keydown.down.prevent="openAndFocus(0)"
      @keydown.esc="close()"
    >
      <span class="ost-project-combo__label" data-cy="ost-project-combo-label">{{ current ? current.title : 'All projects' }}</span>
      <span class="ost-project-combo__meta">{{ current ? nodeCount(current.nodes) : projectCount }}</span>
      <PhCaretDown :size="12" class="ost-project-combo__caret" aria-hidden="true" />
    </button>
    <div v-if="open" class="ost-project-combo__menu" role="listbox" aria-label="Focus the canvas on a project" @keydown="onMenuKey">
      <button
        ref="options"
        type="button"
        role="option"
        class="ost-project-combo__option"
        :class="{ 'is-on': projectId === 'all' }"
        :aria-selected="projectId === 'all'"
        data-cy="ost-project-option-all"
        @click="choose('all')"
      >
        <span class="ost-project-combo__box" :class="{ 'is-on': projectId === 'all' }">
          <PhCheck v-if="projectId === 'all'" :size="11" aria-hidden="true" />
        </span>
        <span class="ost-project-combo__name">All projects</span>
        <span class="ost-project-combo__aside">{{ projectCount }}</span>
      </button>
      <i class="ost-project-combo__rule" aria-hidden="true"></i>
      <button
        v-for="project in projects"
        :key="project.id"
        ref="options"
        type="button"
        role="option"
        class="ost-project-combo__option"
        :class="{ 'is-on': projectId === project.id }"
        :aria-selected="projectId === project.id"
        :style="{ paddingLeft: `${OPTION_PAD + Math.min(project.depth, MAX_INDENT_LEVELS) * INDENT}px` }"
        :data-cy="`ost-project-option-${project.id}`"
        :data-depth="project.depth"
        @click="choose(project.id)"
      >
        <span class="ost-project-combo__radio" :class="{ 'is-on': projectId === project.id }" aria-hidden="true"></span>
        <span class="ost-project-combo__text">
          <span class="ost-project-combo__name">{{ project.title }}</span>
          <span class="ost-project-combo__sub">{{ project.depth ? 'Sub-project · ' : '' }}{{ nodeCount(project.nodes) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Project focus combo: "All projects" (checkbox row) or one project (radio rows). The rows come in
 * tree order and are indented by how deep the project is nested, so the list reads as the project
 * outline; choosing a project, top-level or nested, shows that project's subtree on the canvas.
 */
import { PhCaretDown, PhCheck } from '@phosphor-icons/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/** A row of the list: `depth` 0 is a top-level project, `nodes` counts everything below the project. */
export interface ProjectRow {
  id: string;
  title: string;
  depth: number;
  nodes: number;
}

const props = defineProps<{ projects: ProjectRow[]; projectId: string | 'all' }>();
const emit = defineEmits<{ select: [projectId: string | 'all'] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const options = ref<HTMLButtonElement[]>([]);

const current = computed(() => (props.projectId === 'all' ? null : (props.projects.find(p => p.id === props.projectId) ?? null)));
const projectCount = computed(() => `${props.projects.length} project${props.projects.length === 1 ? '' : 's'}`);
const nodeCount = (n: number) => `${n} node${n === 1 ? '' : 's'}`;

/** Left padding of a row (px), and what each level of nesting adds; deep nesting stops indenting. */
const OPTION_PAD = 9;
const INDENT = 16;
const MAX_INDENT_LEVELS = 8;

async function openAndFocus(index: number) {
  open.value = true;
  await nextTick();
  options.value[index]?.focus();
}

function close(returnFocus = false) {
  open.value = false;
  if (returnFocus) trigger.value?.focus();
}

function choose(projectId: string | 'all') {
  close(true);
  emit('select', projectId);
}

function onMenuKey(event: KeyboardEvent) {
  const i = options.value.findIndex(el => el === document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    close(true);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    options.value[Math.min(options.value.length - 1, i + 1)]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (i <= 0) trigger.value?.focus();
    else options.value[i - 1]?.focus();
  }
}

function onDocumentPointer(event: Event) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close();
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer));
</script>

<style scoped>
.ost-project-combo {
  position: relative;
}

.ost-project-combo__button {
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  color: var(--color-text);
  border: 1px solid var(--color-neutral-800);
  background: transparent;
}
.ost-project-combo__button.is-open {
  border-color: var(--color-accent-600);
  background: var(--color-accent-900);
}

.ost-project-combo__label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.ost-project-combo__meta,
.ost-project-combo__aside {
  font-size: 11px;
  color: var(--color-neutral-400);
  white-space: nowrap;
}

.ost-project-combo__aside {
  margin-left: auto;
}

.ost-project-combo__caret {
  opacity: 0.7;
  margin-left: 2px;
}

.ost-project-combo__menu {
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  min-width: 232px;
  max-width: min(420px, 90vw);
  max-height: min(60vh, 440px);
  overflow-y: auto;
  z-index: 70;
  padding: 5px;
  background: var(--color-surface);
  border: 1px solid var(--color-neutral-800);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ost-project-combo__option {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  flex: none;
  padding: 7px 9px;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
}
.ost-project-combo__option:hover {
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
}
.ost-project-combo__option.is-on {
  background: var(--color-accent-900);
}

.ost-project-combo__box {
  width: 15px;
  height: 15px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid var(--color-neutral-600);
  background: transparent;
  color: var(--color-bg);
}
.ost-project-combo__box.is-on {
  border-color: var(--color-accent-400);
  background: var(--color-accent-400);
}

.ost-project-combo__radio {
  width: 15px;
  height: 15px;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--color-neutral-600);
}
.ost-project-combo__radio.is-on {
  border-color: var(--color-accent-400);
  box-shadow:
    inset 0 0 0 3px var(--color-surface),
    inset 0 0 0 9px var(--color-accent-400);
}

.ost-project-combo__rule {
  height: 1px;
  background: var(--color-neutral-800);
  margin: 3px 8px;
}

.ost-project-combo__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ost-project-combo__name {
  font-size: 13px;
  font-weight: 500;
}

.ost-project-combo__sub {
  font-size: 10.5px;
  color: var(--color-neutral-400);
}
</style>
