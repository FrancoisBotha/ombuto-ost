import { defineStore } from 'pinia';

import type { PanelTab } from '../domain/derive';
import type { NodeType } from '../domain/types';

/**
 * localStorage key of the collapsed branches of the working document. There is one working document
 * per browser (see doc/autosave.ts), so one key is enough: it is rewritten when another document is
 * opened. Collapse state is a view preference of this device and is never written to the file.
 */
export const COLLAPSED_STORAGE_KEY = 'ombuto-ost.collapsed';

export interface OstUiState {
  selectedId: string | null;
  panelTab: PanelTab;
  leftOpen: boolean;
  rightOpen: boolean;
  /** 'all' or a product node key */
  productId: string | 'all';
  collapsed: Record<string, boolean>;
  query: string;
  hiddenTypes: Partial<Record<NodeType, boolean>>;
  /** palette type armed by click (click-to-arm-then-click) */
  tool: NodeType | null;
  /** palette type being dragged, with the pointer position for the ghost chip */
  paletteDrag: { type: NodeType; x: number; y: number } | null;
  dropTargetId: string | null;
  addMenuId: string | null;
  editingId: string | null;
  confirmId: string | null;
  /** Asks the canvas to centre a node (panel breadcrumb / child list); seq makes repeats observable. */
  centreRequest: { key: string; seq: number } | null;
}

const initialState = (): OstUiState => ({
  selectedId: null,
  panelTab: 'detail',
  leftOpen: true,
  rightOpen: true,
  productId: 'all',
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

/** View state of the OST screens. Never holds tree data (see ost-tree.store.ts). */
export const useOstUiStore = defineStore('ostUi', {
  state: initialState,
  actions: {
    /** Clears everything tied to one document (selection, scope, transient tool state). */
    reset() {
      Object.assign(this, initialState());
    },

    // ---- selection / panel ------------------------------------------------------------------
    /** Selects a node and opens the detail panel for it. */
    select(key: string | null) {
      this.selectedId = key;
      if (key) this.rightOpen = true;
      this.addMenuId = null;
    },
    requestCentre(key: string) {
      this.centreRequest = { key, seq: (this.centreRequest?.seq ?? 0) + 1 };
    },
    setPanelTab(tab: PanelTab) {
      this.panelTab = tab;
    },
    setLeftOpen(open: boolean) {
      this.leftOpen = open;
    },
    setRightOpen(open: boolean) {
      this.rightOpen = open;
    },

    // ---- scope / filters ------------------------------------------------------------------
    setProduct(productId: string | 'all') {
      this.productId = productId || 'all';
    },
    setQuery(query: string) {
      this.query = query;
    },
    toggleType(type: NodeType) {
      this.hiddenTypes = { ...this.hiddenTypes, [type]: !this.hiddenTypes[type] };
    },

    // ---- collapse (persisted on this device for the working document) ---------------------------
    restoreCollapsed() {
      let restored: Record<string, boolean> = {};
      try {
        const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) restored = parsed;
      } catch {
        restored = {};
      }
      this.collapsed = restored;
    },
    persistCollapsed() {
      try {
        const compact = Object.fromEntries(Object.entries(this.collapsed).filter(([, v]) => v));
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(compact));
      } catch {
        // storage unavailable — collapse still works for this session
      }
    },
    setCollapsed(key: string, collapsed: boolean) {
      this.collapsed = { ...this.collapsed, [key]: collapsed };
      this.persistCollapsed();
    },
    setCollapsedMany(keys: string[], collapsed: boolean) {
      const next = { ...this.collapsed };
      for (const key of keys) {
        if (collapsed) next[key] = true;
        else delete next[key];
      }
      this.collapsed = next;
      this.persistCollapsed();
    },
    toggleCollapse(key: string) {
      this.setCollapsed(key, !this.collapsed[key]);
    },
    /** Drops collapse entries for nodes that no longer exist. */
    pruneCollapsed(existing: Set<string>) {
      const next = Object.fromEntries(Object.entries(this.collapsed).filter(([k]) => existing.has(k)));
      if (Object.keys(next).length !== Object.keys(this.collapsed).length) {
        this.collapsed = next;
        this.persistCollapsed();
      }
    },

    // ---- palette / drag -----------------------------------------------------------------------
    armTool(type: NodeType | null) {
      this.tool = this.tool === type ? null : type;
    },
    startPaletteDrag(type: NodeType, x: number, y: number) {
      this.paletteDrag = { type, x, y };
    },
    movePaletteDrag(x: number, y: number) {
      if (this.paletteDrag) this.paletteDrag = { ...this.paletteDrag, x, y };
    },
    endPaletteDrag() {
      this.paletteDrag = null;
      this.dropTargetId = null;
    },
    setDropTarget(key: string | null) {
      this.dropTargetId = key;
    },

    // ---- menus / editing / overlays --------------------------------------------------------
    openAddMenu(key: string | null) {
      this.addMenuId = key;
    },
    startEditing(key: string) {
      this.editingId = key;
    },
    stopEditing() {
      this.editingId = null;
    },
    askDelete(key: string) {
      this.confirmId = key;
    },
    cancelDelete() {
      this.confirmId = null;
    },

    /** Forget every reference to nodes that were removed (after a cascade delete). */
    forgetNodes(keys: Set<string>) {
      if (this.selectedId && keys.has(this.selectedId)) this.selectedId = null;
      if (this.editingId && keys.has(this.editingId)) this.editingId = null;
      if (this.addMenuId && keys.has(this.addMenuId)) this.addMenuId = null;
      if (this.confirmId && keys.has(this.confirmId)) this.confirmId = null;
      if (this.dropTargetId && keys.has(this.dropTargetId)) this.dropTargetId = null;
      if (this.productId !== 'all' && keys.has(this.productId)) this.productId = 'all';
      if (Object.keys(this.collapsed).some(k => keys.has(k))) {
        this.collapsed = Object.fromEntries(Object.entries(this.collapsed).filter(([k]) => !keys.has(k)));
        this.persistCollapsed();
      }
    },
  },
});
