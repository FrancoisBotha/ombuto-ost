/*
 * Pure rules behind dropping a node in a gap: a node dropped level with a row of nodes of its own
 * type, and not on a node it could be re-parented under, takes the place its horizontal centre
 * landed in. No Vue, no DOM — unit tested on their own (drag-reorder.spec.ts).
 *
 * A gap is a place. The row may be the node's own siblings (the drop re-orders it), or the
 * same-type children of any other node it may go under (the drop moves it there, at that place):
 * a project dropped between two sub-projects of another project becomes their sibling, and a
 * sub-project dropped level with the top-level projects becomes a top-level project.
 *
 * A "row" is what the store orders together (ost-tree.store `moveNode`): the same-type children
 * of one parent, or the top-level projects. A project's outcomes come before its sub-projects, so a
 * sub-project only ever takes a place among sub-projects. The result is a parent and a `position`
 * for `tree.moveNode(key, parent, position)` — the same write Alt+Left / Alt+Right makes.
 */
import { GAP_X, type Placed, ROW_PITCH } from '../domain/layout';
import type { OstNode } from '../domain/types';

import { legalParents } from './edit-rules';

/** A sibling's laid-out box: centre x and width (flow units). */
export interface SiblingBox {
  id: string;
  x: number;
  w: number;
}

/** A row the dragged node can be dropped into, taken once when the drag starts. */
export interface SiblingRow {
  /** The OTHER nodes of the row, in order (left to right): never the dragged node. */
  others: SiblingBox[];
  /** Where the dragged node is now: how many of `others` come before it. -1: it is not in this row. */
  index: number;
  /** Top and height of the row (flow units). */
  y: number;
  h: number;
  /** The parent the row hangs under (null: the top-level projects). Absent: the dragged node's own. */
  parent?: string | null;
  /**
   * How far beyond the row's two ends a drop still counts as this row (flow units). Absent: any
   * distance — the node's own row, and the top-level row, which has its level to itself.
   */
  reach?: number;
}

/** Where a drop would put the node: its new index among `others`, and where to draw the marker. */
export interface ReorderDrop {
  position: number;
  /** Flow x of the insertion marker: the middle of the gap the node will land in. */
  x: number;
}

/** A drop in a gap: the row, the parent the node would get and its place there. */
export interface GapDrop extends ReorderDrop {
  row: SiblingRow;
  parent: string | null;
}

/** A drop counts as "level with its siblings" up to half a row above or below its own row. */
export const LEVEL_TOLERANCE = ROW_PITCH / 2;

const inOrder = (a: OstNode, b: OstNode) => a.sortOrder - b.sortOrder || a.dbId - b.dbId;

/**
 * Every row `dragKey` can be dropped into: its own siblings, and the same-type children of each
 * node it may be re-parented under (edit-rules `legalParents`: never its own subtree), plus — for a
 * project, when `showsTopLevel` — the top-level projects. A row counts only when all of it is on
 * the canvas: the children of a collapsed node are not, and neither are the top-level projects
 * while the picker shows a single project, so no drop is offered into a row that is not on screen.
 * A parent with no child of that type has no gap: drop the node on the parent itself.
 */
export function dropRows(dragKey: string, nodes: readonly OstNode[], placed: Record<string, Placed>, showsTopLevel: boolean): SiblingRow[] {
  const drag = nodes.find(n => n.id === dragKey);
  const box = placed[dragKey];
  if (!drag || !box) return [];
  const legal = legalParents(dragKey, nodes as OstNode[]);
  const groups = new Map<string | null, OstNode[]>();
  for (const n of nodes) {
    if (n.type !== drag.type || n.id === dragKey) continue;
    const own = n.parent === drag.parent;
    if (!own && (n.parent === null ? drag.type !== 'project' : !legal.has(n.parent))) continue;
    if (n.parent === null && !showsTopLevel) continue;
    const group = groups.get(n.parent);
    if (group) group.push(n);
    else groups.set(n.parent, [n]);
  }
  const rows: SiblingRow[] = [];
  for (const [parent, members] of groups) {
    if (members.some(n => !placed[n.id])) continue;
    members.sort(inOrder);
    const own = parent === drag.parent;
    rows.push({
      others: members.map(n => ({ id: n.id, x: placed[n.id].x, w: placed[n.id].w })),
      index: own ? members.filter(n => inOrder(n, drag) < 0).length : -1,
      y: own ? box.y : placed[members[0].id].y,
      h: box.h,
      parent,
      ...(own || parent === null ? {} : { reach: GAP_X + box.w }),
    });
  }
  return rows;
}

/**
 * Where the dragged node would land among `rows`: `centreX` is its horizontal centre where it is
 * held, `y` its top. The row is the one it is level with whose ends are nearest (its own row on a
 * tie); the place in it is `reorderDrop`'s. Null when it is level with no row, beyond the reach of
 * every row there, or the drop would change nothing — the caller then draws no marker and writes
 * nothing.
 */
export function gapDrop(rows: readonly SiblingRow[], centreX: number, y: number): GapDrop | null {
  if (!Number.isFinite(centreX) || !Number.isFinite(y)) return null;
  let best: { row: SiblingRow; distance: number } | null = null;
  for (const row of rows) {
    const first = row.others[0];
    const last = row.others.at(-1);
    if (!first || !last || Math.abs(y - row.y) > LEVEL_TOLERANCE) continue;
    const distance = Math.max(0, first.x - first.w / 2 - centreX, centreX - (last.x + last.w / 2));
    if (distance > (row.reach ?? Infinity)) continue;
    if (!best || distance < best.distance || (distance === best.distance && row.index >= 0)) best = { row, distance };
  }
  if (!best) return null;
  const drop = reorderDrop(best.row, centreX, y - best.row.y);
  return drop && best.row.parent !== undefined ? { ...drop, row: best.row, parent: best.row.parent } : null;
}

/**
 * Where the dragged node would land: `centreX` is its horizontal centre where it is held, `dy` how
 * far it is above (-) or below (+) its own row. Null when it is not level with its siblings or the
 * order would not change — the caller then draws no marker and writes nothing.
 */
export function reorderDrop(row: SiblingRow, centreX: number, dy: number): ReorderDrop | null {
  if (!Number.isFinite(centreX) || !Number.isFinite(dy) || Math.abs(dy) > LEVEL_TOLERANCE) return null;
  const position = row.others.filter(o => o.x < centreX).length;
  if (position === row.index) return null;
  const left = row.others[position - 1];
  const right = row.others[position];
  const leftEdge = left ? left.x + left.w / 2 : right.x - right.w / 2 - GAP_X;
  const rightEdge = right ? right.x - right.w / 2 : left.x + left.w / 2 + GAP_X;
  return { position, x: (leftEdge + rightEdge) / 2 };
}
