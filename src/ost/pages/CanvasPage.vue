<template>
  <section class="ost-canvas-page" data-cy="ostCanvasPage">
    <CanvasToolbar
      :zoom="zoom"
      @project="chooseProject"
      @add-project="canvas?.addProject()"
      @zoom-in="canvas?.zoomIn()"
      @zoom-out="canvas?.zoomOut()"
      @fit="canvas?.fit()"
      @jump="jumpTo"
    />
    <div class="ost-canvas-page__body">
      <NodePalette :resolve-target="resolveAttachTarget" @attach="attachFromPalette" />
      <TreeCanvas ref="canvas" @select="selectFromCanvas" @zoom="zoom = $event" />
      <DetailPanel v-if="ui.selectedId" />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * The tree canvas page: toolbar (project focus, search, filters, zoom), node palette (left), the
 * canvas and the detail panel (right) of the selected node.
 *
 * With focus on the page (not in a field), Delete asks to delete the selected node. When the page
 * goes away the palette is disarmed and any palette drag ends, so no armed type or drop highlight
 * outlives the canvas.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import CanvasToolbar from '../canvas/CanvasToolbar.vue';
import NodePalette from '../canvas/NodePalette.vue';
import TreeCanvas from '../canvas/TreeCanvas.vue';
import type { NodeType } from '../domain/types';
import DetailPanel from '../panel/DetailPanel.vue';
import { useOstTreeStore } from '../stores/ost-tree.store';
import { useOstUiStore } from '../stores/ost-ui.store';

const tree = useOstTreeStore();
const ui = useOstUiStore();

const canvas = ref<InstanceType<typeof TreeCanvas> | null>(null);
const zoom = ref(1);

// The panel (breadcrumb, child list, quick-add) asks for a node to be centred.
watch(
  () => ui.centreRequest,
  req => req && centre(req.key),
);

/** A node outside the focused project (an ancestor in the breadcrumb) is not on the canvas: show every project first. */
function centre(key: string) {
  if (tree.byId(key) && !tree.inScope(key)) ui.setProject('all');
  return canvas.value?.centreOn(key);
}

onMounted(() => window.addEventListener('keydown', onKeydown));

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  if (ui.tool) ui.armTool(null);
  if (ui.paletteDrag || ui.dropTargetId) ui.endPaletteDrag();
});

function selectFromCanvas(key: string) {
  ui.select(key);
}

/** Keyboard jump from the search box: select the match and bring it into view (expanding collapsed ancestors). */
function jumpTo(key: string) {
  if (!tree.byId(key)) return;
  ui.select(key);
  void centre(key);
}

/** The canvas re-fits when the scope changes (TreeCanvas watches it). */
function chooseProject(projectId: string | 'all') {
  ui.setProject(projectId);
}

// ---- editing ------------------------------------------------------------------------------------
const resolveAttachTarget = (type: NodeType, x: number, y: number) => canvas.value?.resolveAttachTarget(type, x, y) ?? null;

function attachFromPalette(parentKey: string, type: NodeType) {
  void canvas.value?.createChild(parentKey, type);
}

/** Typing in a field, or a control that owns the key, never deletes a node. */
function ownsKeys(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === document.body) return false;
  if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  // Only the page itself, the canvas or its nodes (which handle Delete themselves) count as "the canvas".
  return !el.classList.contains('ost-canvas');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Delete' || event.defaultPrevented || !ui.selectedId) return;
  if (ui.confirmId || ownsKeys(event.target)) return;
  event.preventDefault();
  ui.askDelete(ui.selectedId);
}
</script>

<style scoped>
.ost-canvas-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ost-canvas-page__body {
  flex: 1;
  display: flex;
  min-height: 0;
}
</style>
