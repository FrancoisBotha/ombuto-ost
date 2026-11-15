/*
 * Undo and redo in the document layer: the history itself, and the document service that owns it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuleError } from '@/ost/ost-errors';

import { type OstDocument, parseDocument, serializeDocument } from './document';
import { COALESCE_PAUSE_MS, DocumentHistory, HISTORY_LIMIT, captureState } from './history';
import LocalDocumentService from './local-document-service';
import { smallDocument } from './small-document.test-util';

const STAMP = new Date('2026-01-02T03:04:05Z');
const text = (service: LocalDocumentService) => serializeDocument(service.snapshot()!);

/** A service with the small document open: project 1 > outcome 2 > opportunities 3, 11, 14 … */
function opened() {
  const service = new LocalDocumentService();
  service.open(smallDocument(STAMP));
  const changes = vi.fn();
  service.onChange(changes);
  return { service, changes, start: text(service) };
}

describe('captureState', () => {
  const doc = (): OstDocument => smallDocument(STAMP);

  it('is a copy: later edits to the document never reach it', () => {
    const live = doc();
    const state = captureState(live, 0);
    live.nodes[0].title = 'Changed';
    live.nodes[2].questions[0].done = true;
    live.nodes.pop();
    expect(state.nodes).toHaveLength(14);
    expect(state.nodes[0].title).toBe('Meal-planning app');
    expect(state.nodes[2].questions[0].done).toBe(false);
  });

  it('shares every node an edit left alone with the state before, and the unchanged lists of a changed node', () => {
    const live = doc();
    const before = captureState(live, 0);
    live.nodes[2].title = 'Renamed';
    const after = captureState(live, 0, before);
    expect(after.nodes[2]).not.toBe(before.nodes[2]);
    expect(after.nodes[2].questions).toBe(before.nodes[2].questions);
    expect(after.nodes[2].links).toBe(before.nodes[2].links);
    after.nodes.forEach((n, i) => i === 2 || expect(n).toBe(before.nodes[i]));
  });
});

