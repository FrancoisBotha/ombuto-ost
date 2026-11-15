<template>
  <div v-if="node && hasFields" class="ost-node-fields" data-cy="ost-node-fields">
    <StatusChips v-if="statuses.length" :status="node.status" :options="statuses" @change="save({ status: $event })" />

    <template v-if="node.type === 'assumption'">
      <ConfidenceField :value="node.conf" @change="save({ conf: $event })" />
      <OwnerField :value="node.owner" @change="save({ owner: $event })" />
    </template>

    <EvidenceStrengthBar v-if="node.type === 'solution'" :node-key="node.id" />

    <template v-if="node.type === 'opportunity'">
      <ValueScale :value="node.value" @change="save({ value: $event })" />
      <PrioritySlider :value="node.priority" @change="save({ priority: $event })" />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * A node's typed fields on the panel's Detail tab: status chips (opportunity / solution /
 * assumption), confidence + owner (assumption), the derived evidence-strength bar (solution),
 * value + priority (opportunity). Every change is a tree-store patch run through the panel's
 * error slot (panel-action.ts).
 *
 * Renders nothing for types without such fields (project, outcome, evidence).
 */
import { computed } from 'vue';

import type { NodePatch } from '../../domain/mapping';
import { STATUS } from '../../domain/rules';
import { useOstTreeStore } from '../../stores/ost-tree.store';
import { usePanelAction } from '../panel-action';

import ConfidenceField from './ConfidenceField.vue';
import EvidenceStrengthBar from './EvidenceStrengthBar.vue';
import OwnerField from './OwnerField.vue';
import PrioritySlider from './PrioritySlider.vue';
import StatusChips from './StatusChips.vue';
import ValueScale from './ValueScale.vue';

const props = defineProps<{ nodeKey: string }>();

const tree = useOstTreeStore();
const { run } = usePanelAction();

const node = computed(() => tree.byId(props.nodeKey));
const statuses = computed(() => (node.value ? STATUS[node.value.type] : []));
const hasFields = computed(() => !!node.value && ['opportunity', 'solution', 'assumption'].includes(node.value.type));

function save(patch: NodePatch) {
  if (!node.value) return;
  const key = node.value.id;
  void run(() => tree.patchNode(key, patch));
}
</script>

<style scoped>
.ost-node-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
