import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPinia, setActivePinia } from 'pinia';
import sinon, { type SinonStubbedInstance } from 'sinon';

import LocalDocumentService from '@/doc/local-document-service';
import { smallDocument } from '@/doc/small-document.test-util';

import { orderTree } from '../domain/derive';
import { bigTreeDtos, dto, sampleNodes } from '../domain/fixtures.test-util';
import { RuleError } from '../ost-errors';
import type { MoveNodeResponse, TreeNodeDTO } from '../ost.model';

import { useOstTreeStore } from './ost-tree.store';
import { COLLAPSED_STORAGE_KEY, useOstUiStore } from './ost-ui.store';

/** Resolves on demand so the state shown while a write is in flight can be observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TREE = [
  dto('project-1', null, { sortOrder: 1 }),
  dto('outcome-1', 'project-1'),
  dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 50, valueRating: 3 }),
  dto('opportunity-4', 'opportunity-1', { status: 'UNEXPLORED', priority: 20, valueRating: 2 }),
  dto('solution-1', 'opportunity-1', { status: 'CANDIDATE' }),
  dto('assumption-1', 'solution-1', { status: 'TESTING', confidence: 40 }),
  dto('evidence-1', 'assumption-1'),
  dto('opportunity-2', 'outcome-1', { status: 'UNEXPLORED', sortOrder: 1 }),
  dto('opportunity-3', 'outcome-1', { status: 'PARKED', sortOrder: 2 }),
  dto('project-2', null, { sortOrder: 2 }),
];
/** TREE is already in tree pre-order. */
const ORDER = TREE.map(d => d.key);

const GENERIC = 'Something went wrong. Your change was not saved.';
const CANNOT_GO_THERE = 'That node cannot go there.';

