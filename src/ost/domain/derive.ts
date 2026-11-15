/*
 * Derived values — never stored. Pure functions over the flat node list so pages, the panel
 * and the store can share them (and they can be unit tested without a component).
 */
import { BAD_STATUS, GOOD_STATUS, evidenceStrength as ruleEvidenceStrength } from './rules';
import type { NodeType, OstNode } from './types';

/**
 * Sibling group order of the tree (and so of the tidy layout and the exports). A project's own
 * outcomes come before its sub-projects, so in an outline they are never read as part of the last
 * sub-project.
 */
export const CHILD_TYPE_ORDER: NodeType[] = ['outcome', 'project', 'opportunity', 'solution', 'assumption', 'evidence'];

export type PanelTab = 'detail' | 'links' | 'questions';

export type StatusTone = 'good' | 'flight' | 'bad';

/** The three status voices: settled-good, in-flight, settled-negative (see .ost-badge--*). */
export const statusTone = (status: string): StatusTone =>
  GOOD_STATUS.includes(status) ? 'good' : BAD_STATUS.includes(status) ? 'bad' : 'flight';

export const byKey = (nodes: OstNode[]): Map<string, OstNode> => new Map(nodes.map(n => [n.id, n]));

export function childrenOf(key: string, nodes: OstNode[]): OstNode[] {
  return nodes.filter(n => n.parent === key);
}

/**
 * Ancestors from the top-level project down to the direct parent. Excludes the node itself. A caller
 * that asks often passes its own key -> node index instead of the list, which is indexed per call.
 */
export function breadcrumb(key: string, nodes: OstNode[] | Map<string, OstNode>): OstNode[] {
  const index = nodes instanceof Map ? nodes : byKey(nodes);
  const trail: OstNode[] = [];
  const seen = new Set<string>([key]);
  let current = index.get(key);
  while (current?.parent) {
    const parent = index.get(current.parent);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}

/** Keys of every node below `key` (not including it). */
export function descendantIds(key: string, nodes: OstNode[]): string[] {
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent) continue;
    const list = kids.get(n.parent);
    if (list) list.push(n.id);
    else kids.set(n.parent, [n.id]);
  }
  const out: string[] = [];
  const stack = [...(kids.get(key) ?? [])];
  const seen = new Set<string>([key]);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** Evidence strength for a solution (see rules.ts); null score when it has no assumptions. */
export function evidenceStrength(solutionKey: string, nodes: OstNode[]) {
  return ruleEvidenceStrength(solutionKey, nodes);
}

export function countByType(nodes: OstNode[]): Record<NodeType, number> {
  const counts: Record<NodeType, number> = { project: 0, outcome: 0, opportunity: 0, solution: 0, assumption: 0, evidence: 0 };
  for (const n of nodes) counts[n.type]++;
  return counts;
}

const compareSiblings = (a: OstNode, b: OstNode) =>
  CHILD_TYPE_ORDER.indexOf(a.type) - CHILD_TYPE_ORDER.indexOf(b.type) || a.sortOrder - b.sortOrder || a.dbId - b.dbId;

/**
 * Re-orders a flat list into tree pre-order: top-level projects by sortOrder, then each node's
 * children grouped outcome -> project -> opportunity -> solution -> assumption -> evidence, each by
 * sortOrder, id. Orphans (parent missing) are kept at the end so nothing is silently lost.
 */
export function orderTree(nodes: OstNode[]): OstNode[] {
  const kids = new Map<string, OstNode[]>();
  const roots: OstNode[] = [];
  const keys = new Set(nodes.map(n => n.id));
  for (const n of nodes) {
    if (!n.parent) roots.push(n);
    else if (keys.has(n.parent)) {
      const list = kids.get(n.parent);
      if (list) list.push(n);
      else kids.set(n.parent, [n]);
    }
  }
  roots.sort((a, b) => a.sortOrder - b.sortOrder || a.dbId - b.dbId);
  const out: OstNode[] = [];
  const seen = new Set<string>();
  const walk = (n: OstNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    for (const k of (kids.get(n.id) ?? []).sort(compareSiblings)) walk(k);
  };
  roots.forEach(walk);
  for (const n of nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

/** Which detail-panel tabs a node type gets (Open Qs: opportunities only). */
export function panelTabsFor(type: NodeType): PanelTab[] {
  return type === 'opportunity' ? ['detail', 'links', 'questions'] : ['detail', 'links'];
}