describe('DocumentHistory', () => {
  let now = 0;
  let history: DocumentHistory;
  let live: OstDocument;
  /** Changes the first node's title and records it. */
  const edit = (title: string, key?: string, verb = 'rename') => {
    live.nodes[0].title = title;
    history.record(captureState(live, 0, history.present), { verb, title, nodeKey: 'project-1', key });
  };
  const titleNow = () => history.present!.nodes[0].title;

  beforeEach(() => {
    now = 1000;
    history = new DocumentHistory(() => now);
    live = smallDocument(STAMP);
    history.reset(captureState(live, 0));
  });

  it('starts with nothing to undo or redo', () => {
    expect(history.undoStep).toBeNull();
    expect(history.redoStep).toBeNull();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it('steps back and forward through the states, naming each step', () => {
    edit('One');
    edit('Two');
    expect(history.undoStep).toEqual({ label: 'rename “Two”', nodeKey: 'project-1' });
    expect(history.undo()?.label).toBe('rename “Two”');
    expect(titleNow()).toBe('One');
    expect(history.redoStep?.label).toBe('rename “Two”');
    expect(history.undo()?.label).toBe('rename “One”');
    expect(titleNow()).toBe('Meal-planning app');
    expect(history.undoStep).toBeNull();
    history.redo();
    history.redo();
    expect(titleNow()).toBe('Two');
    expect(history.redoStep).toBeNull();
  });

  it('a new edit clears what could be redone', () => {
    edit('One');
    edit('Two');
    history.undo();
    live.nodes[0].title = 'One';
    edit('Other');
    expect(history.redoStep).toBeNull();
    history.undo();
    expect(titleNow()).toBe('One');
  });

  it('an edit that changes nothing is not a step', () => {
    const mark = history.present;
    history.record(captureState(live, 0, history.present), { verb: 'edit' });
    expect(history.present).toBe(mark);
    expect(history.undoStep).toBeNull();
  });

  it(`keeps at most ${HISTORY_LIMIT} steps: the oldest is dropped`, () => {
    for (let i = 1; i <= HISTORY_LIMIT + 25; i++) edit(`Title ${i}`);
    expect(history.length).toBe(HISTORY_LIMIT);
    let undone = 0;
    while (history.undo()) undone++;
    expect(undone).toBe(HISTORY_LIMIT);
    // The oldest state still reachable is the one after the 25 edits that fell off.
    expect(titleNow()).toBe('Title 25');
  });

  it('cuts a long title in the label', () => {
    edit('x'.repeat(90));
    expect(history.undoStep!.label).toBe(`rename “${'x'.repeat(39)}…”`);
  });

  describe('typing is one step', () => {
    it('edits with the same key, close together, fold into the first; the label follows the latest', () => {
      edit('M', 'title:1');
      now += 300;
      edit('Me', 'title:1');
      now += 300;
      edit('Meals', 'title:1');
      expect(history.length).toBe(1);
      expect(history.undoStep!.label).toBe('rename “Meals”');
      history.undo();
      expect(titleNow()).toBe('Meal-planning app');
      history.redo();
      expect(titleNow()).toBe('Meals');
    });

    it('another field, an edit without a key, or a pause starts a new step', () => {
      edit('A', 'title:1');
      edit('B', 'notes:1');
      expect(history.length).toBe(2);
      edit('C');
      edit('D');
      expect(history.length).toBe(4);
      edit('E', 'title:1');
      now += COALESCE_PAUSE_MS;
      edit('F', 'title:1');
      expect(history.length).toBe(5);
      now += COALESCE_PAUSE_MS + 1;
      edit('G', 'title:1');
      expect(history.length).toBe(6);
    });

    it('the pause is counted from the last key press, not the first', () => {
      edit('A', 'title:1');
      for (let i = 0; i < 10; i++) {
        now += COALESCE_PAUSE_MS - 1;
        edit(`A${i}`, 'title:1');
      }
      expect(history.length).toBe(1);
    });

    it('leaving the field (seal) ends the step', () => {
      edit('A', 'title:1');
      history.seal();
      edit('B', 'title:1');
      expect(history.length).toBe(2);
      history.undo();
      expect(titleNow()).toBe('A');
    });

    it('an undo or redo ends the step too', () => {
      edit('A', 'title:1');
      edit('B', 'title:1');
      history.undo();
      history.redo();
      edit('C', 'title:1');
      expect(history.length).toBe(2);
    });

    it('naming a node straight after adding it keeps the step an "add", under the new name', () => {
      edit('New project', 'title:1', 'add');
      edit('Weekly planner', 'title:1');
      expect(history.length).toBe(1);
      expect(history.undoStep!.label).toBe('add “Weekly planner”');
    });

    it('typing that is taken back (Escape) leaves no step behind, and the state from before it is the present one', () => {
      const before = history.present;
      edit('Typed', 'title:1');
      live.nodes[0].lastModifiedDate = '2026-05-05T00:00:00.000Z';
      live.nodes[0].title = 'Meal-planning app';
      const back = history.record(captureState(live, 0, history.present), { verb: 'rename', key: 'title:1' });
      expect(back).toBe(before);
      expect(history.present).toBe(before);
      expect(history.undoStep).toBeNull();
      expect(history.redoStep).toBeNull();
    });
  });
});

describe('the document service: undo and redo of every kind of change', () => {
  afterEach(() => vi.useRealTimers());

  /** Makes a change, then checks that undo brings back the exact document and redo the exact change. */
  async function roundTrip(label: string, change: (service: LocalDocumentService) => Promise<unknown>) {
    const { service, changes, start } = opened();
    await change(service);
    const changed = text(service);
    expect(changed).not.toBe(start);
    expect(service.undoStep?.label).toBe(label);
    expect(service.redoStep).toBeNull();
    changes.mockClear();

    expect(service.undo()?.label).toBe(label);
    expect(text(service)).toBe(start);
    expect(service.undoStep).toBeNull();
    expect(service.redoStep?.label).toBe(label);
    expect(changes).toHaveBeenCalledTimes(1);

    expect(service.redo()?.label).toBe(label);
    expect(text(service)).toBe(changed);
    expect(changes).toHaveBeenCalledTimes(2);
    // What is restored is a document a file could hold.
    expect(serializeDocument(parseDocument(changed))).toBe(changed);
    return service;
  }

  it('create', () =>
    roundTrip('add “Fresh”', s => s.createNode({ type: 'OPPORTUNITY', parentType: 'OUTCOME', parentId: 2, title: 'Fresh' })));

  it('rename', () => roundTrip('rename “Renamed”', s => s.patchNode('project', 1, { title: 'Renamed' })));

  it('every other field', async () => {
    await roundTrip('edit notes of “Meal-planning app”', s => s.patchNode('project', 1, { notes: 'Other notes' }));
    await roundTrip('change status of “Deciding what to cook takes too long”', s => s.patchNode('opportunity', 3, { status: 'PARKED' }));
    await roundTrip('change priority of “Deciding what to cook takes too long”', s => s.patchNode('opportunity', 3, { priority: 7 }));
    await roundTrip('change value of “Deciding what to cook takes too long”', s => s.patchNode('opportunity', 3, { valueRating: 1 }));
    await roundTrip('change confidence of “People accept a suggested plan with sma…”', s =>
      s.patchNode('assumption', 7, { confidence: 5 }),
    );
    await roundTrip('edit owner of “People accept a suggested plan with sma…”', s => s.patchNode('assumption', 7, { owner: 'Ops' }));
    await roundTrip('edit “Deciding what to cook takes too long”', s => s.patchNode('opportunity', 3, { priority: 7, valueRating: 1 }));
  });

  it('delete, with the whole subtree, its links and its open questions', async () => {
    const before = opened().service.snapshot()!;
    const service = await roundTrip('delete “Deciding what to cook takes too long”', s => s.deleteNode('opportunity', 3));
    // After the redo the opportunity and the seven nodes under it are gone …
    expect(service.snapshot()!.nodes.map(n => n.id)).toEqual([1, 2, 11, 12, 13, 14]);
    service.undo();
    // … and after the undo they are back where they were, questions and all.
    expect(service.snapshot()).toEqual(before);
    expect(service.snapshot()!.nodes.find(n => n.id === 3)!.questions).toHaveLength(2);
  });

  it('move to another parent, and re-order', async () => {
    await roundTrip('move “Suggest a week from past favourites”', s =>
      s.moveNode({ nodeType: 'SOLUTION', nodeId: 6, parentType: 'OPPORTUNITY', parentId: 11 }),
    );
    await roundTrip('reorder “Plans fall apart when the week changes”', s =>
      s.moveNode({ nodeType: 'OPPORTUNITY', nodeId: 14, parentType: 'OUTCOME', parentId: 2, position: 0 }),
    );
  });

  it('links: add, edit, remove', async () => {
    await roundTrip('add a link to “Meal-planning app”', s => s.addLink('project', 1, { name: 'Site', url: 'https://example.com' }));
    await roundTrip('edit a link of “The shopping list does not match the pl…”', s => s.updateLink(1, { name: 'Other name' }));
    await roundTrip('remove a link from “The shopping list does not match the pl…”', s => s.deleteLink(1));
  });

  it('open questions: add, edit, tick, remove', async () => {
    await roundTrip('add a question to “Deciding what to cook takes too long”', s => s.addQuestion(3, 'Why?'));
    await roundTrip('edit a question of “Deciding what to cook takes too long”', s => s.updateQuestion(1, { text: 'Reworded?' }));
    await roundTrip('edit a question of “Deciding what to cook takes too long”', s => s.updateQuestion(1, { done: true }));
    await roundTrip('remove a question from “Deciding what to cook takes too long”', s => s.deleteQuestion(2));
  });

  it('the name of the tree', () => roundTrip('rename the tree', async s => s.rename('Another name')));

  it('a refused change is not a step', async () => {
    const { service, start } = opened();
    await expect(service.patchNode('project', 1, { title: 'x' })).rejects.toBeInstanceOf(RuleError);
    await expect(service.deleteNode('project', 99)).rejects.toBeInstanceOf(RuleError);
    expect(service.undoStep).toBeNull();
    expect(text(service)).toBe(start);
  });

  it('a new edit clears redo', async () => {
    const { service } = opened();
    await service.patchNode('project', 1, { title: 'One' });
    await service.patchNode('project', 1, { notes: 'Two' });
    service.undo();
    expect(service.redoStep).not.toBeNull();
    await service.addLink('project', 1, { name: 'Site', url: 'https://example.com' });
    expect(service.redoStep).toBeNull();
    expect(service.redo()).toBeNull();
  });

  it('undoing several steps returns to the document as it was opened, and ids stay what they were', async () => {
    const { service, start } = opened();
    const created = await service.createNode({ type: 'PROJECT', parentType: null, parentId: null, title: 'Second' });
    const link = await service.addLink('project', created.id, { name: 'Site', url: 'https://example.com' });
    await service.moveNode({ nodeType: 'PROJECT', nodeId: created.id, parentType: 'PROJECT', parentId: 1 });
    await service.deleteNode('project', created.id);
    const end = text(service);
    for (let i = 0; i < 4; i++) expect(service.undo()).not.toBeNull();
    expect(text(service)).toBe(start);
    expect(service.undo()).toBeNull();

    // Redo the first three: the project and its link come back under the ids they had.
    for (let i = 0; i < 3; i++) service.redo();
    const back = service.snapshot()!.nodes.find(n => n.id === created.id)!;
    expect(back).toMatchObject({ title: 'Second', parentId: 1, links: [{ id: link.id, name: 'Site' }] });
    service.redo();
    expect(text(service)).toBe(end);

    // A node made after an undo never takes the id of the node that was undone away.
    service.undo();
    service.undo();
    service.undo();
    service.undo();
    const other = await service.createNode({ type: 'PROJECT', parentType: null, parentId: null, title: 'Other' });
    expect(other.id).not.toBe(created.id);
  });

  it('typing in one field is one step; leaving the field, or another field, starts the next', async () => {
    vi.useFakeTimers({ now: STAMP });
    const { service, start } = opened();
    for (const notes of ['T', 'Ty', 'Typ', 'Type', 'Typed']) {
      await service.patchNode('project', 1, { notes });
      vi.advanceTimersByTime(300);
    }
    expect(service.undoStep?.label).toBe('edit notes of “Meal-planning app”');
    service.undo();
    expect(text(service)).toBe(start);
    expect(service.undoStep).toBeNull();
    service.redo();
    expect(service.snapshot()!.nodes[0].notes).toBe('Typed');

    await service.patchNode('project', 1, { notes: 'Typed more' });
    service.sealHistory();
    await service.patchNode('project', 1, { notes: 'Typed more, later' });
    await service.patchNode('project', 1, { title: 'Meals' });
    await service.patchNode('outcome', 2, { title: 'Another node' });
    const undone: string[] = [];
    for (let step = service.undo(); step; step = service.undo()) undone.push(step.label);
    expect(undone).toEqual([
      'rename “Another node”',
      'rename “Meals”',
      'edit notes of “Meal-planning app”',
      'edit notes of “Meal-planning app”',
      'edit notes of “Meal-planning app”',
    ]);
    expect(text(service)).toBe(start);
  });

  it('a node created and named at once is one step', async () => {
    vi.useFakeTimers({ now: STAMP });
    const { service, start } = opened();
    const created = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
    vi.advanceTimersByTime(900);
    await service.patchNode('outcome', created.id, { title: 'Fewer' });
    vi.advanceTimersByTime(300);
    await service.patchNode('outcome', created.id, { title: 'Fewer skipped meals' });
    expect(service.undoStep?.label).toBe('add “Fewer skipped meals”');
    service.undo();
    expect(text(service)).toBe(start);
    expect(service.undoStep).toBeNull();
  });

  it('text typed and then put back (Escape) is no step, and the document is exactly what it was', async () => {
    vi.useFakeTimers({ now: STAMP });
    const { service, start } = opened();
    const mark = service.mark();
    await service.patchNode('project', 1, { title: 'Typed' });
    vi.advanceTimersByTime(700);
    await service.patchNode('project', 1, { title: 'Meal-planning app' });
    expect(service.undoStep).toBeNull();
    expect(text(service)).toBe(start);
    expect(service.mark()).toBe(mark);
    // The document is still live.
    await service.patchNode('project', 1, { title: 'Later' });
    expect(service.snapshot()!.nodes[0].title).toBe('Later');
  });

  it('opening another document, clearing, and closing all empty the history', async () => {
    const { service } = opened();
    await service.patchNode('project', 1, { title: 'One' });
    await service.patchNode('project', 1, { notes: 'Two' });
    service.undo();
    service.open(smallDocument(STAMP));
    expect(service.undoStep).toBeNull();
    expect(service.redoStep).toBeNull();

    await service.patchNode('project', 1, { title: 'One' });
    service.clearHistory();
    expect(service.undoStep).toBeNull();
    expect(service.snapshot()!.nodes[0].title).toBe('One');

    await service.patchNode('project', 1, { title: 'Two' });
    service.close();
    expect(service.undoStep).toBeNull();
    expect(service.mark()).toBeNull();
  });

  it('mark() names a state: it changes with every edit and comes back with undo and redo', async () => {
    const { service } = opened();
    const opened0 = service.mark();
    await service.patchNode('project', 1, { title: 'One' });
    const one = service.mark();
    expect(one).not.toBe(opened0);
    service.undo();
    expect(service.mark()).toBe(opened0);
    service.redo();
    expect(service.mark()).toBe(one);
    // A move to where the node already is changes nothing: same state, no step.
    await service.moveNode({ nodeType: 'PROJECT', nodeId: 1, parentType: null, parentId: null, position: 0 });
    expect(service.mark()).toBe(one);
    expect(service.undoStep?.label).toBe('rename “One”');
  });

  it('the limits still hold after an undo: a state is put back only through validation', async () => {
    const { service } = opened();
    await service.deleteNode('opportunity', 3);
    service.undo();
    // The restored document is live: it takes edits, and the running size total came back with it.
    const added = await service.addQuestion(3, 'Still here?');
    expect(
      service
        .snapshot()!
        .nodes.find(n => n.id === 3)!
        .questions.map(q => q.id),
    ).toContain(added.id);
    expect(serializeDocument(parseDocument(text(service)))).toBe(text(service));
  });

  it('refuses to put back a state that would not open as a file, and leaves everything as it is', async () => {
    const service = new LocalDocumentService();
    // Opened without validation (the app never does this): a title no file may carry.
    const broken = smallDocument(STAMP);
    broken.nodes[0].title = 'x';
    service.open(broken);
    await service.patchNode('project', 1, { notes: 'An edit' });
    const before = text(service);
    expect(() => service.undo()).toThrow(RuleError);
    expect(text(service)).toBe(before);
    expect(service.undoStep?.label).toBe('edit notes of “x”');
  });
});
