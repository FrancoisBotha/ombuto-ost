/*
 * The colours a node's background can be given: a fixed palette, named. A node with no colour has
 * the normal look of its type ("Default").
 *
 * The NAME is what the document stores (`"color": "teal"`), never a colour value, so the palette
 * can be tuned without touching anyone's files. The values live with the rest of the theme: the
 * pigments (`--ost-tint-<name>-fill` / `-edge`) in styles/theme.css, the roles (`--node-fill` /
 * `--node-edge`, set by a `data-ost-color` attribute) in styles/ost-tokens.css.
 *
 * `isNodeColor` is the one gate: nothing but a name from this list is ever stored, put in a
 * `data-ost-color` attribute or drawn in an export.
 */
export const NODE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'magenta', 'grey'] as const;

export type NodeColor = (typeof NODE_COLORS)[number];

/** The name shown to people (tooltip, accessible name). */
export const NODE_COLOR_LABEL: Record<NodeColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  magenta: 'Magenta',
  grey: 'Grey',
};

/** The name of "no colour": the node's normal look for its type. */
export const DEFAULT_COLOR_LABEL = 'Default';

export const isNodeColor = (value: unknown): value is NodeColor =>
  typeof value === 'string' && (NODE_COLORS as readonly string[]).includes(value);

/** A colour name from anywhere (a file, a DTO), or null when it is not one of ours. */
export const toNodeColor = (value: unknown): NodeColor | null => (isNodeColor(value) ? value : null);
