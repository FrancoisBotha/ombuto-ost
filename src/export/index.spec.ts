import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FileAccess from '@/doc/file-access';
import { downloadFile } from '@/doc/file-access';
import { exampleRecord, setupShellStores } from '@/ost/shell/shell.test-util';

import { exportFileName, exportMarkdown, exportPng, exportSvg } from './index';
import { EXPORT_PALETTE } from './palette';
import type * as Raster from './raster';
import { svgToPng } from './raster';

vi.mock('@/doc/file-access', async importOriginal => ({
  ...(await importOriginal<typeof FileAccess>()),
  downloadFile: vi.fn(),
}));
vi.mock('./raster', async importOriginal => ({
  ...(await importOriginal<typeof Raster>()),
  svgToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));

const saved = vi.mocked(downloadFile);
const rasterise = vi.mocked(svgToPng);

const EMPTY = 'There is nothing to export yet. Add a project to the tree first.';

/** Stores with the example tree open. */
async function withExample() {
  const ctx = setupShellStores(exampleRecord());
  await ctx.doc.init();
  expect(ctx.tree.nodes.length).toBeGreaterThan(5);
  return ctx;
}

describe('exportFileName', () => {
  it('derives the file name from the document name', () => {
    expect(exportFileName('My tree', 'svg')).toBe('My tree.svg');
    expect(exportFileName('Example: meal-planning app', 'png')).toBe('Example meal-planning app.png');
  });

  it('replaces what a file system refuses', () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', 'md')).toBe('a b c d e f g h i j.md');
    expect(exportFileName('../../etc/passwd', 'svg')).toBe('.. .. etc passwd.svg');
    expect(exportFileName('trailing dots...', 'svg')).toBe('trailing dots.svg');
  });

  it('falls back to the default name', () => {
    expect(exportFileName('', 'md')).toBe('Untitled tree.md');
    expect(exportFileName(' /// ', 'md')).toBe('Untitled tree.md');
  });
});

describe('export (File menu actions)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to export when no document is open', async () => {
    setupShellStores();
    await expect(exportSvg()).rejects.toThrow(EMPTY);
    await expect(exportPng()).rejects.toThrow(EMPTY);
    await expect(exportMarkdown()).rejects.toThrow(EMPTY);
    expect(saved).not.toHaveBeenCalled();
  });

  it('refuses to export a tree with no project', async () => {
    const record = exampleRecord();
    record.doc.nodes = [];
    const { doc } = setupShellStores(record);
    await doc.init();
    await expect(exportSvg()).rejects.toThrow(EMPTY);
    await expect(exportMarkdown()).rejects.toThrow(EMPTY);
    expect(saved).not.toHaveBeenCalled();
  });

  it('saves the tree as an SVG image named after the document', async () => {
    const { tree } = await withExample();
    await exportSvg();
    expect(saved).toHaveBeenCalledTimes(1);
    const [fileName, content, type] = saved.mock.calls[0];
    expect(fileName).toBe('Example meal-planning app.svg');
    expect(type).toBe('image/svg+xml');
    const svg = content as string;
    expect(svg).toContain('<title>Example: meal-planning app</title>');
    for (const n of tree.nodes) expect(svg).toContain(n.title.split(' ')[0]);
  });

  it('exports the whole tree whatever is collapsed on screen', async () => {
    const { tree, ui } = await withExample();
    await exportSvg();
    const full = saved.mock.calls[0][1] as string;
    for (const n of tree.nodes) ui.collapsed[n.id] = true;
    await exportSvg();
    expect(saved.mock.calls[1][1]).toBe(full);
  });

  it('exports only the project chosen in the project picker', async () => {
    const record = exampleRecord();
    record.doc.nodes.push({ ...record.doc.nodes[0], id: 900, title: 'Other project', sortOrder: 1, links: [], questions: [] });
    const { doc, tree, ui } = setupShellStores(record);
    await doc.init();
    const other = tree.nodes.find(n => n.title === 'Other project')!;

    await exportMarkdown();
    expect(saved.mock.calls[0][1]).toContain('## Project: Other project');
    expect(saved.mock.calls[0][1]).toContain('## Project: Meal-planning app');

    ui.setProject(other.id);
    await exportMarkdown();
    await exportSvg();
    expect(saved.mock.calls[1][1]).toContain('## Project: Other project');
    expect(saved.mock.calls[1][1]).not.toContain('Meal-planning app\n');
    expect(saved.mock.calls[2][1]).toContain('>Other project</text>');
    expect(saved.mock.calls[2][1]).not.toContain('>Meal-planning app</text>');
  });

  it('exports the subtree of a focused sub-project, in every format', async () => {
    const { tree, ui } = await withExample();
    const shopping = tree.projects.find(p => p.title === 'Shopping list')!;
    expect(shopping.parent).toBe('project-1');
    ui.setProject(shopping.id);
    await exportMarkdown();
    await exportSvg();
    const markdown = saved.mock.calls[0][1] as string;
    expect(markdown).toContain('\n## Project: Shopping list\n\nSub-project of: Meal-planning app\n');
    expect(markdown).toContain('- **Outcome:** Fewer forgotten ingredients per shop');
    expect(markdown).not.toContain('Weekly planner');
    expect(markdown).not.toContain('Households still plan after the first month');
    const svg = saved.mock.calls[1][1] as string;
    expect(svg).toContain('>Shopping list</text>');
    expect(svg).not.toContain('>Weekly planner</text>');
    expect(svg).not.toContain('>Meal-planning app</text>');

    // All projects: the nested projects are drawn and outlined under their parent.
    ui.setProject('all');
    await exportMarkdown();
    await exportSvg();
    const all = saved.mock.calls[2][1] as string;
    expect(all.indexOf('## Project: Meal-planning app')).toBeLessThan(all.indexOf('### Project: Weekly planner'));
    expect(all.indexOf('### Project: Weekly planner')).toBeLessThan(all.indexOf('### Project: Shopping list'));
    for (const title of ['Meal-planning app', 'Weekly planner', 'Shopping list'])
      expect(saved.mock.calls[3][1]).toContain(`>${title}</text>`);
  });

  it('saves the tree as a Markdown outline', async () => {
    await withExample();
    await exportMarkdown();
    const [fileName, content, type] = saved.mock.calls[0];
    expect(fileName).toBe('Example meal-planning app.md');
    expect(type).toBe('text/markdown;charset=utf-8');
    expect(content).toContain('# Example: meal-planning app\n');
    expect(content).toContain('- **Outcome:** More households plan a full week of meals');
    expect(content).toContain('- [x] Who in the household decides?');
    expect(content).toContain('[Interview notes](https://example.com/interview-notes)');
  });

  it('rasterises the same SVG for the PNG, on the canvas colour', async () => {
    await withExample();
    await exportSvg();
    const svg = saved.mock.calls[0][1] as string;
    await exportPng();
    expect(rasterise).toHaveBeenCalledTimes(1);
    const [source, width, height, background] = rasterise.mock.calls[0];
    expect(source).toBe(svg);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(background).toBe(EXPORT_PALETTE.bg);
    const [fileName, content, type] = saved.mock.calls[1];
    expect(fileName).toBe('Example meal-planning app.png');
    expect(content).toBeInstanceOf(Blob);
    expect(type).toBe('image/png');
  });

  it('passes on the reason when the image cannot be drawn, and saves nothing', async () => {
    await withExample();
    rasterise.mockRejectedValueOnce(new Error('This tree is too large to export as a PNG image.'));
    await expect(exportPng()).rejects.toThrow('too large');
    expect(saved).not.toHaveBeenCalled();
  });
});
