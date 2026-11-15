/*
 * Pure rules behind drag-to-reorder: a node dropped level with its siblings, and not on a node it
 * could be re-parented under, takes the place its horizontal centre landed in. No Vue, no DOM —
 * unit tested on their own (drag-reorder.spec.ts).
 *
 * "Siblings" are what the store orders together (ost-tree.store `moveNode`): the same-type children
 * of one parent, or the top-level projects. A project's outcomes come before its sub-projects, so a
 * sub-project only ever changes place among sub-projects. The result is a `position` for
 * `tree.moveNode(key, parent, position)` — the same write Alt+Left / Alt+Right makes.
 */
import { GAP_X, type Placed, ROW_PITCH } from '../domain/layout';
import type { OstNode } from '../domain/types';

/** A sibling's laid-out box: centre x and width (flow units). */
export interface SiblingBox {
  id: string;
  x: number;
  w: number;
}

/** The dragged node's place among its siblings, taken once when the drag starts. */
export interface SiblingRow {
  /** The OTHER siblings, in order (left to right). */
  others: SiblingBox[];
  /** Where the dragged node is now: how many of `others` come before it. */
  index: number;
  /** Top and height of the row (the dragged node's layout box). */
  y: number;
  h: number;
}

/** Where a drop would put the node: its new index among `others`, and where to draw the marker. */
export interface ReorderDrop {
  position: number;
  /** Flow x of the insertion marker: the middle of the gap the node will land in. */
  x: number;
}

/** A drop counts as "level with its siblings" up to half a row above or below its own row. */
export const LEVEL_TOLERANCE = ROW_PITCH / 2;

/**
 * The siblings `dragKey` can change place with, or null when there is nothing to reorder: it has
 * none, or they are not all on the canvas. The latter is the project the picker is focused on — it
 * is the only root in view, so its siblings are not laid out and it stays where it is.
 */
export function siblingRow(dragKey: string, nodes: readonly OstNode[], placed: Record<string, Placed>): SiblingRow | null {
  const drag = nodes.find(n => n.id === dragKey);
  const box = placed[dragKey];
  if (!drag || !box) return null;
  const group = nodes
    .filter(n => n.parent === drag.parent && n.type === drag.type)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dbId - b.dbId);
  if (group.length < 2 || group.some(n => !placed[n.id])) return null;
  const others = group.filter(n => n !== drag).map(n => ({ id: n.id, x: placed[n.id].x, w: placed[n.id].w }));
  return { others, index: group.indexOf(drag), y: box.y, h: box.h };
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
