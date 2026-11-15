import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuleError } from '@/ost/ost-errors';
import type { TreeNodeDTO } from '@/ost/ost.model';

import { type DocNode, MAX_DEPTH, type OstDocument, emptyDocument, newNodeFields, serializeDocument, validateDocument } from './document';
import LocalDocumentService from './local-document-service';

/** project 1 > outcome 2 > opportunity 3 > (opportunity 4, solution 5 > assumption 6 > evidence 7, solution 8, evidence 9); project 10. */
function fixture(): OstDocument {
  const doc = emptyDocument('Fixture');
  const add = (id: number, type: DocNode['type'], parentId: number | null, sortOrder = 0, extra: Partial<DocNode> = {}) =>
    doc.nodes.push({
      id,
      type,
      parentId,
      title: `${type} ${id}`,
      notes: '',
      ...newNodeFields(type),
      sortOrder,
      createdDate: '2026-01-01T00:00:00.000Z',
      lastModifiedDate: '2026-01-01T00:00:00.000Z',
      links: [],
      questions: [],
      ...extra,
    });
  add(1, 'project', null, 0);
  add(2, 'outcome', 1);
  add(3, 'opportunity', 2, 0, {
    links: [{ id: 5, name: 'Notes', url: 'https://example.com/notes' }],
    questions: [{ id: 3, text: 'Who?', done: false }],
  });
  add(4, 'opportunity', 3);
  add(5, 'solution', 3, 0);
  add(6, 'assumption', 5);
  add(7, 'evidence', 6);
  add(8, 'solution', 3, 1);
  add(9, 'evidence', 3);
  add(10, 'project', null, 1);
  return doc;
}

const rule = async (promise: Promise<unknown>) => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RuleError);
  return (err as RuleError).key;
};

