/*
 * Export of the current tree to PNG, SVG and Markdown.
 *
 * The three functions below are the whole public surface: the File menu (src/ost/shell/FileMenu.vue)
 * calls them with no arguments and shows the message of a rejected promise as an error toast.
 *
 * This file is only the glue: it reads the stores, calls the pure builders (tree-svg.ts,
 * tree-markdown.ts) and hands the result to the browser. Each export covers the current product
 * view — one product or all of them — in full, whatever is collapsed or scrolled out of sight.
 * Nothing leaves the device: the file is built in memory and saved through a download.
 */
import { toRaw } from 'vue';

import { FILE_EXTENSION, cleanDocumentName, fileNameFor } from '@/doc/document';
import { useDocumentStore } from '@/doc/document.store';
import { downloadFile } from '@/doc/file-access';
import type { OstNode } from '@/ost/domain/types';
import { useOstTreeStore } from '@/ost/stores/ost-tree.store';

import { EXPORT_PALETTE } from './palette';
import { svgToPng } from './raster';
import { EXPORT_FONT_FAMILY, type MeasureText, estimateTextWidth } from './text';
import { treeToMarkdown } from './tree-markdown';
import { type TreeSvg, treeToSvg } from './tree-svg';

const EMPTY_TREE = 'There is nothing to export yet. Add a product to the tree first.';

/** "My tree" -> "My tree.svg": the document's file name with another extension. */
export function exportFileName(documentName: string, extension: string): string {
  return `${fileNameFor(documentName).slice(0, -FILE_EXTENSION.length)}.${extension}`;
}

interface ExportSource {
  name: string;
  nodes: OstNode[];
  rootIds: string[];
}

function currentTree(): ExportSource {
  const tree = useOstTreeStore();
  const rootIds = tree.roots.map(root => root.id);
  if (!rootIds.length) throw new Error(EMPTY_TREE);
  return { name: cleanDocumentName(useDocumentStore().name), nodes: toRaw(tree.nodes), rootIds };
}

/**
 * Measures text with the browser (the page has Inter loaded, the first font of the export's
 * stack); falls back to the estimate where there is no canvas.
 */
function browserMeasure(): MeasureText {
  const context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!context || typeof context.measureText !== 'function') return estimateTextWidth;
  return (text, font) => {
    context.font = `${font.italic ? 'italic ' : ''}${font.weight} ${font.size}px ${EXPORT_FONT_FAMILY}`;
    return context.measureText(text).width;
  };
}

function currentSvg(): { source: ExportSource; image: TreeSvg } {
  const source = currentTree();
  const image = treeToSvg(source.nodes, source.rootIds, { title: source.name, measure: browserMeasure() });
  if (!image) throw new Error(EMPTY_TREE);
  return { source, image };
}

/** Saves the current product view as an SVG image. */
export async function exportSvg(): Promise<void> {
  const { source, image } = currentSvg();
  downloadFile(exportFileName(source.name, 'svg'), image.svg, 'image/svg+xml');
}

/** Saves the current product view as a PNG image (twice the canvas size, less for a very large tree). */
export async function exportPng(): Promise<void> {
  const { source, image } = currentSvg();
  const png = await svgToPng(image.svg, image.width, image.height, EXPORT_PALETTE.bg);
  downloadFile(exportFileName(source.name, 'png'), png, 'image/png');
}

/** Saves the current product view as a Markdown outline. */
export async function exportMarkdown(): Promise<void> {
  const source = currentTree();
  const markdown = treeToMarkdown(source.name, source.nodes, source.rootIds);
  if (!markdown) throw new Error(EMPTY_TREE);
  downloadFile(exportFileName(source.name, 'md'), markdown, 'text/markdown;charset=utf-8');
}