describe('OST tree store', () => {
  let service: SinonStubbedInstance<LocalDocumentService>;
  let tree: ReturnType<typeof useOstTreeStore>;
  let ui: ReturnType<typeof useOstUiStore>;

  const ids = () => tree.nodes.map(n => n.id);
  const childIds = (parent: string) => tree.nodes.filter(n => n.parent === parent).map(n => n.id);

  beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    service = sinon.createStubInstance(LocalDocumentService);
    service.getTree.resolves(TREE);
    tree = useOstTreeStore();
    ui = useOstUiStore();
    tree.setServiceFactory(() => service);
    await tree.loadTree();
  });

  describe('loadTree', () => {
    it('maps the nodes and marks the tree as loaded', () => {
      expect(service.getTree.calledOnceWithExactly()).toBe(true);
      expect(tree.loaded).toBe(true);
      expect(tree.error).toBeNull();
      expect(ids()).toEqual(ORDER);
      expect(tree.byId('opportunity-1')).toMatchObject({ dbId: 1, type: 'opportunity', parent: 'outcome-1', status: 'exploring' });
      expect(Object.keys(tree.placed)).toHaveLength(TREE.length);
    });

    it('puts the nodes in tree pre-order whatever order the document lists them in', async () => {
      service.getTree.resolves([...TREE].reverse());
      expect(await tree.loadTree()).toBe(true);
      expect(ids()).toEqual(ORDER);
    });

    it('keepCollapsed restores the persisted collapsed branches and drops entries of nodes that are gone', async () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'outcome-1': true, 'gone-1': true }));
      expect(await tree.loadTree({ keepCollapsed: true })).toBe(true);
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(tree.placed['outcome-1']).toBeDefined();
      expect(tree.placed['opportunity-1']).toBeUndefined();
      expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual({ 'outcome-1': true });
    });

    it('keepCollapsed tolerates corrupt persisted state', async () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, '{not json');
      expect(await tree.loadTree({ keepCollapsed: true })).toBe(true);
      expect(ui.collapsed).toEqual({});
    });

    it('a plain load starts fully expanded and overwrites the persisted map', async () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'outcome-1': true }));
      expect(await tree.loadTree()).toBe(true);
      expect(ui.collapsed).toEqual({});
      expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual({});
      expect(Object.keys(tree.placed)).toHaveLength(TREE.length);
    });

    it('starts from a clean view: selection, scope and an earlier error are cleared', async () => {
      ui.select('solution-1');
      ui.setProject('project-2');
      ui.startEditing('solution-1');
      service.deleteNode.rejects(new Error('boom'));
      await tree.deleteNode('solution-1');
      expect(tree.error).not.toBeNull();

      expect(await tree.loadTree()).toBe(true);
      expect(ui.selectedId).toBeNull();
      expect(ui.editingId).toBeNull();
      expect(ui.projectId).toBe('all');
      expect(tree.error).toBeNull();
    });

    it('a failed read returns false, sets the error and leaves no tree on screen', async () => {
      service.getTree.rejects(new Error('boom'));
      expect(await tree.loadTree()).toBe(false);
      expect(tree.error).toBe('The tree could not be opened.');
      expect(tree.nodes).toEqual([]);
      expect(tree.loaded).toBe(false);

      service.getTree.rejects(new RuleError('nodocument'));
      expect(await tree.loadTree()).toBe(false);
      expect(tree.error).toBe('No tree is open.');
    });

    it('reset empties the store', () => {
      tree.reset();
      expect(tree.nodes).toEqual([]);
      expect(tree.loaded).toBe(false);
      expect(tree.error).toBeNull();
      expect(tree.placed).toEqual({});
    });
  });

  describe('patchNode', () => {
    it('shows the patch at once, then takes the stored copy', async () => {
      const pending = deferred<TreeNodeDTO>();
      service.patchNode.returns(pending.promise);
      const done = tree.patchNode('opportunity-1', { status: 'validated', priority: 90 });
      expect(tree.byId('opportunity-1')).toMatchObject({ status: 'validated', priority: 90 });
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { status: 'VALIDATED', priority: 90 })).toBe(true);

      pending.resolve(
        dto('opportunity-1', 'outcome-1', { status: 'VALIDATED', priority: 91, valueRating: 3, lastModifiedDate: '2026-10-01T09:00:00Z' }),
      );
      expect(await done).toBe(true);
      expect(tree.byId('opportunity-1')).toMatchObject({ status: 'validated', priority: 91, lastModifiedDate: '2026-10-01T09:00:00Z' });
      expect(tree.error).toBeNull();
    });

    it('the stored value replaces the typed one (trimmed title, cleaned owner)', async () => {
      service.patchNode.resolves(dto('assumption-1', 'solution-1', { status: 'TESTING', confidence: 40, title: 'Renamed', owner: 'Ana' }));
      expect(await tree.patchNode('assumption-1', { title: '  Renamed ', owner: ' Ana ' })).toBe(true);
      expect(service.patchNode.calledOnceWithExactly('assumption', 1, { title: '  Renamed ', owner: ' Ana ' })).toBe(true);
      expect(tree.byId('assumption-1')).toMatchObject({ title: 'Renamed', owner: 'Ana', conf: 40, status: 'testing' });
    });

    it('sends cleared notes and owner as null', async () => {
      service.patchNode.resolves(dto('assumption-1', 'solution-1', { status: 'TESTING', confidence: 40 }));
      await tree.patchNode('assumption-1', { note: '', owner: '' });
      expect(service.patchNode.calledOnceWithExactly('assumption', 1, { notes: null, owner: null })).toBe(true);
    });

    it('rolls back and surfaces the rule that was broken', async () => {
      service.patchNode.rejects(new RuleError('invalidstatus'));
      expect(await tree.patchNode('opportunity-1', { status: 'validated', note: 'x' })).toBe(false);
      expect(tree.byId('opportunity-1')).toMatchObject({ status: 'exploring', note: '' });
      expect(tree.error).toBe('That status is not valid for this node.');
      tree.clearError();
      expect(tree.error).toBeNull();
    });

    it('rolls back only the patched fields, with a generic message for an unexpected failure', async () => {
      const pending = deferred<TreeNodeDTO>();
      service.patchNode.returns(pending.promise);
      const done = tree.patchNode('opportunity-1', { priority: 90 });
      expect(tree.byId('opportunity-1')?.priority).toBe(90);
      pending.reject(new Error('boom'));
      expect(await done).toBe(false);
      expect(tree.byId('opportunity-1')).toMatchObject({ priority: 50, value: 3, status: 'exploring', title: 'Title opportunity-1' });
      expect(tree.error).toBe(GENERIC);
    });

    it.each([
      ['project-1', 'Project names need 2 to 100 characters.'],
      ['opportunity-1', 'Titles need 2 to 200 characters.'],
      ['solution-1', 'Titles need 2 to 200 characters.'],
      ['assumption-1', 'Titles need 2 to 500 characters.'],
      ['evidence-1', 'Titles need 2 to 500 characters.'],
    ])('a refused title on %s says "%s"', async (key, message) => {
      service.patchNode.rejects(new RuleError('invalidtitle'));
      expect(await tree.patchNode(key, { title: 'x' })).toBe(false);
      expect(tree.byId(key)?.title).toBe(`Title ${key}`);
      expect(tree.error).toBe(message);
    });

    it('ignores an unknown node, a malformed key and an empty patch', async () => {
      expect(await tree.patchNode('opportunity-99', { title: 'Nope' })).toBe(false);
      expect(await tree.patchNode('nonsense', { title: 'Nope' })).toBe(false);
      expect(await tree.patchNode('opportunity-1', {})).toBe(false);
      expect(service.patchNode.called).toBe(false);
      expect(tree.error).toBeNull();
    });
  });

  describe('createNode', () => {
    it('selects the new node, puts it in rename mode and expands its collapsed parent', async () => {
      ui.setCollapsed('solution-1', true);
      service.createNode.resolves(dto('assumption-9', 'solution-1', { status: 'UNTESTED', sortOrder: 5, title: 'New assumption' }));
      const key = await tree.createNode('solution-1');
      expect(service.createNode.calledOnceWithExactly({ type: 'ASSUMPTION', parentType: 'SOLUTION', parentId: 1 })).toBe(true);
      expect(key).toBe('assumption-9');
      expect(ui.selectedId).toBe('assumption-9');
      expect(ui.editingId).toBe('assumption-9');
      expect(ui.collapsed['solution-1']).toBe(false);
      expect(ids().indexOf('assumption-9')).toBe(ids().indexOf('evidence-1') + 1);
      expect(tree.placed['assumption-9']).toBeDefined();
      expect(tree.error).toBeNull();
    });

    it('passes the chosen type and title on', async () => {
      service.createNode.resolves(dto('evidence-9', 'opportunity-1', { title: 'Interview 4' }));
      expect(await tree.createNode('opportunity-1', 'evidence', 'Interview 4')).toBe('evidence-9');
      expect(
        service.createNode.calledOnceWithExactly({ type: 'EVIDENCE', parentType: 'OPPORTUNITY', parentId: 1, title: 'Interview 4' }),
      ).toBe(true);
      expect(tree.byId('evidence-9')).toMatchObject({ parent: 'opportunity-1', title: 'Interview 4' });
    });

    it('refuses a type the parent does not permit without asking the service', async () => {
      expect(await tree.createNode('solution-1', 'evidence')).toBeNull();
      expect(tree.error).toBe(CANNOT_GO_THERE);
      tree.clearError();
      // Evidence takes no children at all, so there is no default type either.
      expect(await tree.createNode('evidence-1')).toBeNull();
      expect(tree.error).toBe(CANNOT_GO_THERE);
      expect(service.createNode.called).toBe(false);
    });

    it('returns null for an unknown parent', async () => {
      expect(await tree.createNode('solution-99')).toBeNull();
      expect(service.createNode.called).toBe(false);
      expect(tree.error).toBeNull();
    });

    it('leaves the tree and the view untouched when the service refuses', async () => {
      ui.setCollapsed('outcome-1', true);
      service.createNode.rejects(new RuleError('parentmissing'));
      expect(await tree.createNode('outcome-1', 'opportunity')).toBeNull();
      expect(ids()).toEqual(ORDER);
      expect(ui.selectedId).toBeNull();
      expect(ui.editingId).toBeNull();
      expect(ui.collapsed['outcome-1']).toBe(true);
      expect(tree.error).toBe('The parent node no longer exists.');

      service.createNode.rejects(new Error('boom'));
      expect(await tree.createNode('outcome-1', 'opportunity')).toBeNull();
      expect(tree.error).toBe('The node could not be created.');
    });
  });

  describe('createProject', () => {
    it('appends the project, selects it and puts it in rename mode', async () => {
      service.createNode.resolves(dto('project-9', null, { sortOrder: 3, title: 'New project' }));
      expect(await tree.createProject()).toBe('project-9');
      expect(service.createNode.calledOnceWithExactly({ type: 'PROJECT', parentType: null, parentId: null })).toBe(true);
      expect(ids()).toEqual([...ORDER, 'project-9']);
      expect(tree.projects.map(p => p.id)).toEqual(['project-1', 'project-2', 'project-9']);
      expect(ui.selectedId).toBe('project-9');
      expect(ui.editingId).toBe('project-9');
      expect(ui.projectId).toBe('all');
    });

    it('passes a title on', async () => {
      service.createNode.resolves(dto('project-9', null, { sortOrder: 3, title: 'Checkout' }));
      await tree.createProject('Checkout');
      expect(service.createNode.calledOnceWithExactly({ type: 'PROJECT', parentType: null, parentId: null, title: 'Checkout' })).toBe(true);
    });

    it('switches a canvas scoped to one project to the new one, so it is on screen', async () => {
      ui.setProject('project-1');
      service.createNode.resolves(dto('project-9', null, { sortOrder: 3 }));
      await tree.createProject();
      expect(ui.projectId).toBe('project-9');
      expect(tree.roots.map(r => r.id)).toEqual(['project-9']);
      expect(Object.keys(tree.placed)).toEqual(['project-9']);
    });

    it('keeps the tree and the scope when the service refuses', async () => {
      ui.setProject('project-1');
      service.createNode.rejects(new RuleError('invalidtitle'));
      expect(await tree.createProject('x')).toBeNull();
      expect(tree.error).toBe('Project names need 2 to 100 characters.');
      expect(ids()).toEqual(ORDER);
      expect(ui.projectId).toBe('project-1');
      expect(ui.selectedId).toBeNull();

      service.createNode.rejects(new Error('boom'));
      expect(await tree.createProject()).toBeNull();
      expect(tree.error).toBe('The project could not be created.');
    });
  });

  describe('moveNode', () => {
    const moved = (node: TreeNodeDTO, siblings: MoveNodeResponse['siblings'] = []): MoveNodeResponse => ({ node, siblings });

    it('re-parents at once (placed last), then applies the stored placement', async () => {
      const pending = deferred<MoveNodeResponse>();
      service.moveNode.returns(pending.promise);
      const done = tree.moveNode('solution-1', 'opportunity-2');
      expect(tree.byId('solution-1')?.parent).toBe('opportunity-2');
      expect(ids().indexOf('solution-1')).toBe(ids().indexOf('opportunity-2') + 1);
      expect(ids().indexOf('assumption-1')).toBe(ids().indexOf('solution-1') + 1);
      expect(service.moveNode.calledOnceWithExactly({ nodeType: 'SOLUTION', nodeId: 1, parentType: 'OPPORTUNITY', parentId: 2 })).toBe(
        true,
      );

      pending.resolve(
        moved(dto('solution-1', 'opportunity-2', { status: 'CANDIDATE', sortOrder: 0, lastModifiedDate: '2026-10-01T09:00:00Z' }), [
          { key: 'solution-1', sortOrder: 0 },
        ]),
      );
      expect(await done).toBe(true);
      expect(tree.byId('solution-1')).toMatchObject({ parent: 'opportunity-2', sortOrder: 0, lastModifiedDate: '2026-10-01T09:00:00Z' });
      expect(childIds('opportunity-1')).toEqual(['opportunity-4']);
      expect(tree.error).toBeNull();
    });

    it('re-parents into a position among the same-type children of the target', async () => {
      const pending = deferred<MoveNodeResponse>();
      service.moveNode.returns(pending.promise);
      const done = tree.moveNode('opportunity-4', 'outcome-1', 1);
      expect(childIds('outcome-1')).toEqual(['opportunity-1', 'opportunity-4', 'opportunity-2', 'opportunity-3']);
      expect(
        service.moveNode.calledOnceWithExactly({ nodeType: 'OPPORTUNITY', nodeId: 4, parentType: 'OUTCOME', parentId: 1, position: 1 }),
      ).toBe(true);

      pending.resolve(
        moved(dto('opportunity-4', 'outcome-1', { sortOrder: 1 }), [
          { key: 'opportunity-1', sortOrder: 0 },
          { key: 'opportunity-4', sortOrder: 1 },
          { key: 'opportunity-2', sortOrder: 2 },
          { key: 'opportunity-3', sortOrder: 3 },
        ]),
      );
      expect(await done).toBe(true);
      expect(childIds('outcome-1')).toEqual(['opportunity-1', 'opportunity-4', 'opportunity-2', 'opportunity-3']);
      expect(tree.byId('opportunity-3')?.sortOrder).toBe(3);
    });

    it('reorders under the current parent when a position is given, applying the sibling sortOrders of the response', async () => {
      const pending = deferred<MoveNodeResponse>();
      service.moveNode.returns(pending.promise);
      const done = tree.moveNode('opportunity-3', 'outcome-1', 0);
      expect(childIds('outcome-1')).toEqual(['opportunity-3', 'opportunity-1', 'opportunity-2']);

      pending.resolve(
        moved(dto('opportunity-3', 'outcome-1', { sortOrder: 0 }), [
          { key: 'opportunity-3', sortOrder: 0 },
          { key: 'opportunity-1', sortOrder: 1 },
          { key: 'opportunity-2', sortOrder: 2 },
          { key: 'opportunity-99', sortOrder: 3 }, // not in the store: skipped
        ]),
      );
      expect(await done).toBe(true);
      expect(childIds('outcome-1')).toEqual(['opportunity-3', 'opportunity-1', 'opportunity-2']);
      expect(['opportunity-3', 'opportunity-1', 'opportunity-2'].map(k => tree.byId(k)?.sortOrder)).toEqual([0, 1, 2]);
    });

    it('the response decides the final order, even when it differs from what was shown', async () => {
      service.moveNode.resolves(
        moved(dto('opportunity-3', 'outcome-1', { sortOrder: 1 }), [
          { key: 'opportunity-1', sortOrder: 0 },
          { key: 'opportunity-3', sortOrder: 1 },
          { key: 'opportunity-2', sortOrder: 2 },
        ]),
      );
      expect(await tree.moveNode('opportunity-3', 'outcome-1', 0)).toBe(true);
      expect(childIds('outcome-1')).toEqual(['opportunity-1', 'opportunity-3', 'opportunity-2']);
    });

    it('reorders projects with a null target', async () => {
      service.moveNode.resolves(
        moved(dto('project-2', null, { sortOrder: 0 }), [
          { key: 'project-2', sortOrder: 0 },
          { key: 'project-1', sortOrder: 1 },
        ]),
      );
      expect(await tree.moveNode('project-2', null, 0)).toBe(true);
      expect(
        service.moveNode.calledOnceWithExactly({ nodeType: 'PROJECT', nodeId: 2, parentType: null, parentId: null, position: 0 }),
      ).toBe(true);
      expect(tree.projects.map(p => p.id)).toEqual(['project-2', 'project-1']);
      expect(ids()).toEqual(['project-2', ...ORDER.filter(k => k !== 'project-2')]);
    });

    it('refuses illegal targets locally', async () => {
      const refused = async (key: string, target: string) => {
        tree.clearError();
        expect(await tree.moveNode(key, target)).toBe(false);
        expect(tree.error).toBe(CANNOT_GO_THERE);
      };
      await refused('evidence-1', 'solution-1'); // type not permitted
      await refused('opportunity-1', 'solution-1'); // type not permitted
      await refused('opportunity-1', 'opportunity-4'); // under its own descendant
      await refused('opportunity-1', 'opportunity-1'); // under itself
      await refused('solution-1', 'opportunity-1'); // already there, and no position
      expect(service.moveNode.called).toBe(false);
      expect(ids()).toEqual(ORDER);
    });

    it('ignores unknown nodes and a null target for anything but a project', async () => {
      expect(await tree.moveNode('solution-99', 'opportunity-2')).toBe(false);
      expect(await tree.moveNode('solution-1', 'opportunity-99')).toBe(false);
      expect(await tree.moveNode('solution-1', null)).toBe(false);
      expect(service.moveNode.called).toBe(false);
      expect(tree.error).toBeNull();
    });

    it('rolls back when the service refuses', async () => {
      ui.setCollapsed('opportunity-2', true);
      const pending = deferred<MoveNodeResponse>();
      service.moveNode.returns(pending.promise);
      const done = tree.moveNode('solution-1', 'opportunity-2');
      expect(tree.byId('solution-1')?.parent).toBe('opportunity-2');
      pending.reject(new RuleError('cycle'));
      expect(await done).toBe(false);
      expect(tree.byId('solution-1')).toMatchObject({ parent: 'opportunity-1', sortOrder: 0 });
      expect(ids()).toEqual(ORDER);
      expect(tree.error).toBe('A node cannot move under its own descendant.');
      expect(ui.collapsed['opportunity-2']).toBe(true);
    });

    it('rolls a refused reorder back, with a generic message for an unexpected failure', async () => {
      service.moveNode.rejects(new Error('boom'));
      expect(await tree.moveNode('opportunity-3', 'outcome-1', 0)).toBe(false);
      expect(childIds('outcome-1')).toEqual(['opportunity-1', 'opportunity-2', 'opportunity-3']);
      expect(tree.byId('opportunity-3')?.sortOrder).toBe(2);
      expect(tree.error).toBe('The node could not be moved.');
    });

    it('expands a collapsed target once the move is accepted', async () => {
      ui.setCollapsed('opportunity-2', true);
      service.moveNode.resolves(moved(dto('solution-1', 'opportunity-2', { status: 'CANDIDATE' }), [{ key: 'solution-1', sortOrder: 0 }]));
      expect(await tree.moveNode('solution-1', 'opportunity-2')).toBe(true);
      expect(ui.collapsed['opportunity-2']).toBe(false);
      expect(tree.placed['solution-1']).toBeDefined();
    });
  });

  describe('reorderNode', () => {
    const accept = () =>
      service.moveNode.callsFake(async request => ({
        node: dto(`${request.nodeType.toLowerCase()}-${request.nodeId}`, request.parentId === null ? null : 'outcome-1', {
          sortOrder: request.position ?? 0,
        }),
        siblings: [],
      }));

    it('returns false for the first node moving earlier and the last moving later', async () => {
      expect(await tree.reorderNode('opportunity-1', -1)).toBe(false);
      expect(await tree.reorderNode('opportunity-3', 1)).toBe(false);
      expect(await tree.reorderNode('project-1', -1)).toBe(false);
      expect(await tree.reorderNode('project-2', 1)).toBe(false);
      expect(await tree.reorderNode('opportunity-99', 1)).toBe(false);
      expect(service.moveNode.called).toBe(false);
      expect(tree.error).toBeNull();
    });

    it('counts same-type siblings only', async () => {
      // solution-1 shares its parent with opportunity-4, but is the only solution there.
      expect(await tree.reorderNode('solution-1', -1)).toBe(false);
      expect(await tree.reorderNode('solution-1', 1)).toBe(false);
      expect(service.moveNode.called).toBe(false);
    });

    it('moves a middle node one place earlier or later', async () => {
      accept();
      expect(await tree.reorderNode('opportunity-2', -1)).toBe(true);
      expect(service.moveNode.lastCall.args[0]).toEqual({
        nodeType: 'OPPORTUNITY',
        nodeId: 2,
        parentType: 'OUTCOME',
        parentId: 1,
        position: 0,
      });
      await tree.loadTree();
      expect(await tree.reorderNode('opportunity-2', 1)).toBe(true);
      expect(service.moveNode.lastCall.args[0]).toMatchObject({ nodeId: 2, parentId: 1, position: 2 });
    });

    it('moves the first node later and the last node earlier', async () => {
      accept();
      expect(await tree.reorderNode('opportunity-1', 1)).toBe(true);
      expect(service.moveNode.lastCall.args[0]).toMatchObject({ nodeId: 1, position: 1 });
      await tree.loadTree();
      expect(await tree.reorderNode('opportunity-3', -1)).toBe(true);
      expect(service.moveNode.lastCall.args[0]).toMatchObject({ nodeId: 3, position: 1 });
    });

    it('reorders projects among themselves', async () => {
      accept();
      expect(await tree.reorderNode('project-2', -1)).toBe(true);
      expect(service.moveNode.lastCall.args[0]).toEqual({ nodeType: 'PROJECT', nodeId: 2, parentType: null, parentId: null, position: 0 });
    });
  });

  describe('deleteNode', () => {
    it('removes the whole subtree once the service accepted, and forgets it in the view', async () => {
      ui.select('assumption-1');
      ui.startEditing('assumption-1');
      ui.askDelete('solution-1');
      ui.setCollapsed('solution-1', true);
      ui.setCollapsed('outcome-1', true);
      const pending = deferred<void>();
      service.deleteNode.returns(pending.promise);
      const done = tree.deleteNode('solution-1');
      expect(service.deleteNode.calledOnceWithExactly('solution', 1)).toBe(true);
      expect(ids()).toEqual(ORDER);

      pending.resolve();
      expect(await done).toBe(true);
      expect(ids()).toEqual(ORDER.filter(k => !['solution-1', 'assumption-1', 'evidence-1'].includes(k)));
      expect(ui.selectedId).toBeNull();
      expect(ui.editingId).toBeNull();
      expect(ui.confirmId).toBeNull();
      expect(ui.collapsed).toEqual({ 'outcome-1': true });
      expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual({ 'outcome-1': true });
    });

    it('deleting the project in scope widens the scope to every project', async () => {
      ui.setProject('project-1');
      ui.select('project-2');
      service.deleteNode.resolves();
      expect(await tree.deleteNode('project-1')).toBe(true);
      expect(ids()).toEqual(['project-2']);
      expect(ui.projectId).toBe('all');
      expect(ui.selectedId).toBe('project-2');
      expect(Object.keys(tree.placed)).toEqual(['project-2']);
    });

    it('keeps everything when the service refuses', async () => {
      ui.select('assumption-1');
      service.deleteNode.rejects(new RuleError('nodemissing'));
      expect(await tree.deleteNode('solution-1')).toBe(false);
      expect(ids()).toEqual(ORDER);
      expect(ui.selectedId).toBe('assumption-1');
      expect(tree.error).toBe('That node no longer exists.');

      service.deleteNode.rejects(new Error('boom'));
      expect(await tree.deleteNode('solution-1')).toBe(false);
      expect(tree.error).toBe('The node could not be deleted.');
    });

    it('ignores an unknown node', async () => {
      expect(await tree.deleteNode('solution-99')).toBe(false);
      expect(service.deleteNode.called).toBe(false);
    });
  });

  describe('links', () => {
    const DOC = { id: 5, name: 'Doc', url: 'https://x.test' };
    const withLink = async () => {
      service.addLink.resolves({ ...DOC });
      await tree.addLink('outcome-1', { name: 'Doc', url: 'https://x.test' });
    };

    it('adds the link the service stored', async () => {
      service.addLink.resolves({ ...DOC });
      expect(await tree.addLink('outcome-1', { name: ' Doc ', url: 'https://x.test' })).toBe(true);
      expect(service.addLink.calledOnceWithExactly('outcome', 1, { name: ' Doc ', url: 'https://x.test' })).toBe(true);
      expect(tree.byId('outcome-1')?.links).toEqual([DOC]);
    });

    it('adds nothing when the service refuses', async () => {
      service.addLink.rejects(new RuleError('linkurlinvalid'));
      expect(await tree.addLink('outcome-1', { name: 'Doc', url: 'ftp://x.test' })).toBe(false);
      expect(tree.byId('outcome-1')?.links).toEqual([]);
      expect(tree.error).toBe('Links must start with http://, https:// or mailto:.');

      service.addLink.rejects(new Error('boom'));
      expect(await tree.addLink('outcome-1', { name: 'Doc', url: 'https://x.test' })).toBe(false);
      expect(tree.error).toBe('The link could not be added.');
      expect(await tree.addLink('outcome-99', { name: 'Doc', url: 'https://x.test' })).toBe(false);
      expect(service.addLink.callCount).toBe(2);
    });

    it('shows an edit at once, then takes the stored copy', async () => {
      await withLink();
      const pending = deferred<typeof DOC>();
      service.updateLink.returns(pending.promise);
      const done = tree.updateLink('outcome-1', 5, { name: ' Spec ' });
      expect(tree.byId('outcome-1')?.links[0]).toEqual({ ...DOC, name: ' Spec ' });
      expect(service.updateLink.calledOnceWithExactly(5, { name: ' Spec ' })).toBe(true);
      pending.resolve({ ...DOC, name: 'Spec' });
      expect(await done).toBe(true);
      expect(tree.byId('outcome-1')?.links).toEqual([{ ...DOC, name: 'Spec' }]);
    });

    it('rolls a refused edit back', async () => {
      await withLink();
      service.updateLink.rejects(new RuleError('linknameinvalid'));
      expect(await tree.updateLink('outcome-1', 5, { name: '', url: 'https://y.test' })).toBe(false);
      expect(tree.byId('outcome-1')?.links).toEqual([DOC]);
      expect(tree.error).toBe('Link names need 1 to 100 characters.');

      service.updateLink.rejects(new Error('boom'));
      expect(await tree.updateLink('outcome-1', 5, { name: 'Spec' })).toBe(false);
      expect(tree.error).toBe('The link could not be saved.');
      expect(await tree.updateLink('outcome-1', 99, { name: 'Spec' })).toBe(false);
      expect(service.updateLink.callCount).toBe(2);
    });

    it('removes a link only after the service accepted', async () => {
      await withLink();
      const pending = deferred<void>();
      service.deleteLink.returns(pending.promise);
      const done = tree.removeLink('outcome-1', 5);
      expect(tree.byId('outcome-1')?.links).toHaveLength(1);
      expect(service.deleteLink.calledOnceWithExactly(5)).toBe(true);
      pending.resolve();
      expect(await done).toBe(true);
      expect(tree.byId('outcome-1')?.links).toEqual([]);
    });

    it('keeps the link when the removal is refused', async () => {
      await withLink();
      service.deleteLink.rejects(new RuleError('linkmissing'));
      expect(await tree.removeLink('outcome-1', 5)).toBe(false);
      expect(tree.byId('outcome-1')?.links).toEqual([DOC]);
      expect(tree.error).toBe('That link no longer exists.');

      service.deleteLink.rejects(new Error('boom'));
      expect(await tree.removeLink('outcome-1', 5)).toBe(false);
      expect(tree.error).toBe('The link could not be removed.');
      expect(await tree.removeLink('outcome-1', 99)).toBe(false);
      expect(service.deleteLink.callCount).toBe(2);
    });
  });

  describe('open questions', () => {
    const WHO = { id: 3, text: 'Who?', done: false };
    const withQuestion = async () => {
      service.addQuestion.resolves({ ...WHO });
      await tree.addQuestion('opportunity-1', 'Who?');
    };

    it('adds the question the service stored', async () => {
      service.addQuestion.resolves({ ...WHO });
      expect(await tree.addQuestion('opportunity-1', ' Who? ')).toBe(true);
      expect(service.addQuestion.calledOnceWithExactly(1, ' Who? ')).toBe(true);
      expect(tree.byId('opportunity-1')?.questions).toEqual([WHO]);
    });

    it('only opportunities take questions', async () => {
      expect(await tree.addQuestion('solution-1', 'nope')).toBe(false);
      expect(await tree.addQuestion('opportunity-99', 'nope')).toBe(false);
      expect(service.addQuestion.called).toBe(false);
    });

    it('adds nothing when the service refuses', async () => {
      service.addQuestion.rejects(new RuleError('questiontextinvalid'));
      expect(await tree.addQuestion('opportunity-1', '   ')).toBe(false);
      expect(tree.byId('opportunity-1')?.questions).toEqual([]);
      expect(tree.error).toBe('Questions need 1 to 500 characters.');

      service.addQuestion.rejects(new Error('boom'));
      expect(await tree.addQuestion('opportunity-1', 'Who?')).toBe(false);
      expect(tree.error).toBe('The question could not be added.');
    });

    it('ticks a question at once, then takes the stored copy', async () => {
      await withQuestion();
      const pending = deferred<typeof WHO>();
      service.updateQuestion.returns(pending.promise);
      const done = tree.updateQuestion('opportunity-1', 3, { done: true });
      expect(tree.byId('opportunity-1')?.questions[0].done).toBe(true);
      expect(service.updateQuestion.calledOnceWithExactly(3, { done: true })).toBe(true);
      pending.resolve({ ...WHO, done: true });
      expect(await done).toBe(true);
      expect(tree.byId('opportunity-1')?.questions).toEqual([{ ...WHO, done: true }]);
    });

    it('rolls a refused edit back', async () => {
      await withQuestion();
      service.updateQuestion.rejects(new Error('boom'));
      expect(await tree.updateQuestion('opportunity-1', 3, { done: true, text: 'Why?' })).toBe(false);
      expect(tree.byId('opportunity-1')?.questions).toEqual([WHO]);
      expect(tree.error).toBe('The question could not be saved.');

      service.updateQuestion.rejects(new RuleError('questiontextinvalid'));
      expect(await tree.updateQuestion('opportunity-1', 3, { text: '' })).toBe(false);
      expect(tree.byId('opportunity-1')?.questions).toEqual([WHO]);
      expect(tree.error).toBe('Questions need 1 to 500 characters.');
      expect(await tree.updateQuestion('opportunity-1', 99, { done: true })).toBe(false);
      expect(service.updateQuestion.callCount).toBe(2);
    });

    it('removes a question only after the service accepted', async () => {
      await withQuestion();
      const pending = deferred<void>();
      service.deleteQuestion.returns(pending.promise);
      const done = tree.removeQuestion('opportunity-1', 3);
      expect(tree.byId('opportunity-1')?.questions).toHaveLength(1);
      expect(service.deleteQuestion.calledOnceWithExactly(3)).toBe(true);
      pending.resolve();
      expect(await done).toBe(true);
      expect(tree.byId('opportunity-1')?.questions).toEqual([]);
    });

    it('keeps the question when the removal is refused', async () => {
      await withQuestion();
      service.deleteQuestion.rejects(new RuleError('questionmissing'));
      expect(await tree.removeQuestion('opportunity-1', 3)).toBe(false);
      expect(tree.byId('opportunity-1')?.questions).toEqual([WHO]);
      expect(tree.error).toBe('That question no longer exists.');

      service.deleteQuestion.rejects(new Error('boom'));
      expect(await tree.removeQuestion('opportunity-1', 3)).toBe(false);
      expect(tree.error).toBe('The question could not be removed.');
      expect(await tree.removeQuestion('opportunity-1', 99)).toBe(false);
      expect(service.deleteQuestion.callCount).toBe(2);
    });
  });

  describe('getters', () => {
    it('byId finds a node by key and tolerates nothing', () => {
      expect(tree.byId('solution-1')?.title).toBe('Title solution-1');
      expect(tree.byId('solution-99')).toBeUndefined();
      expect(tree.byId(null)).toBeUndefined();
      expect(tree.byId(undefined)).toBeUndefined();
    });

    it('projects lists every project in order', () => {
      expect(tree.projects.map(p => p.id)).toEqual(['project-1', 'project-2']);
    });

    it('roots follows the project chosen in the view', () => {
      expect(tree.roots.map(r => r.id)).toEqual(['project-1', 'project-2']);
      ui.setProject('project-2');
      expect(tree.roots.map(r => r.id)).toEqual(['project-2']);
      ui.setProject('project-99');
      expect(tree.roots).toEqual([]);
      ui.setProject('all');
      expect(tree.roots).toHaveLength(2);
    });

    it('placed positions the nodes in scope that are not under a collapsed branch', () => {
      expect(Object.keys(tree.placed).sort()).toEqual([...ORDER].sort());
      for (const p of Object.values(tree.placed)) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }

      ui.setCollapsed('opportunity-1', true);
      expect(Object.keys(tree.placed).sort()).toEqual(
        ['project-1', 'outcome-1', 'opportunity-1', 'opportunity-2', 'opportunity-3', 'project-2'].sort(),
      );
      ui.setCollapsed('opportunity-1', false);
      expect(Object.keys(tree.placed)).toHaveLength(TREE.length);

      ui.setProject('project-2');
      expect(Object.keys(tree.placed)).toEqual(['project-2']);
      ui.setProject('project-1');
      expect(Object.keys(tree.placed).sort()).toEqual(ORDER.filter(k => k !== 'project-2').sort());
    });

    it('descendantCount counts the whole subtree and follows structural changes', async () => {
      expect(tree.descendantCount('project-1')).toBe(8);
      expect(tree.descendantCount('opportunity-1')).toBe(4);
      expect(tree.descendantCount('solution-1')).toBe(2);
      expect(tree.descendantCount('evidence-1')).toBe(0);
      expect(tree.descendantCount('project-2')).toBe(0);
      expect(tree.descendantCount('solution-99')).toBe(0);

      service.deleteNode.resolves();
      await tree.deleteNode('assumption-1');
      expect(tree.descendantCount('project-1')).toBe(6);
      expect(tree.descendantCount('solution-1')).toBe(0);
    });

    it('descendantCount never loops on cyclic data', () => {
      const nodes = sampleNodes();
      nodes.find(n => n.id === 'opportunity-1')!.parent = 'opportunity-2';
      tree.nodes = nodes;
      expect(tree.descendantCount('opportunity-1')).toBeGreaterThanOrEqual(0);
      expect(tree.descendantCount('project-1')).toBe(1);
    });

    it('ancestors runs from the project down to the direct parent', () => {
      expect(tree.ancestors('evidence-1').map(n => n.id)).toEqual([
        'project-1',
        'outcome-1',
        'opportunity-1',
        'solution-1',
        'assumption-1',
      ]);
      expect(tree.ancestors('project-1')).toEqual([]);
      expect(tree.ancestors('solution-99')).toEqual([]);
    });

    it('selected is the node selected in the view', async () => {
      expect(tree.selected).toBeUndefined();
      ui.select('solution-1');
      expect(tree.selected?.id).toBe('solution-1');
      service.deleteNode.resolves();
      await tree.deleteNode('opportunity-1');
      expect(tree.selected).toBeUndefined();
    });
  });

  describe('derived layout at scale', () => {
    it('keeps placed and descendantCount fast on a 300+ node tree while nodes are edited', async () => {
      const big = bigTreeDtos(3, 25);
      expect(big.length).toBeGreaterThan(300);
      service.getTree.resolves(big);
      await tree.loadTree();
      expect(Object.keys(tree.placed)).toHaveLength(big.length);
      const project = big[0].key;
      expect(tree.descendantCount(project)).toBe(big.filter((_, i) => i > 0 && i < big.length / 3).length);

      const opportunity = big.find(d => d.type === 'OPPORTUNITY')!;
      service.patchNode.callsFake(async (_type, _id, body) =>
        dto(opportunity.key, opportunity.parentKey, { ...opportunity, priority: body.priority ?? null }),
      );
      const started = performance.now();
      for (let i = 1; i <= 20; i++) {
        await tree.patchNode(opportunity.key, { priority: i });
        void tree.placed;
        for (const n of tree.nodes) tree.descendantCount(n.id);
      }
      expect(performance.now() - started).toBeLessThan(1500);
      expect(tree.byId(opportunity.key)?.priority).toBe(20);
    });
  });
});

