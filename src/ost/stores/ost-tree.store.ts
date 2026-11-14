import { computed, ref, toRaw } from 'vue';

import { defineStore } from 'pinia';

import type LocalDocumentService from '@/doc/local-document-service';

import { breadcrumb, descendantIds, orderTree } from '../domain/derive';
import { layoutTree } from '../domain/layout';
import { type NodePatch, fromDto, parseKey, toApiType, toPatchBody } from '../domain/mapping';
import { ALLOWED, canReparent } from '../domain/rules';
import type { NodeType, OstNode } from '../domain/types';
import { RuleError, describeError } from '../ost-errors';
import type { TreeNodeDTO } from '../ost.model';

import { useOstUiStore } from './ost-ui.store';

/** The tree store's only way to the document: the methods of the local document service it calls. */
export type OstService = Pick<
  LocalDocumentService,
  | 'getTree'
  | 'createNode'
  | 'patchNode'
  | 'moveNode'
  | 'deleteNode'
  | 'addLink'
  | 'updateLink'
  | 'deleteLink'
  | 'addQuestion'
  | 'updateQuestion'
  | 'deleteQuestion'
>;

export type OstServiceFactory = () => OstService;

type PatchField = keyof NodePatch;
const PATCH_FIELDS: PatchField[] = ['title', 'note', 'status', 'conf', 'priority', 'value', 'owner'];

/**
 * The open document's tree: flat nodes (pre-order, parent pointers) and every action on them.
 * Each action goes through the document service, which enforces the tree's rules; edits and moves
 * are applied at once and rolled back, with a message, when the service refuses them.
 * View state (selection, collapse, scope, ...) lives in ost-ui.store.ts.
 */
