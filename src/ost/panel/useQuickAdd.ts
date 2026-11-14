import { computed, ref } from 'vue';

import { ALLOWED } from '../domain/rules';
import type { NodeType } from '../domain/types';
import { useOstTreeStore } from '../stores/ost-tree.store';

import { usePanelAction } from './panel-action';

/**
 * Quick-add of a child under a node on the panel's Detail tab: the child types the node permits,
 * a busy flag (one create at a time) and `add(type)`, which creates through the tree store (it
 * selects the new node and puts it in rename mode) with failures reported in the panel's error
 * slot. Resolves to the new key or null.
 */
export function useQuickAdd(nodeKey: () => string) {
  const tree = useOstTreeStore();
  const { run } = usePanelAction();

  const addTypes = computed<NodeType[]>(() => {
    const node = tree.byId(nodeKey());
    return node ? ALLOWED[node.type] : [];
  });
  const adding = ref(false);

  async function add(type: NodeType): Promise<string | null> {
    if (adding.value) return null;
    adding.value = true;
    try {
      return await run(() => tree.createNode(nodeKey(), type), 'The node could not be created.');
    } finally {
      adding.value = false;
    }
  }

  return { addTypes, adding, add };
}