describe('LocalDocumentService', () => {
  let service: LocalDocumentService;
  let changes: ReturnType<typeof vi.fn<() => void>>;

  const nodeOf = (id: number) => service.snapshot()!.nodes.find(n => n.id === id);
  const order = (type: DocNode['type'], parentId: number | null) =>
    service
      .snapshot()!
      .nodes.filter(n => n.type === type && n.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(n => [n.id, n.sortOrder]);

  beforeEach(() => {
    service = new LocalDocumentService();
    changes = vi.fn<() => void>();
    service.onChange(changes);
    service.open(fixture());
  });

  describe('document lifecycle', () => {
    it('refuses everything until a document is open', async () => {
      const closed = new LocalDocumentService();
      expect(closed.isOpen).toBe(false);
      expect(closed.snapshot()).toBeNull();
      expect(await rule(closed.getTree())).toBe('nodocument');
      expect(await rule(closed.createNode({ type: 'PROJECT', parentType: null, parentId: null }))).toBe('nodocument');
    });

    it('keeps its own copy: neither the opened document nor a snapshot is the working document', async () => {
      const source = fixture();
      service.open(source);
      await service.patchNode('project', 1, { title: 'Renamed' });
      expect(source.nodes[0].title).toBe('project 1');
      const snap = service.snapshot()!;
      snap.nodes[0].title = 'Tampered';
      expect(nodeOf(1)!.title).toBe('Renamed');
    });

    it('opening is not a change; closing forgets the document', () => {
      expect(changes).not.toHaveBeenCalled();
      service.close();
      expect(service.isOpen).toBe(false);
      expect(service.name).toBe('');
    });

    it('renames (cleaned, never empty) and reports it once, only when the name changed', () => {
      expect(service.rename('  New   name ')).toBe('New name');
      expect(service.name).toBe('New name');
      expect(changes).toHaveBeenCalledTimes(1);
      expect(service.rename('New name')).toBe('New name');
      expect(changes).toHaveBeenCalledTimes(1);
      expect(service.rename('   ')).toBe('Untitled tree');
    });

    it('whatever the service holds is always a valid document', async () => {
      await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 10 });
      await service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 4 });
      await service.deleteNode('opportunity', 4);
      await service.addLink('project', 1, { name: 'Mail', url: 'mailto:team@example.com' });
      expect(() => validateDocument(service.snapshot())).not.toThrow();
    });
  });

  describe('getTree', () => {
    it('returns every node as a DTO: key, upper-case type and status, parent key', async () => {
      const tree = await service.getTree();
      expect(tree).toHaveLength(10);
      const byKey = Object.fromEntries(tree.map(n => [n.key, n])) as Record<string, TreeNodeDTO>;
      expect(byKey['project-1']).toMatchObject({ type: 'PROJECT', id: 1, parentKey: null, status: null, notes: null });
      expect(byKey['opportunity-4']).toMatchObject({
        type: 'OPPORTUNITY',
        parentKey: 'opportunity-3',
        status: 'UNEXPLORED',
        priority: 50,
        valueRating: 3,
      });
      expect(byKey['assumption-6']).toMatchObject({ parentKey: 'solution-5', status: 'UNTESTED', confidence: 40, owner: null });
      expect(byKey['opportunity-3'].links).toEqual([{ id: 5, name: 'Notes', url: 'https://example.com/notes' }]);
      expect(byKey['opportunity-3'].questions).toEqual([{ id: 3, text: 'Who?', done: false }]);
    });

    it('hands out copies: changing a DTO does not change the document', async () => {
      const [first] = await service.getTree();
      first.title = 'Tampered';
      (await service.getTree()).find(n => n.key === 'opportunity-3')!.links!.push({ id: 99, name: 'x', url: 'https://x' });
      expect(nodeOf(1)!.title).toBe('project 1');
      expect(nodeOf(3)!.links).toHaveLength(1);
    });
  });

  describe('createNode', () => {
    it('allocates the next id in the file, whatever the type', async () => {
      const a = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
      const b = await service.createNode({ type: 'EVIDENCE', parentType: 'ASSUMPTION', parentId: 6 });
      expect([a.id, b.id]).toEqual([11, 12]);
      expect(a.key).toBe('outcome-11');
      expect(b.parentKey).toBe('assumption-6');
    });

    it('never reuses an id in a session, even after the newest node is deleted', async () => {
      const a = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
      await service.deleteNode('outcome', a.id);
      const b = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
      expect(b.id).toBe(a.id + 1);
    });

    it('appends after its same-type siblings (0 for a first child)', async () => {
      const third = await service.createNode({ type: 'SOLUTION', parentType: 'OPPORTUNITY', parentId: 3 });
      expect(third.sortOrder).toBe(2);
      // Other types under the same parent do not count.
      const evidence = await service.createNode({ type: 'EVIDENCE', parentType: 'OPPORTUNITY', parentId: 3 });
      expect(evidence.sortOrder).toBe(1);
      const first = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 10 });
      expect(first.sortOrder).toBe(0);
    });

    it('gives a new node the defaults of its type, a default title and both dates', async () => {
      const opportunity = await service.createNode({ type: 'OPPORTUNITY', parentType: 'OUTCOME', parentId: 2 });
      expect(opportunity).toMatchObject({ title: 'New opportunity', status: 'UNEXPLORED', priority: 50, valueRating: 3, confidence: null });
      const assumption = await service.createNode({ type: 'ASSUMPTION', parentType: 'SOLUTION', parentId: 5 });
      expect(assumption).toMatchObject({ status: 'UNTESTED', confidence: 40, owner: null, links: [], questions: [] });
      const evidence = await service.createNode({ type: 'EVIDENCE', parentType: 'ASSUMPTION', parentId: 6 });
      expect(evidence).toMatchObject({ title: 'New snippet', status: null });
      expect(evidence.createdDate).toBe(evidence.lastModifiedDate);
      expect(Number.isNaN(Date.parse(evidence.createdDate!))).toBe(false);
    });

    it('takes a given title (trimmed) and refuses an invalid one', async () => {
      const made = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1, title: '  Grow  ' });
      expect(made.title).toBe('Grow');
      expect(await rule(service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1, title: 'x' }))).toBe('invalidtitle');
    });

    it('creates a project with no parent, placed last', async () => {
      const project = await service.createNode({ type: 'PROJECT', parentType: null, parentId: null });
      expect(project).toMatchObject({ key: 'project-11', parentKey: null, title: 'New project', sortOrder: 2 });
      // Half a parent is not a parent.
      expect(await rule(service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: null }))).toBe('invalidparent');
      expect(await rule(service.createNode({ type: 'PROJECT', parentType: null, parentId: 1 }))).toBe('invalidparent');
    });

    it('creates a sub-project under a project, ordered among the sub-projects, beside the outcomes', async () => {
      const first = await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 1, title: 'Inner' });
      expect(first).toMatchObject({ key: 'project-11', parentKey: 'project-1', title: 'Inner', sortOrder: 0, status: null });
      const second = await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 1 });
      expect(second).toMatchObject({ key: 'project-12', parentKey: 'project-1', sortOrder: 1 });
      // Sub-projects and outcomes are ordered separately: the next outcome follows outcome 2.
      expect((await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 })).sortOrder).toBe(1);
      // A sub-project is a full project: it takes outcomes and projects of its own.
      expect((await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 11 })).parentKey).toBe('project-11');
      expect((await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 11 })).parentKey).toBe('project-11');
      // The top-level projects are untouched.
      expect(order('project', null)).toEqual([
        [1, 0],
        [10, 1],
      ]);
      expect(() => validateDocument(service.snapshot())).not.toThrow();
    });

    it('only a project holds a project', async () => {
      for (const [parentType, parentId] of [
        ['OUTCOME', 2],
        ['OPPORTUNITY', 3],
        ['SOLUTION', 5],
        ['ASSUMPTION', 6],
        ['EVIDENCE', 7],
      ] as const) {
        expect(await rule(service.createNode({ type: 'PROJECT', parentType, parentId })), parentType).toBe('invalidparent');
      }
      expect(changes).not.toHaveBeenCalled();
    });

    it('nested projects count towards the depth limit', async () => {
      let parentId = 10;
      for (let depth = 2; depth <= MAX_DEPTH; depth++) {
        parentId = (await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId })).id;
      }
      expect(await rule(service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId }))).toBe('toodeep');
      expect(await rule(service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId }))).toBe('toodeep');
      expect(() => validateDocument(service.snapshot())).not.toThrow();
    });

    it('enforces the allowed parent -> child types', async () => {
      expect(await rule(service.createNode({ type: 'SOLUTION', parentType: 'OUTCOME', parentId: 2 }))).toBe('invalidparent');
      expect(await rule(service.createNode({ type: 'EVIDENCE', parentType: 'SOLUTION', parentId: 5 }))).toBe('invalidparent');
      expect(await rule(service.createNode({ type: 'OUTCOME', parentType: 'EVIDENCE', parentId: 7 }))).toBe('invalidparent');
      expect(await rule(service.createNode({ type: 'OUTCOME', parentType: null, parentId: null }))).toBe('parentmissing');
      expect(await rule(service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 99 }))).toBe('parentmissing');
      // The parent must be of the type the request says it is.
      expect(await rule(service.createNode({ type: 'OPPORTUNITY', parentType: 'OUTCOME', parentId: 3 }))).toBe('parentmissing');
      expect(await rule(service.createNode({ type: 'BET' as never, parentType: 'PROJECT', parentId: 1 }))).toBe('unknowntype');
    });

    it('reports a change only when something was created', async () => {
      await rule(service.createNode({ type: 'SOLUTION', parentType: 'OUTCOME', parentId: 2 }));
      expect(changes).not.toHaveBeenCalled();
      expect(service.snapshot()!.nodes).toHaveLength(10);
      await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
      expect(changes).toHaveBeenCalledTimes(1);
    });
  });

  describe('patchNode', () => {
    it('changes only the fields sent and stamps the modified date', async () => {
      const dto = await service.patchNode('opportunity', 3, { status: 'VALIDATED', priority: 90 });
      expect(dto).toMatchObject({ status: 'VALIDATED', priority: 90, valueRating: 3, title: 'opportunity 3' });
      expect(nodeOf(3)).toMatchObject({ status: 'validated', priority: 90 });
      expect(Date.parse(dto.lastModifiedDate!)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
      expect(dto.createdDate).toBe('2026-01-01T00:00:00.000Z');
    });

    it('accepts the node type in any case', async () => {
      expect((await service.patchNode('PROJECT', 1, { title: 'Upper' })).title).toBe('Upper');
    });

    it('trims titles and owners; null or empty clears notes and owner', async () => {
      await service.patchNode('assumption', 6, { title: '  Tidy  ', owner: '  Research  ', notes: 'n' });
      expect(nodeOf(6)).toMatchObject({ title: 'Tidy', owner: 'Research', notes: 'n' });
      const cleared = await service.patchNode('assumption', 6, { owner: null, notes: null });
      expect(cleared).toMatchObject({ owner: null, notes: null });
      expect(nodeOf(6)).toMatchObject({ owner: null, notes: '' });
      expect((await service.patchNode('assumption', 6, { owner: '   ' })).owner).toBeNull();
    });

    it('applies the title limit of the node type', async () => {
      expect(await rule(service.patchNode('project', 1, { title: 'p'.repeat(101) }))).toBe('invalidtitle');
      expect((await service.patchNode('outcome', 2, { title: 'o'.repeat(200) })).title).toHaveLength(200);
      expect(await rule(service.patchNode('outcome', 2, { title: 'o'.repeat(201) }))).toBe('invalidtitle');
      expect((await service.patchNode('evidence', 7, { title: 'e'.repeat(500) })).title).toHaveLength(500);
      expect(await rule(service.patchNode('evidence', 7, { title: ' x ' }))).toBe('invalidtitle');
    });

    it('refuses values outside their range', async () => {
      expect(await rule(service.patchNode('opportunity', 3, { status: 'CANDIDATE' }))).toBe('invalidstatus');
      expect(await rule(service.patchNode('opportunity', 3, { priority: 0 }))).toBe('invalidpriority');
      expect(await rule(service.patchNode('opportunity', 3, { priority: 101 }))).toBe('invalidpriority');
      expect(await rule(service.patchNode('opportunity', 3, { priority: 50.5 }))).toBe('invalidpriority');
      expect(await rule(service.patchNode('opportunity', 3, { valueRating: 6 }))).toBe('invalidvaluerating');
      expect(await rule(service.patchNode('assumption', 6, { confidence: -1 }))).toBe('invalidconfidence');
      expect(await rule(service.patchNode('assumption', 6, { owner: 'o'.repeat(101) }))).toBe('invalidowner');
      expect(await rule(service.patchNode('project', 1, { notes: 'n'.repeat(20001) }))).toBe('invalidnotes');
      expect((await service.patchNode('assumption', 6, { confidence: 0 })).confidence).toBe(0);
    });

    it('refuses a field that does not apply to the node type', async () => {
      expect(await rule(service.patchNode('outcome', 2, { status: 'EXPLORING' }))).toBe('fieldnotapplicable');
      expect(await rule(service.patchNode('solution', 5, { confidence: 50 }))).toBe('fieldnotapplicable');
      expect(await rule(service.patchNode('solution', 5, { owner: 'Kim' }))).toBe('fieldnotapplicable');
      expect(await rule(service.patchNode('outcome', 2, { nope: 1 } as never))).toBe('fieldnotapplicable');
    });

    it('a refused patch changes nothing at all, even its valid fields', async () => {
      const before = nodeOf(3);
      expect(await rule(service.patchNode('opportunity', 3, { title: 'Fine title', priority: 500 }))).toBe('invalidpriority');
      expect(nodeOf(3)).toEqual(before);
      expect(changes).not.toHaveBeenCalled();
    });

    describe('colour', () => {
      it.each([
        ['project', 1],
        ['outcome', 2],
        ['opportunity', 3],
        ['solution', 5],
        ['assumption', 6],
        ['evidence', 7],
      ] as const)('sets a named colour on a %s and reports the change', async (type, id) => {
        const dto = await service.patchNode(type, id, { color: 'teal' });
        expect(dto.color).toBe('teal');
        expect(nodeOf(id)!.color).toBe('teal');
        expect(Date.parse(dto.lastModifiedDate!)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
        expect(changes).toHaveBeenCalledTimes(1);
        expect(service.undoStep?.label).toBe(`change colour of “${type} ${id}”`);
      });

      it('null is the default look: the key is gone, not null', async () => {
        await service.patchNode('solution', 5, { color: 'red' });
        const dto = await service.patchNode('solution', 5, { color: null });
        expect(dto.color).toBeNull();
        expect(nodeOf(5)).not.toHaveProperty('color');
        expect(serializeDocument(service.snapshot()!)).not.toContain('color');
      });

      it('a node without a colour reads as null', async () => {
        expect((await service.getTree()).every(n => n.color === null)).toBe(true);
      });

      it('leaves every other field alone, and travels with other fields in one patch', async () => {
        const before = nodeOf(3)!;
        await service.patchNode('opportunity', 3, { color: 'magenta' });
        expect(nodeOf(3)).toEqual({ ...before, color: 'magenta', lastModifiedDate: nodeOf(3)!.lastModifiedDate });
        await service.patchNode('opportunity', 3, { color: 'blue', priority: 12 });
        expect(nodeOf(3)).toMatchObject({ color: 'blue', priority: 12 });
        expect(service.undoStep?.label).toBe('edit “opportunity 3”');
      });

      it.each([
        ['a value that tries to carry CSS', 'red; background:url(https://example.com)'],
        ['a hex value', '#ff0000'],
        ['another case', 'RED'],
        ['an unknown name', 'chartreuse'],
        ['an empty string', ''],
        ['a number', 3],
        ['an object', { name: 'red' }],
      ])('refuses %s and changes nothing', async (_what, value) => {
        await service.patchNode('outcome', 2, { color: 'green' });
        changes.mockClear();
        const before = nodeOf(2);
        expect(await rule(service.patchNode('outcome', 2, { color: value as never, title: 'Valid title' }))).toBe('invalidcolor');
        expect(nodeOf(2)).toEqual(before);
        expect(changes).not.toHaveBeenCalled();
      });

      it('is one step to undo and one to redo, and the file follows', async () => {
        const start = serializeDocument(service.snapshot()!);
        await service.patchNode('assumption', 6, { color: 'orange' });
        const orange = serializeDocument(service.snapshot()!);
        await service.patchNode('assumption', 6, { color: 'grey' });
        expect(service.undoStep?.label).toBe('change colour of “assumption 6”');

        expect(service.undo()?.label).toBe('change colour of “assumption 6”');
        expect(nodeOf(6)!.color).toBe('orange');
        expect(serializeDocument(service.snapshot()!)).toBe(orange);
        service.undo();
        expect(nodeOf(6)).not.toHaveProperty('color');
        expect(serializeDocument(service.snapshot()!)).toBe(start);
        expect(service.undoStep).toBeNull();

        expect(service.redo()?.label).toBe('change colour of “assumption 6”');
        expect(nodeOf(6)!.color).toBe('orange');
        service.redo();
        expect(nodeOf(6)!.color).toBe('grey');
        expect(service.redoStep).toBeNull();
      });

      it('changing the colour marks the document as changed, and undoing it as unchanged again', async () => {
        const clean = service.mark();
        await service.patchNode('project', 1, { color: 'yellow' });
        expect(service.mark()).not.toBe(clean);
        service.undo();
        expect(service.mark()).toBe(clean);
      });

      it('a colour survives a move, and goes with its node when the node is deleted and brought back', async () => {
        await service.patchNode('solution', 8, { color: 'teal' });
        await service.moveNode({ nodeType: 'SOLUTION', nodeId: 8, parentType: 'OPPORTUNITY', parentId: 4 });
        expect(nodeOf(8)).toMatchObject({ parentId: 4, color: 'teal' });
        await service.deleteNode('solution', 8);
        expect(nodeOf(8)).toBeUndefined();
        service.undo();
        expect(nodeOf(8)).toMatchObject({ color: 'teal' });
      });
    });

    it('refuses an unknown node, or one of another type', async () => {
      expect(await rule(service.patchNode('outcome', 99, { title: 'Nope' }))).toBe('nodemissing');
      expect(await rule(service.patchNode('outcome', 3, { title: 'Nope' }))).toBe('nodemissing');
      expect(await rule(service.patchNode('widget', 3, { title: 'Nope' }))).toBe('unknowntype');
    });
  });

  describe('moveNode', () => {
    it('re-parents to the end of the new sibling group and renumbers both groups', async () => {
      // solutions under 3: [5, 8]; move 5 under opportunity 4 (no solutions yet)
      const res = await service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 4 });
      expect(res.node).toMatchObject({ key: 'solution-5', parentKey: 'opportunity-4', sortOrder: 0 });
      expect(order('solution', 4)).toEqual([[5, 0]]);
      expect(order('solution', 3)).toEqual([[8, 0]]);
      expect(res.siblings).toEqual(
        expect.arrayContaining([
          { key: 'solution-5', sortOrder: 0 },
          { key: 'solution-8', sortOrder: 0 },
        ]),
      );
      // The subtree came along untouched.
      expect(nodeOf(6)!.parentId).toBe(5);
      expect(Date.parse(res.node.lastModifiedDate!)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
    });

    it('re-parents at a position among the same-type children of the target', async () => {
      await service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 4 });
      const res = await service.moveNode({ nodeType: 'SOLUTION', nodeId: 8, parentType: 'OPPORTUNITY', parentId: 4, position: 0 });
      expect(res.node.sortOrder).toBe(0);
      expect(order('solution', 4)).toEqual([
        [8, 0],
        [5, 1],
      ]);
    });

    it('reorders within the same parent, without touching the modified date', async () => {
      for (let i = 0; i < 2; i++) await service.createNode({ type: 'SOLUTION', parentType: 'OPPORTUNITY', parentId: 3 });
      // [5, 8, 11, 12] -> move 12 to index 1
      const res = await service.moveNode({ nodeType: 'SOLUTION', nodeId: 12, parentType: 'OPPORTUNITY', parentId: 3, position: 1 });
      expect(order('solution', 3)).toEqual([
        [5, 0],
        [12, 1],
        [8, 2],
        [11, 3],
      ]);
      expect(res.siblings).toHaveLength(4);
      // move 5 to the end by leaving the position out; a position past the end is clamped
      await service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 3 });
      await service.moveNode({ nodeType: 'SOLUTION', nodeId: 12, parentType: 'OPPORTUNITY', parentId: 3, position: 99 });
      expect(order('solution', 3).map(([id]) => id)).toEqual([8, 11, 5, 12]);
      expect(nodeOf(8)!.lastModifiedDate).toBe('2026-01-01T00:00:00.000Z');
    });

    it('closes gaps and ties in sortOrder left by a hand-edited file', async () => {
      const doc = fixture();
      doc.nodes.find(n => n.id === 5)!.sortOrder = 7;
      doc.nodes.find(n => n.id === 8)!.sortOrder = 7;
      service.open(doc);
      await service.moveNode({ nodeType: 'SOLUTION', nodeId: 8, parentType: 'OPPORTUNITY', parentId: 3, position: 0 });
      expect(order('solution', 3)).toEqual([
        [8, 0],
        [5, 1],
      ]);
    });

    it('reorders projects (no parent)', async () => {
      const res = await service.moveNode({ nodeType: 'PROJECT', nodeId: 10, parentType: null, parentId: null, position: 0 });
      expect(res.node.parentKey).toBeNull();
      expect(order('project', null)).toEqual([
        [10, 0],
        [1, 1],
      ]);
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: 10, parentType: 'PROJECT', parentId: null }))).toBe(
        'invalidparent',
      );
    });

    it('nests a project under another project, and moves it back out to the top level', async () => {
      const nested = await service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: 10 });
      expect(nested.node).toMatchObject({ key: 'project-1', parentKey: 'project-10', sortOrder: 0 });
      expect(nested.node.lastModifiedDate).not.toBe('2026-01-01T00:00:00.000Z');
      // The top level closes the gap; the project keeps its whole subtree.
      expect(order('project', null)).toEqual([[10, 0]]);
      expect(order('project', 10)).toEqual([[1, 0]]);
      expect(nodeOf(2)!.parentId).toBe(1);
      expect(() => validateDocument(service.snapshot())).not.toThrow();

      const back = await service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: null, parentId: null, position: 0 });
      expect(back.node).toMatchObject({ parentKey: null, sortOrder: 0 });
      expect(order('project', null)).toEqual([
        [1, 0],
        [10, 1],
      ]);
      expect(order('project', 10)).toEqual([]);
    });

    it('reorders sub-projects among themselves, leaving the outcomes beside them alone', async () => {
      const a = (await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 1 })).id;
      const b = (await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 1 })).id;
      const c = (await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 1 })).id;
      await service.moveNode({ nodeType: 'PROJECT', nodeId: c, parentType: 'PROJECT', parentId: 1, position: 0 });
      expect(order('project', 1)).toEqual([
        [c, 0],
        [a, 1],
        [b, 2],
      ]);
      expect(order('outcome', 1)).toEqual([[2, 0]]);
    });

    it('refuses to move a project under itself or anywhere inside its own subtree', async () => {
      // project 1 > project 11 > project 12
      const inner = (await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: 1 })).id;
      const innermost = (await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: inner })).id;
      changes.mockClear();
      const before = service.snapshot();
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: 1 }))).toBe('cycle');
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: inner }))).toBe('cycle');
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: innermost }))).toBe('cycle');
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: inner, parentType: 'PROJECT', parentId: innermost }))).toBe(
        'cycle',
      );
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: 10, parentType: 'OUTCOME', parentId: 2 }))).toBe('invalidparent');
      expect(service.snapshot()).toEqual(before);
      expect(changes).not.toHaveBeenCalled();
    });

    it('refuses a move that would make the tree too deep, counting the levels inside the moved project', async () => {
      // project 1 is six levels tall (project > outcome > opportunity > solution > assumption > evidence).
      const chain = [10];
      for (let depth = 2; depth <= MAX_DEPTH - 5; depth++) {
        chain.push((await service.createNode({ type: 'PROJECT', parentType: 'PROJECT', parentId: chain.at(-1)! })).id);
      }
      // chain[i] is at level i + 1: under level 59 the evidence would be at level 65.
      expect(await rule(service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: chain[MAX_DEPTH - 6] }))).toBe(
        'toodeep',
      );
      expect(nodeOf(1)!.parentId).toBeNull();
      await service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: 'PROJECT', parentId: chain[MAX_DEPTH - 7] });
      expect(nodeOf(1)!.parentId).toBe(chain[MAX_DEPTH - 7]);
      expect(() => validateDocument(service.snapshot())).not.toThrow();
    });

    it('refuses a move under itself or one of its descendants', async () => {
      expect(await rule(service.moveNode({ nodeType: 'OPPORTUNITY', nodeId: 3, parentType: 'OPPORTUNITY', parentId: 3 }))).toBe('cycle');
      expect(await rule(service.moveNode({ nodeType: 'OPPORTUNITY', nodeId: 3, parentType: 'OPPORTUNITY', parentId: 4 }))).toBe('cycle');
      expect(nodeOf(3)!.parentId).toBe(2);
    });

    it('refuses a parent type that does not permit the node, and bad requests', async () => {
      expect(await rule(service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OUTCOME', parentId: 2 }))).toBe('invalidparent');
      expect(await rule(service.moveNode({ nodeType: 'EVIDENCE', nodeId: 7, parentType: 'SOLUTION', parentId: 8 }))).toBe('invalidparent');
      expect(await rule(service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: null, parentId: null }))).toBe('parentmissing');
      expect(await rule(service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 99 }))).toBe(
        'parentmissing',
      );
      expect(await rule(service.moveNode({ nodeType: 'SOLUTION', nodeId: 99, parentType: 'OPPORTUNITY', parentId: 4 }))).toBe(
        'nodemissing',
      );
      expect(await rule(service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 4, position: -1 }))).toBe(
        'invalidposition',
      );
      expect(await rule(service.moveNode({ nodeType: 'SOLUTION', nodeId: 5, parentType: 'OPPORTUNITY', parentId: 4, position: 0.5 }))).toBe(
        'invalidposition',
      );
      expect(nodeOf(5)).toMatchObject({ parentId: 3, sortOrder: 0 });
      expect(changes).not.toHaveBeenCalled();
    });
  });

  describe('deleteNode', () => {
    it('removes the node and its whole subtree, with their links and questions', async () => {
      await service.deleteNode('opportunity', 3);
      expect(service.snapshot()!.nodes.map(n => n.id)).toEqual([1, 2, 10]);
      // Their links and questions went with them.
      expect(await rule(service.updateLink(5, { name: 'x' }))).toBe('linkmissing');
      expect(await rule(service.updateQuestion(3, { done: true }))).toBe('questionmissing');
    });

    it('removes a leaf without touching anything else', async () => {
      await service.deleteNode('evidence', 7);
      expect(service.snapshot()!.nodes).toHaveLength(9);
      expect(nodeOf(6)).toBeDefined();
    });

    it('removes a project with everything under it', async () => {
      await service.deleteNode('project', 1);
      expect(service.snapshot()!.nodes.map(n => n.id)).toEqual([10]);
    });

    it('refuses an unknown node', async () => {
      expect(await rule(service.deleteNode('solution', 99))).toBe('nodemissing');
      expect(await rule(service.deleteNode('solution', 3))).toBe('nodemissing');
      expect(service.snapshot()!.nodes).toHaveLength(10);
    });
  });

  describe('links', () => {
    it('adds a link with the next id in the file', async () => {
      const link = await service.addLink('project', 1, { name: '  Roadmap ', url: ' https://example.com/roadmap ' });
      expect(link).toEqual({ id: 6, name: 'Roadmap', url: 'https://example.com/roadmap' });
      expect(nodeOf(1)!.links).toEqual([link]);
      expect((await service.addLink('outcome', 2, { name: 'Mail', url: 'mailto:someone@example.com' })).id).toBe(7);
    });

    it('accepts only http, https and mailto URLs', async () => {
      for (const url of [
        'javascript:alert(1)',
        'data:text/html,x',
        'ftp://example.com',
        'example.com',
        '',
        `https://example.com/${'u'.repeat(2000)}`,
      ]) {
        expect(await rule(service.addLink('project', 1, { name: 'Bad', url })), url).toBe('linkurlinvalid');
      }
      expect(await rule(service.updateLink(5, { url: 'javascript:alert(1)' }))).toBe('linkurlinvalid');
      expect(nodeOf(1)!.links).toEqual([]);
      expect(nodeOf(3)!.links[0].url).toBe('https://example.com/notes');
    });

    it('refuses an empty or over-long name', async () => {
      expect(await rule(service.addLink('project', 1, { name: '  ', url: 'https://example.com' }))).toBe('linknameinvalid');
      expect(await rule(service.addLink('project', 1, { name: 'n'.repeat(101), url: 'https://example.com' }))).toBe('linknameinvalid');
    });

    it('updates name and URL independently, found by link id alone', async () => {
      expect(await service.updateLink(5, { name: 'Renamed' })).toEqual({ id: 5, name: 'Renamed', url: 'https://example.com/notes' });
      expect(await service.updateLink(5, { url: 'https://example.com/other' })).toMatchObject({
        name: 'Renamed',
        url: 'https://example.com/other',
      });
      expect(nodeOf(3)!.links).toEqual([{ id: 5, name: 'Renamed', url: 'https://example.com/other' }]);
    });

    it('deletes a link', async () => {
      await service.deleteLink(5);
      expect(nodeOf(3)!.links).toEqual([]);
      expect(await rule(service.deleteLink(5))).toBe('linkmissing');
    });
  });

  describe('open questions', () => {
    it('adds a question to an opportunity with the next id in the file', async () => {
      const q = await service.addQuestion(4, '  Why now?  ');
      expect(q).toEqual({ id: 4, text: 'Why now?', done: false });
      expect(nodeOf(4)!.questions).toEqual([q]);
    });

    it('only opportunities have questions', async () => {
      expect(await rule(service.addQuestion(5, 'Why?'))).toBe('nodemissing');
      expect(await rule(service.addQuestion(99, 'Why?'))).toBe('nodemissing');
    });

    it('refuses empty or over-long text', async () => {
      expect(await rule(service.addQuestion(3, '   '))).toBe('questiontextinvalid');
      expect(await rule(service.addQuestion(3, 'q'.repeat(501)))).toBe('questiontextinvalid');
      expect(await rule(service.updateQuestion(3, { text: '' }))).toBe('questiontextinvalid');
    });

    it('ticks, rewords and deletes a question by its id', async () => {
      expect(await service.updateQuestion(3, { done: true })).toEqual({ id: 3, text: 'Who?', done: true });
      expect(await service.updateQuestion(3, { text: 'Who exactly?' })).toEqual({ id: 3, text: 'Who exactly?', done: true });
      await service.deleteQuestion(3);
      expect(nodeOf(3)!.questions).toEqual([]);
      expect(await rule(service.deleteQuestion(3))).toBe('questionmissing');
    });
  });

  it('reports every accepted change exactly once, and no refused one', async () => {
    await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
    await service.patchNode('project', 1, { title: 'Changed' });
    await service.moveNode({ nodeType: 'SOLUTION', nodeId: 8, parentType: 'OPPORTUNITY', parentId: 3, position: 0 });
    await service.addLink('project', 1, { name: 'A', url: 'https://example.com' });
    await service.updateLink(5, { name: 'B' });
    await service.deleteLink(5);
    await service.addQuestion(3, 'Q?');
    await service.updateQuestion(3, { done: true });
    await service.deleteQuestion(3);
    await service.deleteNode('evidence', 9);
    expect(changes).toHaveBeenCalledTimes(10);
    await service.getTree();
    await rule(service.deleteNode('evidence', 9));
    expect(changes).toHaveBeenCalledTimes(10);
  });
});