export const useOstTreeStore = defineStore('ostTree', () => {
  /** Set by the document store, which owns the service and the document behind it. */
  let serviceFactory: OstServiceFactory | null = null;
  const api = (): OstService => {
    if (!serviceFactory) throw new RuleError('nodocument');
    return serviceFactory();
  };

  // ---- state -----------------------------------------------------------------------------------
  const nodes = ref<OstNode[]>([]);
  /** A document's tree is on screen (false until the first load, and after reset). */
  const loaded = ref(false);
  /** Last failed action, surfaced to the user; cleared by clearError(). */
  const error = ref<string | null>(null);

  // ---- getters -----------------------------------------------------------------------------------
  const index = computed(() => new Map(nodes.value.map(n => [n.id, n])));
  const byId = (key: string | null | undefined): OstNode | undefined => (key ? index.value.get(key) : undefined);
  const products = computed(() => nodes.value.filter(n => n.type === 'product'));
  const selected = computed(() => byId(useOstUiStore().selectedId));
  /** Products in scope: all of them or the one chosen in the product combo. */
  const roots = computed(() => {
    const ui = useOstUiStore();
    return products.value.filter(p => ui.productId === 'all' || p.id === ui.productId);
  });
  /**
   * Derived positions (tidy layout) — never stored, never user-set. Depends only on membership,
   * order and parent pointers: those are read through the reactive list (so they are tracked),
   * then the layout runs over the raw objects to keep proxy overhead out of its inner loops.
   */
  const placed = computed(() => {
    const list = nodes.value;
    for (const n of list) void n.parent;
    return layoutTree(toRaw(list), {
      roots: roots.value.map(r => r.id),
      collapsed: useOstUiStore().collapsed,
    });
  });
  /** Descendant count of every node, computed once per structural change (O(n)). */
  const descendantCounts = computed(() => {
    const list = nodes.value;
    const kids = new Map<string, string[]>();
    for (const n of list) {
      if (!n.parent) continue;
      const bucket = kids.get(n.parent);
      if (bucket) bucket.push(n.id);
      else kids.set(n.parent, [n.id]);
    }
    const counts = new Map<string, number>();
    const visiting = new Set<string>();
    const count = (key: string): number => {
      const known = counts.get(key);
      if (known !== undefined) return known;
      if (visiting.has(key)) return 0; // corrupt (cyclic) data: never loop
      visiting.add(key);
      let total = 0;
      for (const child of kids.get(key) ?? []) total += 1 + count(child);
      visiting.delete(key);
      counts.set(key, total);
      return total;
    };
    for (const n of list) count(n.id);
    return counts;
  });
  const descendantCount = (key: string) => descendantCounts.value.get(key) ?? 0;
  const ancestors = (key: string) => breadcrumb(key, index.value);
  /**
   * The product every node hangs under, computed once per structural change (O(n)): the list is
   * in tree order, so a node's parent is always seen before the node.
   */
  const rootIds = computed(() => {
    const list = nodes.value;
    for (const n of list) void n.parent;
    const roots = new Map<string, string>();
    for (const n of toRaw(list)) roots.set(n.id, (n.parent && roots.get(n.parent)) || n.id);
    return roots;
  });
  /** Key of the product `key` belongs to (itself for a product). */
  const rootOf = (key: string): string => rootIds.value.get(key) ?? key;

  // ---- helpers -----------------------------------------------------------------------------------
  const fail = (err: unknown, fallback?: string, type?: NodeType) => {
    error.value = describeError(err, fallback, type);
  };

  /** Same-type children of one parent (products: every product), in order. */
  const siblingsOf = (node: OstNode, parent: string | null) =>
    nodes.value
      .filter(n => n.parent === parent && n.type === node.type && n.id !== node.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.dbId - b.dbId);

  /** Drops a node and its subtree locally, with every piece of view state that refers to them. */
  function removeSubtree(key: string) {
    const doomed = new Set([key, ...descendantIds(key, nodes.value)]);
    nodes.value = nodes.value.filter(n => !doomed.has(n.id));
    useOstUiStore().forgetNodes(doomed);
  }

  /** Adds a node the service just created, selects it and puts it in rename mode. */
  function adopt(created: OstNode) {
    nodes.value = orderTree([...nodes.value.filter(n => n.id !== created.id), created]);
    const ui = useOstUiStore();
    ui.select(created.id);
    ui.startEditing(created.id);
  }

  // ---- actions: configuration ----------------------------------------------------------------
  function setServiceFactory(factory: OstServiceFactory) {
    serviceFactory = factory;
  }
  function clearError() {
    error.value = null;
  }
  function reset() {
    nodes.value = [];
    loaded.value = false;
    error.value = null;
  }

  // ---- actions: read -------------------------------------------------------------------------
  /**
   * Turns a document's nodes into the tree the canvas shows, and proves that tree can be laid out.
   * Changes nothing in the store. Throws when the tree cannot be built: the caller must then leave
   * whatever is open as it is.
   */
  function prepare(dtos: TreeNodeDTO[]): OstNode[] {
    const ordered = orderTree(dtos.map(fromDto));
    layoutTree(ordered, { roots: ordered.filter(n => n.type === 'product').map(n => n.id), collapsed: {} });
    return ordered;
  }

  /**
   * Puts a prepared tree on screen with a clean view. `keepCollapsed` is for the document this tab
   * was already working on (restored after a reload): its collapsed branches are restored. Any
   * other document starts fully expanded. Cannot fail.
   */
  function install(ordered: OstNode[], options: { keepCollapsed?: boolean } = {}) {
    const ui = useOstUiStore();
    reset();
    ui.reset();
    nodes.value = ordered;
    if (options.keepCollapsed) {
      ui.restoreCollapsed();
      ui.pruneCollapsed(new Set(ordered.map(n => n.id)));
    } else {
      ui.persistCollapsed();
    }
    loaded.value = true;
  }

  /** Reads the open document's tree and shows it (see `install`). False, with a message, when it cannot. */
  async function loadTree(options: { keepCollapsed?: boolean } = {}): Promise<boolean> {
    let ordered: OstNode[];
    try {
      ordered = prepare(await api().getTree());
    } catch (err) {
      reset();
      useOstUiStore().reset();
      fail(err, 'The tree could not be opened.');
      return false;
    }
    install(ordered, options);
    return true;
  }

  // ---- actions: nodes ------------------------------------------------------------------------
  /** Field patch, shown at once; rolled back with a message when the service refuses it. */
  async function patchNode(key: string, patch: NodePatch): Promise<boolean> {
    const node = byId(key);
    const parsed = parseKey(key);
    const fields = (Object.keys(patch) as PatchField[]).filter(f => PATCH_FIELDS.includes(f));
    if (!node || !parsed || !fields.length) return false;
    const before = Object.fromEntries(fields.map(f => [f, node[f]]));
    Object.assign(node, patch);
    try {
      const fresh = fromDto(await api().patchNode(parsed.type, parsed.id, toPatchBody(patch)));
      const current = byId(key);
      if (current) {
        // The stored values (trimmed title, cleaned owner) replace what was typed.
        for (const f of PATCH_FIELDS) (current as any)[f] = fresh[f];
        current.lastModifiedDate = fresh.lastModifiedDate;
      }
      return true;
    } catch (err) {
      const current = byId(key);
      if (current) Object.assign(current, before);
      fail(err, undefined, node.type);
      return false;
    }
  }

  /**
   * Creates a child (first allowed type when none given), then selects the new node and puts it in
   * rename mode. Returns the new key, or null on failure.
   */
  async function createNode(parentKey: string, type?: NodeType, title?: string): Promise<string | null> {
    const parent = byId(parentKey);
    const parsed = parseKey(parentKey);
    if (!parent || !parsed) return null;
    const childType = type ?? ALLOWED[parent.type][0];
    if (!childType || !ALLOWED[parent.type].includes(childType)) {
      error.value = 'That node cannot go there.';
      return null;
    }
    try {
      const dto = await api().createNode({
        type: toApiType(childType),
        parentType: toApiType(parent.type),
        parentId: parsed.id,
        ...(title ? { title } : {}),
      });
      const ui = useOstUiStore();
      if (ui.collapsed[parentKey]) ui.setCollapsed(parentKey, false);
      const created = fromDto(dto);
      adopt(created);
      return created.id;
    } catch (err) {
      fail(err, 'The node could not be created.');
      return null;
    }
  }

  /**
   * Creates a product (a new branch, placed last), selects it and puts it in rename mode. A canvas
   * scoped to one product switches to the new one so it is on screen. Returns the new key, or null.
   */
  async function createProduct(title?: string): Promise<string | null> {
    try {
      const dto = await api().createNode({ type: 'PRODUCT', parentType: null, parentId: null, ...(title ? { title } : {}) });
      const created = fromDto(dto);
      const ui = useOstUiStore();
      if (ui.productId !== 'all') ui.setProduct(created.id);
      adopt(created);
      return created.id;
    } catch (err) {
      fail(err, 'The product could not be created.', 'product');
      return null;
    }
  }

  /**
   * Re-parents `key` under `targetKey`, or reorders it among its siblings when `targetKey` is its
   * current parent and a `position` is given (products: `targetKey` null). `position` is a
   * zero-based index among the target's same-type children; omitted = last.
   */
  async function moveNode(key: string, targetKey: string | null, position?: number): Promise<boolean> {
    const node = byId(key);
    const parsed = parseKey(key);
    if (!node || !parsed) return false;
    let target: OstNode | undefined;
    if (targetKey === null) {
      if (node.type !== 'product') return false;
    } else {
      target = byId(targetKey);
      if (!target) return false;
      const reorderOnly = node.parent === targetKey && position !== undefined;
      if (!reorderOnly && !canReparent(key, targetKey, nodes.value)) {
        error.value = 'That node cannot go there.';
        return false;
      }
    }
    const before = { parent: node.parent, sortOrder: node.sortOrder };
    // Shown at once: `position` is a zero-based index among the new parent's same-type children.
    const newParent = target ? target.id : null;
    const siblings = siblingsOf(node, newParent);
    node.parent = newParent;
    if (position !== undefined && position < siblings.length) {
      node.sortOrder = siblings[Math.max(0, position)].sortOrder - 0.5;
    } else {
      node.sortOrder = (siblings.at(-1)?.sortOrder ?? 0) + 1;
    }
    nodes.value = orderTree(nodes.value);
    try {
      const res = await api().moveNode({
        nodeType: toApiType(node.type),
        nodeId: parsed.id,
        parentType: target ? toApiType(target.type) : null,
        parentId: target ? target.dbId : null,
        ...(position !== undefined ? { position } : {}),
      });
      const fresh = fromDto(res.node);
      const current = byId(key);
      if (current) {
        current.parent = fresh.parent;
        current.sortOrder = fresh.sortOrder;
        current.lastModifiedDate = fresh.lastModifiedDate;
      }
      for (const s of res.siblings ?? []) {
        const sib = byId(s.key);
        if (sib) sib.sortOrder = s.sortOrder;
      }
      nodes.value = orderTree(nodes.value);
      if (target) {
        const ui = useOstUiStore();
        if (ui.collapsed[target.id]) ui.setCollapsed(target.id, false);
      }
      return true;
    } catch (err) {
      const current = byId(key);
      if (current) {
        current.parent = before.parent;
        current.sortOrder = before.sortOrder;
        nodes.value = orderTree(nodes.value);
      }
      fail(err, 'The node could not be moved.');
      return false;
    }
  }

  /**
   * Moves a node one place earlier (`step` -1) or later (+1) among its same-type siblings — the
   * keyboard way to reorder. Returns false when it is already first / last.
   */
  async function reorderNode(key: string, step: -1 | 1): Promise<boolean> {
    const node = byId(key);
    if (!node) return false;
    const others = siblingsOf(node, node.parent);
    const at = others.filter(n => n.sortOrder < node.sortOrder || (n.sortOrder === node.sortOrder && n.dbId < node.dbId)).length;
    const next = at + step;
    if (next < 0 || next > others.length) return false;
    return moveNode(key, node.parent, next);
  }

  /** Deletes a node and its subtree. */
  async function deleteNode(key: string): Promise<boolean> {
    const node = byId(key);
    const parsed = parseKey(key);
    if (!node || !parsed) return false;
    try {
      await api().deleteNode(parsed.type, parsed.id);
    } catch (err) {
      fail(err, 'The node could not be deleted.');
      return false;
    }
    removeSubtree(key);
    return true;
  }

  // ---- actions: links --------------------------------------------------------------------------
  async function addLink(key: string, link: { name: string; url: string }): Promise<boolean> {
    const node = byId(key);
    const parsed = parseKey(key);
    if (!node || !parsed) return false;
    try {
      const dto = await api().addLink(parsed.type, parsed.id, link);
      byId(key)?.links.push({ id: dto.id, name: dto.name, url: dto.url });
      return true;
    } catch (err) {
      fail(err, 'The link could not be added.');
      return false;
    }
  }

  async function updateLink(key: string, linkId: number, patch: { name?: string; url?: string }): Promise<boolean> {
    const link = byId(key)?.links.find(l => l.id === linkId);
    if (!link) return false;
    const snapshot = { name: link.name, url: link.url };
    Object.assign(link, patch);
    try {
      const dto = await api().updateLink(linkId, patch);
      Object.assign(link, { name: dto.name, url: dto.url });
      return true;
    } catch (err) {
      Object.assign(link, snapshot);
      fail(err, 'The link could not be saved.');
      return false;
    }
  }

  async function removeLink(key: string, linkId: number): Promise<boolean> {
    const node = byId(key);
    const i = node?.links.findIndex(l => l.id === linkId) ?? -1;
    if (!node || i < 0) return false;
    try {
      await api().deleteLink(linkId);
    } catch (err) {
      fail(err, 'The link could not be removed.');
      return false;
    }
    node.links.splice(i, 1);
    return true;
  }

  // ---- actions: open questions -------------------------------------------------------------------
  async function addQuestion(key: string, text: string): Promise<boolean> {
    const node = byId(key);
    if (!node || node.type !== 'opportunity') return false;
    try {
      const dto = await api().addQuestion(node.dbId, text);
      byId(key)?.questions.push({ id: dto.id, text: dto.text, done: !!dto.done });
      return true;
    } catch (err) {
      fail(err, 'The question could not be added.');
      return false;
    }
  }

  async function updateQuestion(key: string, questionId: number, patch: { text?: string; done?: boolean }): Promise<boolean> {
    const question = byId(key)?.questions.find(q => q.id === questionId);
    if (!question) return false;
    const snapshot = { text: question.text, done: question.done };
    Object.assign(question, patch);
    try {
      const dto = await api().updateQuestion(questionId, patch);
      Object.assign(question, { text: dto.text, done: !!dto.done });
      return true;
    } catch (err) {
      Object.assign(question, snapshot);
      fail(err, 'The question could not be saved.');
      return false;
    }
  }

  async function removeQuestion(key: string, questionId: number): Promise<boolean> {
    const node = byId(key);
    const i = node?.questions.findIndex(q => q.id === questionId) ?? -1;
    if (!node || i < 0) return false;
    try {
      await api().deleteQuestion(questionId);
    } catch (err) {
      fail(err, 'The question could not be removed.');
      return false;
    }
    node.questions.splice(i, 1);
    return true;
  }

  return {
    // state
    nodes,
    loaded,
    error,
    // getters
    byId,
    products,
    selected,
    roots,
    placed,
    descendantCount,
    ancestors,
    rootOf,
    // actions
    setServiceFactory,
    clearError,
    reset,
    prepare,
    install,
    loadTree,
    patchNode,
    createNode,
    createProduct,
    moveNode,
    reorderNode,
    deleteNode,
    addLink,
    updateLink,
    removeLink,
    addQuestion,
    updateQuestion,
    removeQuestion,
  };
});
