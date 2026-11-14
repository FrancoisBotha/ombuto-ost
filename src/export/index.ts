/*
 * Export of the current tree to PNG, SVG and Markdown.
 *
 * PLACEHOLDER MODULE: the three functions below are the whole public surface. The File menu
 * (src/ost/shell/FileMenu.vue) calls them with no arguments from its "Export" submenu and shows
 * the message of a rejected promise as an error toast, so replacing the bodies here is all it
 * takes to make the menu items work — the menu itself need not change.
 *
 * What an implementation can read (all synchronous, all local):
 * - the tree: `useOstTreeStore()` from '@/ost/stores/ost-tree.store' — `nodes` (every OstNode, in
 *   tree order), `roots` (the product or products of the current product view), `byId`, `ancestors`;
 * - positions: `layoutTree(nodes, { roots: roots.map(r => r.id), collapsed: {} })` and `edgePath`
 *   from '@/ost/domain/layout' (an empty `collapsed` lays out the whole tree, ignoring what is
 *   collapsed on screen); box sizes and labels in `TYPE_BOX`, colours and edge kinds as in
 *   '@/ost/canvas/OstNode.vue', '@/ost/canvas/OstEdge.vue' and `edgeKind` in canvas-model.ts;
 * - the document: `useDocumentStore()` from '@/doc/document.store' — `name`, and
 *   `service.snapshot()` for the plain document (nodes with notes, links and open questions);
 * - saving the result: `downloadFile(fileName, content, mimeType)` from '@/doc/file-access'.
 */

const notAvailable = (what: string) => new Error(`${what} export is not available yet.`);

/** Saves the current product view as an SVG image. */
export async function exportSvg(): Promise<void> {
  throw notAvailable('SVG');
}

/** Saves the current product view as a PNG image. */
export async function exportPng(): Promise<void> {
  throw notAvailable('PNG');
}

/** Saves the current product view as a Markdown outline. */
export async function exportMarkdown(): Promise<void> {
  throw notAvailable('Markdown');
}
