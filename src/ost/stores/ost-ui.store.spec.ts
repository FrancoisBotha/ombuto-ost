import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPinia, setActivePinia } from 'pinia';

import { COLLAPSED_STORAGE_KEY, useOstUiStore } from './ost-ui.store';

describe('OST UI store', () => {
  let ui: ReturnType<typeof useOstUiStore>;

  const persisted = () => JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!);

  /** Swaps in a storage whose reads and writes can be counted, or made to throw. Starts with the current content. */
  function stubStorage(broken: { getItem?: boolean; setItem?: boolean } = {}) {
    const items = new Map<string, string>();
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (raw !== null) items.set(COLLAPSED_STORAGE_KEY, raw);
    const storage = {
      getItem: vi.fn((key: string) => {
        if (broken.getItem) throw new Error('SecurityError');
        return items.get(key) ?? null;
      }),
      setItem: vi.fn((key: string, value: string) => {
        if (broken.setItem) throw new Error('QuotaExceededError');
        items.set(key, String(value));
      }),
    };
    vi.stubGlobal('localStorage', storage);
    return storage;
  }

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    ui = useOstUiStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('selection and panel', () => {
    it('selecting a node opens the detail panel and closes the add menu', () => {
      ui.setRightOpen(false);
      ui.openAddMenu('outcome-1');
      ui.select('solution-1');
      expect(ui.selectedId).toBe('solution-1');
      expect(ui.rightOpen).toBe(true);
      expect(ui.addMenuId).toBeNull();
    });

    it('clearing the selection leaves the panel as it is', () => {
      ui.select('solution-1');
      ui.setRightOpen(false);
      ui.select(null);
      expect(ui.selectedId).toBeNull();
      expect(ui.rightOpen).toBe(false);
    });

    it('opens and closes the side panels and switches the panel tab', () => {
      ui.setLeftOpen(false);
      ui.setRightOpen(false);
      expect([ui.leftOpen, ui.rightOpen]).toEqual([false, false]);
      ui.setLeftOpen(true);
      ui.setRightOpen(true);
      expect([ui.leftOpen, ui.rightOpen]).toEqual([true, true]);
      expect(ui.panelTab).toBe('detail');
      ui.setPanelTab('questions');
      expect(ui.panelTab).toBe('questions');
    });

    it('a repeated centre request for the same node is still a new request', () => {
      ui.requestCentre('solution-1');
      expect(ui.centreRequest).toEqual({ key: 'solution-1', seq: 1 });
      ui.requestCentre('solution-1');
      expect(ui.centreRequest).toEqual({ key: 'solution-1', seq: 2 });
    });
  });

  describe('scope and filters', () => {
    it('focuses one project, falling back to all of them', () => {
      expect(ui.projectId).toBe('all');
      ui.setProject('project-2');
      expect(ui.projectId).toBe('project-2');
      ui.setProject('');
      expect(ui.projectId).toBe('all');
    });

    it('hides and shows node types and keeps the search text', () => {
      ui.toggleType('evidence');
      ui.toggleType('solution');
      ui.toggleType('solution');
      expect(ui.hiddenTypes).toEqual({ evidence: true, solution: false });
      ui.setQuery('plan');
      expect(ui.query).toBe('plan');
    });
  });

  describe('collapse persistence', () => {
    it('writes the collapsed map under one key, keeping only collapsed entries', () => {
      ui.setCollapsed('outcome-1', true);
      ui.setCollapsed('solution-2', true);
      ui.setCollapsed('solution-2', false);
      expect(ui.collapsed).toEqual({ 'outcome-1': true, 'solution-2': false });
      expect(persisted()).toEqual({ 'outcome-1': true });
      expect(localStorage.length).toBe(1);

      ui.toggleCollapse('opportunity-3');
      expect(persisted()).toEqual({ 'outcome-1': true, 'opportunity-3': true });
      ui.toggleCollapse('opportunity-3');
      expect(persisted()).toEqual({ 'outcome-1': true });
    });

    it('collapses and expands several branches in one write', () => {
      const { setItem } = stubStorage();
      ui.setCollapsedMany(['outcome-1', 'solution-1', 'solution-2'], true);
      expect(ui.collapsed).toEqual({ 'outcome-1': true, 'solution-1': true, 'solution-2': true });
      expect(setItem).toHaveBeenCalledTimes(1);
      ui.setCollapsedMany(['solution-1', 'solution-2', 'solution-9'], false);
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(persisted()).toEqual({ 'outcome-1': true });
    });

    it('restores what was persisted', () => {
      ui.setCollapsed('outcome-1', true);
      ui.reset();
      expect(ui.collapsed).toEqual({});
      ui.restoreCollapsed();
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
    });

    it('reads the keys the first published build remembered: "product-<id>" is that project', () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'product-1': true, 'outcome-2': true, 'product-9': false }));
      ui.restoreCollapsed();
      expect(ui.collapsed).toEqual({ 'project-1': true, 'outcome-2': true, 'project-9': false });
      ui.pruneCollapsed(new Set(['project-1', 'outcome-2']));
      expect(persisted()).toEqual({ 'project-1': true, 'outcome-2': true });
    });

    it('restores an empty map when nothing was persisted', () => {
      ui.collapsed = { 'outcome-1': true };
      ui.restoreCollapsed();
      expect(ui.collapsed).toEqual({});
    });

    it('persistCollapsed overwrites the stored map with the current one', () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'outcome-1': true }));
      ui.persistCollapsed();
      expect(persisted()).toEqual({});
    });

    it('survives storage that throws on read', () => {
      ui.setCollapsed('outcome-1', true);
      const { getItem } = stubStorage({ getItem: true });
      expect(() => ui.restoreCollapsed()).not.toThrow();
      expect(getItem).toHaveBeenCalledWith(COLLAPSED_STORAGE_KEY);
      expect(ui.collapsed).toEqual({});
    });

    it('survives storage that throws on write, keeping the in-memory state', () => {
      const { setItem } = stubStorage({ setItem: true });
      expect(() => ui.setCollapsed('outcome-1', true)).not.toThrow();
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(() => ui.forgetNodes(new Set(['outcome-1']))).not.toThrow();
      expect(ui.collapsed).toEqual({});
    });

    it.each([['{not json'], [JSON.stringify(['outcome-1'])], ['null'], ['7']])('ignores a persisted value that is not a map: %s', raw => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, raw);
      ui.restoreCollapsed();
      expect(ui.collapsed).toEqual({});
    });

    it('prunes entries for nodes that no longer exist and persists the result', () => {
      ui.setCollapsed('outcome-1', true);
      ui.setCollapsed('gone-1', true);
      ui.pruneCollapsed(new Set(['outcome-1']));
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(persisted()).toEqual({ 'outcome-1': true });
    });

    it('pruning with nothing to drop writes nothing', () => {
      ui.setCollapsed('outcome-1', true);
      const { setItem } = stubStorage();
      ui.pruneCollapsed(new Set(['outcome-1', 'solution-1']));
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe('palette and drag', () => {
    it('arms a palette type, and disarms it when it is clicked again', () => {
      ui.armTool('solution');
      expect(ui.tool).toBe('solution');
      ui.armTool('evidence');
      expect(ui.tool).toBe('evidence');
      ui.armTool('evidence');
      expect(ui.tool).toBeNull();
      ui.armTool('solution');
      ui.armTool(null);
      expect(ui.tool).toBeNull();
    });

    it('tracks a palette drag and clears the drop target when it ends', () => {
      ui.movePaletteDrag(5, 5);
      expect(ui.paletteDrag).toBeNull();
      ui.startPaletteDrag('solution', 10, 20);
      ui.movePaletteDrag(30, 40);
      expect(ui.paletteDrag).toEqual({ type: 'solution', x: 30, y: 40 });
      ui.setDropTarget('opportunity-1');
      ui.endPaletteDrag();
      expect(ui.paletteDrag).toBeNull();
      expect(ui.dropTargetId).toBeNull();
    });
  });

  describe('menus, editing and delete confirmation', () => {
    it('opens one thing at a time and closes it again', () => {
      ui.openAddMenu('outcome-1');
      ui.startEditing('solution-1');
      ui.askDelete('solution-2');
      expect([ui.addMenuId, ui.editingId, ui.confirmId]).toEqual(['outcome-1', 'solution-1', 'solution-2']);
      ui.openAddMenu(null);
      ui.stopEditing();
      ui.cancelDelete();
      expect([ui.addMenuId, ui.editingId, ui.confirmId]).toEqual([null, null, null]);
    });
  });

  describe('forgetNodes', () => {
    it('drops every reference to removed nodes and persists the collapse change', () => {
      ui.setCollapsed('solution-1', true);
      ui.setCollapsed('outcome-1', true);
      ui.select('assumption-1');
      ui.startEditing('assumption-1');
      ui.openAddMenu('solution-1');
      ui.askDelete('solution-1');
      ui.setDropTarget('assumption-1');
      ui.setProject('project-1');

      ui.forgetNodes(new Set(['solution-1', 'assumption-1', 'project-1']));

      expect(ui.selectedId).toBeNull();
      expect(ui.editingId).toBeNull();
      expect(ui.addMenuId).toBeNull();
      expect(ui.confirmId).toBeNull();
      expect(ui.dropTargetId).toBeNull();
      expect(ui.projectId).toBe('all');
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(persisted()).toEqual({ 'outcome-1': true });
    });

    it('leaves unrelated state alone', () => {
      ui.select('outcome-1');
      ui.startEditing('outcome-1');
      ui.setProject('project-2');
      ui.setCollapsed('outcome-1', true);
      const { setItem } = stubStorage();
      ui.forgetNodes(new Set(['solution-9']));
      expect(ui.selectedId).toBe('outcome-1');
      expect(ui.editingId).toBe('outcome-1');
      expect(ui.projectId).toBe('project-2');
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  it('reset clears the view state of the document without touching what is persisted', () => {
    ui.setCollapsed('outcome-1', true);
    ui.select('outcome-1');
    ui.setProject('project-2');
    ui.setQuery('plan');
    ui.toggleType('evidence');
    ui.armTool('solution');
    ui.setPanelTab('links');
    ui.setLeftOpen(false);
    ui.requestCentre('outcome-1');
    ui.reset();
    expect(ui.$state).toEqual({
      selectedId: null,
      panelTab: 'detail',
      leftOpen: true,
      rightOpen: true,
      projectId: 'all',
      collapsed: {},
      query: '',
      hiddenTypes: {},
      tool: null,
      paletteDrag: null,
      dropTargetId: null,
      addMenuId: null,
      editingId: null,
      confirmId: null,
      centreRequest: null,
    });
    expect(persisted()).toEqual({ 'outcome-1': true });
  });
});