describe('OST tree store without a document service', () => {
  let tree: ReturnType<typeof useOstTreeStore>;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    tree = useOstTreeStore();
  });

  it('cannot load a tree', async () => {
    expect(await tree.loadTree()).toBe(false);
    expect(tree.error).toBe('No tree is open.');
    expect(tree.loaded).toBe(false);
    expect(tree.nodes).toEqual([]);
  });

  it('every write fails with the same message and changes nothing', async () => {
    const NO_TREE = 'No tree is open.';
    tree.nodes = orderTree(
      sampleNodes().map(n =>
        n.id === 'opportunity-1'
          ? { ...n, links: [{ id: 1, name: 'Doc', url: 'https://x.test' }], questions: [{ id: 1, text: 'Who?', done: false }] }
          : n,
      ),
    );
    const before = JSON.stringify(tree.nodes);
    const attempts: [string, () => Promise<unknown>, unknown][] = [
      ['patchNode', () => tree.patchNode('opportunity-1', { title: 'Renamed' }), false],
      ['createNode', () => tree.createNode('solution-1'), null],
      ['createProject', () => tree.createProject(), null],
      ['moveNode', () => tree.moveNode('solution-1', 'opportunity-2'), false],
      ['reorderNode', () => tree.reorderNode('assumption-2', 1), false],
      ['deleteNode', () => tree.deleteNode('solution-1'), false],
      ['addLink', () => tree.addLink('opportunity-1', { name: 'Doc', url: 'https://x.test' }), false],
      ['updateLink', () => tree.updateLink('opportunity-1', 1, { name: 'Spec' }), false],
      ['removeLink', () => tree.removeLink('opportunity-1', 1), false],
      ['addQuestion', () => tree.addQuestion('opportunity-1', 'Why?'), false],
      ['updateQuestion', () => tree.updateQuestion('opportunity-1', 1, { done: true }), false],
      ['removeQuestion', () => tree.removeQuestion('opportunity-1', 1), false],
    ];
    for (const [name, attempt, expected] of attempts) {
      tree.clearError();
      expect(await attempt(), name).toBe(expected);
      expect(tree.error, name).toBe(NO_TREE);
      expect(JSON.stringify(tree.nodes), name).toBe(before);
    }
  });
});

