/*
 * Names from the first published build, in ONE place.
 *
 * That build called the top node type "product" (a product was always at the top of the tree). It
 * is now "project", and a project may hold other projects. The file format stayed on version 1,
 * so `.ost` files and browser working copies written by the old build still say
 * `"type": "product"`, and the collapsed branches it remembered are keyed "product-<id>".
 *
 * Everything read from outside goes through here on its way in:
 * - `currentNodeType`: a node's type, for a file being opened and for a working copy restored from
 *   IndexedDB, whichever tab's slot it is in (both go through `validateDocument` in document.ts);
 * - `currentNodeKey`: a remembered node key (the collapsed branches in localStorage, see
 *   ost-ui.store.ts).
 *
 * Nothing is ever written with the old name: the next save or autosave says "project".
 */
const LEGACY_NODE_TYPES = new Map<string, string>([['product', 'project']]);

/** The type name as this build knows it: "product" (first published build) becomes "project". */
export function currentNodeType(type: unknown): unknown {
  return typeof type === 'string' ? (LEGACY_NODE_TYPES.get(type) ?? type) : type;
}

/** A node key as this build writes it: "product-12" (first published build) becomes "project-12". */
export function currentNodeKey(key: string): string {
  const dash = key.indexOf('-');
  if (dash < 0) return key;
  return `${String(currentNodeType(key.slice(0, dash)))}${key.slice(dash)}`;
}