/**
 * The store as the app runs it: against the real document service and an in-memory document
 * (ids in the small test document: project 1, outcome 2, opportunities 3 / 5 / 11 / 14, solutions 6 / 10 /
 * 12, assumptions 7 / 9 / 13, evidence 4 / 8).
 */
describe('OST tree store on a real document', () => {
  const SAMPLE_ORDER = [
    'project-1',
    'outcome-2',
    'opportunity-3',
    'opportunity-5',
    'solution-6',
    'assumption-7',
    'evidence-8',
    'assumption-9',
    'solution-10',
    'evidence-4',
    'opportunity-11',
    'solution-12',
    'assumption-13',
    'opportunity-14',
  ];

  let service: LocalDocumentService;
  let changed: ReturnType<typeof vi.fn<() => void>>;
  let tree: ReturnType<typeof useOstTreeStore>;
  let ui: ReturnType<typeof useOstUiStore>;

  const ids = () => tree.nodes.map(n => n.id);
  const stored = (id: number) => service.snapshot()!.nodes.find(n => n.id === id);
  /** Stored ids of the same-type children of one parent, in sortOrder. */
  const storedOrder = (type: string, parentId: number | null) =>
    service
      .snapshot()!
      .nodes.filter(n => n.type === type && n.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(n => n.id);
  /**
   * The store must show exactly what a fresh read of the document gives. `modified: false` leaves
   * lastModifiedDate out of the comparison (see the todo on link and question edits below).
   */
  const expectInStep = async ({ modified = true } = {}) => {
    const copy = () => tree.nodes.map(n => ({ ...n, ...(modified ? {} : { lastModifiedDate: null }) }));
    const shown = copy();
    expect(await tree.loadTree({ keepCollapsed: true })).toBe(true);
    expect(shown).toEqual(copy());
  };

  beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    service = new LocalDocumentService();
    service.open(smallDocument(new Date('2026-09-01T10:00:00Z')));
    changed = vi.fn<() => void>();
    service.onChange(changed);
    tree = useOstTreeStore();
    ui = useOstUiStore();
    tree.setServiceFactory(() => service);
    expect(await tree.loadTree()).toBe(true);
  });

  it('loads the document in tree pre-order, without counting as a change', () => {
    expect(ids()).toEqual(SAMPLE_ORDER);
    expect(tree.byId('opportunity-3')).toMatchObject({ status: 'exploring', priority: 82, value: 4 });
    expect(tree.byId('opportunity-3')?.questions).toHaveLength(2);
    expect(tree.byId('opportunity-11')?.links).toEqual([{ id: 1, name: 'Interview notes', url: 'https://example.com/interview-notes' }]);
    expect(tree.byId('assumption-7')?.owner).toBe('Research');
    expect(Object.keys(tree.placed)).toHaveLength(SAMPLE_ORDER.length);
    expect(changed).not.toHaveBeenCalled();
  });

  it('cannot load once the document is closed', async () => {
    service.close();
    expect(await tree.loadTree()).toBe(false);
    expect(tree.error).toBe('No tree is open.');
    expect(tree.nodes).toEqual([]);
  });

  it('stores a patch and shows the cleaned values', async () => {
    expect(await tree.patchNode('assumption-7', { title: '  People accept it  ', owner: '  Ana  ', conf: 75, status: 'supported' })).toBe(
      true,
    );
    expect(tree.byId('assumption-7')).toMatchObject({ title: 'People accept it', owner: 'Ana', conf: 75, status: 'supported' });
    expect(stored(7)).toMatchObject({ title: 'People accept it', owner: 'Ana', confidence: 75, status: 'supported' });
    expect(tree.byId('assumption-7')?.lastModifiedDate).toBe(stored(7)?.lastModifiedDate);
    expect(stored(7)?.lastModifiedDate).not.toBe('2026-09-01T10:00:00.000Z');

    expect(await tree.patchNode('assumption-7', { owner: '', note: 'Seen twice' })).toBe(true);
    expect(tree.byId('assumption-7')).toMatchObject({ owner: '', note: 'Seen twice' });
    expect(stored(7)).toMatchObject({ owner: null, notes: 'Seen twice' });
    expect(changed).toHaveBeenCalledTimes(2);
    await expectInStep();
  });

  it('rolls a refused patch back and leaves the document untouched', async () => {
    const before = service.snapshot();
    const refused = async (key: string, patch: Parameters<typeof tree.patchNode>[1], message: string) => {
      const shown = { ...tree.byId(key)! };
      expect(await tree.patchNode(key, patch)).toBe(false);
      expect(tree.error).toBe(message);
      expect({ ...tree.byId(key)! }).toEqual(shown);
    };
    await refused('project-1', { title: 'x' }, 'Project names need 2 to 100 characters.');
    await refused('project-1', { title: 'x'.repeat(101) }, 'Project names need 2 to 100 characters.');
    await refused('opportunity-3', { title: 'x'.repeat(201) }, 'Titles need 2 to 200 characters.');
    await refused('assumption-7', { title: ' ' }, 'Titles need 2 to 500 characters.');
    await refused('opportunity-3', { status: 'shipped' }, 'That status is not valid for this node.');
    await refused('opportunity-3', { priority: 0 }, 'Priority must be between 1 and 100.');
    await refused('opportunity-3', { value: 6 }, 'Value must be between 1 and 5.');
    await refused('assumption-7', { conf: 101 }, 'Confidence must be between 0 and 100.');
    await refused('solution-6', { priority: 10 }, 'That field does not apply to this node.');
    // One bad value refuses the whole patch.
    await refused('opportunity-3', { title: 'Fine title', priority: 500 }, 'Priority must be between 1 and 100.');
    expect(service.snapshot()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it('creates a child with the defaults of its type, placed last', async () => {
    ui.setCollapsed('solution-6', true);
    const key = await tree.createNode('solution-6');
    expect(key).toBe('assumption-15');
    expect(tree.byId('assumption-15')).toMatchObject({
      parent: 'solution-6',
      title: 'New assumption',
      status: 'untested',
      conf: 40,
      sortOrder: 2,
    });
    expect(stored(15)).toMatchObject({ type: 'assumption', parentId: 6, title: 'New assumption', sortOrder: 2 });
    expect(ids().indexOf('assumption-15')).toBe(ids().indexOf('assumption-9') + 1);
    expect(ui.selectedId).toBe('assumption-15');
    expect(ui.editingId).toBe('assumption-15');
    expect(ui.collapsed['solution-6']).toBe(false);
    expect(tree.descendantCount('solution-6')).toBe(4);

    expect(await tree.createNode('opportunity-3', 'evidence', '  Interview 11  ')).toBe('evidence-16');
    expect(stored(16)).toMatchObject({ type: 'evidence', parentId: 3, title: 'Interview 11', sortOrder: 1 });
    expect(await tree.createNode('opportunity-3', 'opportunity')).toBe('opportunity-17');
    expect(tree.byId('opportunity-17')).toMatchObject({ status: 'unexplored', priority: 50, value: 3, sortOrder: 1 });
    expect(changed).toHaveBeenCalledTimes(3);
    await expectInStep();
  });

  it('refuses a child title that is too long, creating nothing', async () => {
    expect(await tree.createNode('outcome-2', 'opportunity', 'x'.repeat(201))).toBeNull();
    expect(tree.error).toBe('Titles need 2 to 200 characters (100 for projects, 500 for assumptions and evidence).');
    expect(ids()).toEqual(SAMPLE_ORDER);
    expect(service.snapshot()!.nodes).toHaveLength(SAMPLE_ORDER.length);
    expect(changed).not.toHaveBeenCalled();
  });

  it('creates a project as a new branch, placed last', async () => {
    ui.setProject('project-1');
    expect(await tree.createProject()).toBe('project-15');
    expect(ids()).toEqual([...SAMPLE_ORDER, 'project-15']);
    expect(tree.byId('project-15')).toMatchObject({ parent: null, title: 'New project', sortOrder: 1 });
    expect(stored(15)).toMatchObject({ type: 'project', parentId: null, sortOrder: 1 });
    expect(ui.projectId).toBe('project-15');
    expect(Object.keys(tree.placed)).toEqual(['project-15']);

    expect(await tree.createNode('project-15', undefined, 'Fewer abandoned plans')).toBe('outcome-16');
    expect(Object.keys(tree.placed).sort()).toEqual(['outcome-16', 'project-15']);

    expect(await tree.createProject('x'.repeat(101))).toBeNull();
    expect(tree.error).toBe('Project names need 2 to 100 characters.');
    expect(ui.projectId).toBe('project-15');
    expect(service.snapshot()!.nodes).toHaveLength(SAMPLE_ORDER.length + 2);
  });

  it('re-parents a node and renumbers both sibling groups', async () => {
    ui.setCollapsed('opportunity-11', true);
    expect(await tree.moveNode('solution-6', 'opportunity-11')).toBe(true);
    expect(tree.byId('solution-6')).toMatchObject({ parent: 'opportunity-11', sortOrder: 1 });
    expect(stored(6)).toMatchObject({ parentId: 11, sortOrder: 1 });
    expect(storedOrder('solution', 11)).toEqual([12, 6]);
    // The solution left behind closes the gap, in the document and in the store.
    expect(stored(10)?.sortOrder).toBe(0);
    expect(tree.byId('solution-10')?.sortOrder).toBe(0);
    expect(ui.collapsed['opportunity-11']).toBe(false);
    expect(ids()).toEqual([
      'project-1',
      'outcome-2',
      'opportunity-3',
      'opportunity-5',
      'solution-10',
      'evidence-4',
      'opportunity-11',
      'solution-12',
      'assumption-13',
      'solution-6',
      'assumption-7',
      'evidence-8',
      'assumption-9',
      'opportunity-14',
    ]);
    await expectInStep();
  });

  it('re-parents into a position', async () => {
    expect(await tree.moveNode('solution-10', 'opportunity-11', 0)).toBe(true);
    expect(storedOrder('solution', 11)).toEqual([10, 12]);
    expect(tree.byId('solution-10')).toMatchObject({ parent: 'opportunity-11', sortOrder: 0 });
    expect(tree.byId('solution-12')?.sortOrder).toBe(1);
    expect(ids().indexOf('solution-10')).toBe(ids().indexOf('opportunity-11') + 1);

    // A nested opportunity moves up next to its former parent.
    expect(await tree.moveNode('opportunity-5', 'outcome-2', 1)).toBe(true);
    expect(storedOrder('opportunity', 2)).toEqual([3, 5, 11, 14]);
    expect(tree.nodes.filter(n => n.parent === 'outcome-2').map(n => n.id)).toEqual([
      'opportunity-3',
      'opportunity-5',
      'opportunity-11',
      'opportunity-14',
    ]);
    await expectInStep();
  });

  it('refuses an illegal move before it reaches the document', async () => {
    expect(await tree.moveNode('opportunity-3', 'opportunity-5')).toBe(false);
    expect(await tree.moveNode('assumption-7', 'opportunity-11')).toBe(false);
    expect(tree.error).toBe(CANNOT_GO_THERE);
    expect(ids()).toEqual(SAMPLE_ORDER);
    expect(changed).not.toHaveBeenCalled();
  });

  it('reorders siblings one place at a time', async () => {
    expect(await tree.reorderNode('opportunity-3', -1)).toBe(false);
    expect(await tree.reorderNode('opportunity-14', 1)).toBe(false);
    expect(changed).not.toHaveBeenCalled();

    expect(await tree.reorderNode('opportunity-11', -1)).toBe(true);
    expect(storedOrder('opportunity', 2)).toEqual([11, 3, 14]);
    expect(ids().slice(0, 6)).toEqual(['project-1', 'outcome-2', 'opportunity-11', 'solution-12', 'assumption-13', 'opportunity-3']);

    expect(await tree.reorderNode('opportunity-11', 1)).toBe(true);
    expect(storedOrder('opportunity', 2)).toEqual([3, 11, 14]);
    expect(ids()).toEqual(SAMPLE_ORDER);

    expect(await tree.reorderNode('opportunity-11', 1)).toBe(true);
    expect(storedOrder('opportunity', 2)).toEqual([3, 14, 11]);
    expect(await tree.reorderNode('opportunity-11', 1)).toBe(false);

    expect(await tree.reorderNode('opportunity-3', 1)).toBe(true);
    expect(storedOrder('opportunity', 2)).toEqual([14, 3, 11]);
    expect(tree.nodes.filter(n => n.parent === 'outcome-2').map(n => n.id)).toEqual(['opportunity-14', 'opportunity-3', 'opportunity-11']);
    // A reorder is not an edit of the node: only a re-parent stamps it.
    expect(stored(3)?.lastModifiedDate).toBe('2026-09-01T10:00:00.000Z');
    await expectInStep();
  });

  it('reorders projects', async () => {
    expect(await tree.reorderNode('project-1', 1)).toBe(false);
    await tree.createProject('Second project');
    await tree.createProject('Third project');
    expect(tree.projects.map(p => p.id)).toEqual(['project-1', 'project-15', 'project-16']);

    expect(await tree.reorderNode('project-16', -1)).toBe(true);
    expect(storedOrder('project', null)).toEqual([1, 16, 15]);
    expect(await tree.moveNode('project-15', null, 0)).toBe(true);
    expect(storedOrder('project', null)).toEqual([15, 1, 16]);
    expect(tree.projects.map(p => p.id)).toEqual(['project-15', 'project-1', 'project-16']);
    expect(ids()[0]).toBe('project-15');
    expect(ids().at(-1)).toBe('project-16');
    await expectInStep();
  });

  it('deletes a subtree from the store and from the document', async () => {
    ui.select('assumption-7');
    ui.setCollapsed('solution-6', true);
    expect(await tree.deleteNode('opportunity-3')).toBe(true);
    expect(ids()).toEqual(['project-1', 'outcome-2', 'opportunity-11', 'solution-12', 'assumption-13', 'opportunity-14']);
    expect(
      service
        .snapshot()!
        .nodes.map(n => n.id)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 11, 12, 13, 14]);
    expect(ui.selectedId).toBeNull();
    expect(ui.collapsed).toEqual({});
    expect(tree.descendantCount('project-1')).toBe(5);
    expect(changed).toHaveBeenCalledTimes(1);

    // Ids are never reused.
    expect(await tree.createNode('outcome-2')).toBe('opportunity-15');
    await expectInStep();
  });

  it('deletes the last project, leaving an empty tree', async () => {
    expect(await tree.deleteNode('project-1')).toBe(true);
    expect(tree.nodes).toEqual([]);
    expect(service.snapshot()!.nodes).toEqual([]);
    expect(tree.placed).toEqual({});
    expect(await tree.createProject('Start again')).toBe('project-15');
    expect(tree.byId('project-15')?.sortOrder).toBe(0);
  });

  it('adds, edits and removes links', async () => {
    expect(await tree.addLink('outcome-2', { name: '  Plan  ', url: ' https://example.com/plan ' })).toBe(true);
    expect(tree.byId('outcome-2')?.links).toEqual([{ id: 2, name: 'Plan', url: 'https://example.com/plan' }]);
    expect(stored(2)?.links).toEqual([{ id: 2, name: 'Plan', url: 'https://example.com/plan' }]);

    expect(await tree.updateLink('outcome-2', 2, { name: ' Roadmap ' })).toBe(true);
    expect(await tree.updateLink('outcome-2', 2, { url: 'mailto:someone@example.com' })).toBe(true);
    expect(tree.byId('outcome-2')?.links).toEqual([{ id: 2, name: 'Roadmap', url: 'mailto:someone@example.com' }]);
    expect(stored(2)?.links).toEqual([{ id: 2, name: 'Roadmap', url: 'mailto:someone@example.com' }]);

    expect(await tree.removeLink('opportunity-11', 1)).toBe(true);
    expect(tree.byId('opportunity-11')?.links).toEqual([]);
    expect(stored(11)?.links).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(4);
    await expectInStep({ modified: false });
  });

  it('refuses unsafe or empty links, leaving store and document as they were', async () => {
    const before = service.snapshot();
    expect(await tree.addLink('outcome-2', { name: 'Script', url: 'javascript:alert(1)' })).toBe(false);
    expect(tree.error).toBe('Links must start with http://, https:// or mailto:.');
    expect(await tree.addLink('outcome-2', { name: '   ', url: 'https://example.com' })).toBe(false);
    expect(tree.error).toBe('Link names need 1 to 100 characters.');
    expect(tree.byId('outcome-2')?.links).toEqual([]);

    expect(await tree.updateLink('opportunity-11', 1, { url: 'ftp://example.com/file' })).toBe(false);
    expect(tree.error).toBe('Links must start with http://, https:// or mailto:.');
    expect(await tree.updateLink('opportunity-11', 1, { name: '' })).toBe(false);
    expect(tree.byId('opportunity-11')?.links).toEqual([{ id: 1, name: 'Interview notes', url: 'https://example.com/interview-notes' }]);
    expect(service.snapshot()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it('adds, edits and removes open questions', async () => {
    expect(await tree.addQuestion('opportunity-11', '  Why now?  ')).toBe(true);
    expect(tree.byId('opportunity-11')?.questions).toEqual([{ id: 3, text: 'Why now?', done: false }]);

    expect(await tree.updateQuestion('opportunity-11', 3, { done: true })).toBe(true);
    expect(await tree.updateQuestion('opportunity-11', 3, { text: ' Why this quarter? ' })).toBe(true);
    expect(tree.byId('opportunity-11')?.questions).toEqual([{ id: 3, text: 'Why this quarter?', done: true }]);
    expect(stored(11)?.questions).toEqual([{ id: 3, text: 'Why this quarter?', done: true }]);

    expect(await tree.removeQuestion('opportunity-3', 1)).toBe(true);
    expect(tree.byId('opportunity-3')?.questions).toEqual([{ id: 2, text: 'Who in the household decides?', done: true }]);
    expect(stored(3)?.questions).toEqual([{ id: 2, text: 'Who in the household decides?', done: true }]);
    expect(changed).toHaveBeenCalledTimes(4);
    await expectInStep({ modified: false });
  });

  // The document stamps the node on every link and question change; the store keeps the old stamp.
  it.todo('a link or question change updates the lastModifiedDate shown for its node');

  it('refuses empty questions, and questions on anything but an opportunity', async () => {
    const before = service.snapshot();
    expect(await tree.addQuestion('opportunity-11', '   ')).toBe(false);
    expect(tree.error).toBe('Questions need 1 to 500 characters.');
    expect(await tree.updateQuestion('opportunity-3', 1, { text: 'x'.repeat(501) })).toBe(false);
    expect(tree.byId('opportunity-3')?.questions[0]).toEqual({ id: 1, text: 'Is this worse on weekdays than at weekends?', done: false });
    expect(await tree.addQuestion('solution-6', 'Not here')).toBe(false);
    expect(service.snapshot()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it('a reload with keepCollapsed keeps the collapsed branches; opening another document starts expanded', async () => {
    ui.setCollapsed('opportunity-3', true);
    expect(await tree.loadTree({ keepCollapsed: true })).toBe(true);
    expect(ui.collapsed).toEqual({ 'opportunity-3': true });
    expect(tree.placed['solution-6']).toBeUndefined();

    service.open(smallDocument());
    expect(await tree.loadTree()).toBe(true);
    expect(ui.collapsed).toEqual({});
    expect(tree.placed['solution-6']).toBeDefined();
    expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual({});
  });
  describe('projects inside projects', () => {
    // Added to the small document:
    //   project-1 > (outcome-2 > …, project-15 "Planner" > project-16 "Favourites" > outcome-17), project-18 "Other" at the top
    beforeEach(async () => {
      expect(await tree.createNode('project-1', 'project', 'Planner')).toBe('project-15');
      expect(await tree.createNode('project-15', 'project', 'Favourites')).toBe('project-16');
      expect(await tree.createNode('project-16', 'outcome', 'Remembered meals')).toBe('outcome-17');
      expect(await tree.createProject('Other')).toBe('project-18');
      changed.mockClear();
    });

    it("a sub-project is an ordinary child of its project, listed after the project's own outcomes", async () => {
      expect(ids()).toEqual([...SAMPLE_ORDER, 'project-15', 'project-16', 'outcome-17', 'project-18']);
      expect(stored(15)).toMatchObject({ type: 'project', parentId: 1, sortOrder: 0 });
      expect(stored(16)).toMatchObject({ type: 'project', parentId: 15, sortOrder: 0 });
      expect(tree.projects.map(p => p.id)).toEqual(['project-1', 'project-15', 'project-16', 'project-18']);
      expect(tree.ancestors('outcome-17').map(n => n.id)).toEqual(['project-1', 'project-15', 'project-16']);
      expect(tree.descendantCount('project-15')).toBe(2);
      // Only a project takes a project.
      expect(await tree.createNode('outcome-2', 'project')).toBeNull();
      expect(tree.error).toBe('That node cannot go there.');
      expect(changed).not.toHaveBeenCalled();
      await expectInStep();
    });

    it('with all projects shown, only the top-level projects are the tops of the canvas', () => {
      expect(ui.projectId).toBe('all');
      expect(tree.roots.map(p => p.id)).toEqual(['project-1', 'project-18']);
      expect(Object.keys(tree.placed)).toHaveLength(SAMPLE_ORDER.length + 4);
      expect(tree.placed['project-1'].depth).toBe(0);
      expect(tree.placed['project-15'].depth).toBe(1);
      expect(tree.placed['project-16'].depth).toBe(2);
      expect(tree.placed['outcome-17'].depth).toBe(3);
      expect(tree.placed['project-18'].depth).toBe(0);
      expect(tree.inScope('outcome-17')).toBe(true);
    });

    it('focusing a project, top-level or nested, shows exactly its subtree', () => {
      ui.setProject('project-15');
      expect(tree.roots.map(p => p.id)).toEqual(['project-15']);
      expect(Object.keys(tree.placed).sort()).toEqual(['outcome-17', 'project-15', 'project-16']);
      expect(tree.placed['project-15']).toMatchObject({ depth: 0, y: 0 });
      expect(['project-15', 'project-16', 'outcome-17'].every(tree.inScope)).toBe(true);
      expect(['project-1', 'outcome-2', 'opportunity-3', 'project-18', 'gone-1'].some(tree.inScope)).toBe(false);

      ui.setProject('project-16');
      expect(Object.keys(tree.placed).sort()).toEqual(['outcome-17', 'project-16']);
      expect(tree.inScope('project-15')).toBe(false);

      ui.setProject('project-1');
      expect(Object.keys(tree.placed)).toHaveLength(SAMPLE_ORDER.length + 3);
      expect(tree.inScope('project-18')).toBe(false);

      ui.setProject('all');
      expect(Object.keys(tree.placed)).toHaveLength(SAMPLE_ORDER.length + 4);
    });

    it('a node created inside the focused project stays on the canvas', async () => {
      ui.setProject('project-16');
      expect(await tree.createNode('project-16', 'project', 'Deeper')).toBe('project-19');
      expect(ui.projectId).toBe('project-16');
      expect(tree.placed['project-19']).toMatchObject({ depth: 1 });
      // "+ Project" in the toolbar makes a top-level project: the canvas follows it there.
      expect(await tree.createProject('Brand new')).toBe('project-20');
      expect(tree.byId('project-20')?.parent).toBeNull();
      expect(ui.projectId).toBe('project-20');
    });

    it('re-parents a project under another project, with everything inside it', async () => {
      ui.setCollapsed('project-18', true);
      expect(await tree.moveNode('project-15', 'project-18')).toBe(true);
      expect(tree.byId('project-15')).toMatchObject({ parent: 'project-18', sortOrder: 0 });
      expect(stored(15)).toMatchObject({ parentId: 18, sortOrder: 0 });
      expect(stored(16)?.parentId).toBe(15);
      expect(ui.collapsed['project-18']).toBe(false);
      expect(tree.ancestors('outcome-17').map(n => n.id)).toEqual(['project-18', 'project-15', 'project-16']);
      expect(ids().slice(-4)).toEqual(['project-18', 'project-15', 'project-16', 'outcome-17']);
      // A top-level project nests the same way, and the top level closes the gap.
      expect(await tree.moveNode('project-18', 'project-1')).toBe(true);
      expect(tree.roots.map(p => p.id)).toEqual(['project-1']);
      expect(storedOrder('project', null)).toEqual([1]);
      expect(storedOrder('project', 1)).toEqual([18]);
      await expectInStep();
    });

    it('refuses to move a project under itself or into its own subtree, before and inside the document', async () => {
      const before = service.snapshot();
      for (const [key, target] of [
        ['project-1', 'project-1'],
        ['project-1', 'project-15'],
        ['project-1', 'project-16'],
        ['project-15', 'project-16'],
        ['project-18', 'outcome-17'],
        ['project-16', 'project-15'], // already there
      ]) {
        tree.clearError();
        expect(await tree.moveNode(key, target), `${key} under ${target}`).toBe(false);
        expect(tree.error, `${key} under ${target}`).toBe('That node cannot go there.');
      }
      expect(service.snapshot()).toEqual(before);
      expect(changed).not.toHaveBeenCalled();
      // The document service refuses the same move by itself, with the reason.
      await expect(service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: 16 })).rejects.toThrow(
        'A node cannot move under its own descendant.',
      );
      expect(service.snapshot()).toEqual(before);
    });

    it('reorders sub-projects among themselves with the keyboard step, apart from the outcomes beside them', async () => {
      expect(await tree.createNode('project-1', 'project', 'Shopping')).toBe('project-19');
      expect(storedOrder('project', 1)).toEqual([15, 19]);
      expect(await tree.reorderNode('project-19', -1)).toBe(true);
      expect(storedOrder('project', 1)).toEqual([19, 15]);
      expect(storedOrder('outcome', 1)).toEqual([2]);
      expect(tree.projects.map(p => p.id)).toEqual(['project-1', 'project-19', 'project-15', 'project-16', 'project-18']);
      expect(await tree.reorderNode('project-19', -1)).toBe(false);
      expect(await tree.reorderNode('project-19', 1)).toBe(true);
      expect(storedOrder('project', 1)).toEqual([15, 19]);
      // Top-level projects still reorder among the top-level projects only.
      expect(await tree.reorderNode('project-18', -1)).toBe(true);
      expect(storedOrder('project', null)).toEqual([18, 1]);
      await expectInStep();
    });

    it('moves a sub-project out to the top level; one that leaves the focused project brings every project back', async () => {
      ui.setProject('project-15');
      expect(await tree.moveNode('project-16', null)).toBe(true);
      expect(tree.byId('project-16')).toMatchObject({ parent: null, sortOrder: 2 });
      expect(stored(16)).toMatchObject({ parentId: null, sortOrder: 2 });
      expect(storedOrder('project', null)).toEqual([1, 18, 16]);
      expect(stored(17)?.parentId).toBe(16);
      expect(ui.projectId).toBe('all');
      expect(tree.roots.map(p => p.id)).toEqual(['project-1', 'project-18', 'project-16']);
      // Only a project may be at the top.
      expect(await tree.moveNode('outcome-17', null)).toBe(false);
      expect(stored(17)?.parentId).toBe(16);
      await expectInStep();
    });

    it('a move inside the focused project keeps the focus', async () => {
      ui.setProject('project-1');
      expect(await tree.moveNode('project-16', 'project-1')).toBe(true);
      expect(ui.projectId).toBe('project-1');
      expect(tree.placed['outcome-17']).toBeDefined();
    });

    it('deleting the focused sub-project deletes what is inside it and shows every project again', async () => {
      ui.setProject('project-15');
      ui.setCollapsed('project-16', true);
      expect(await tree.deleteNode('project-15')).toBe(true);
      expect(ui.projectId).toBe('all');
      expect(ui.collapsed).toEqual({});
      expect(ids()).toEqual([...SAMPLE_ORDER, 'project-18']);
      expect(
        service
          .snapshot()!
          .nodes.map(n => n.id)
          .filter(id => id >= 15),
      ).toEqual([18]);
    });
  });
});
