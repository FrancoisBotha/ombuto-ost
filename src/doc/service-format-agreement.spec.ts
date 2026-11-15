/*
 * The app must never save a file it then refuses to open. Whatever is done through the document
 * service, the document it holds has to pass the same validation a file goes through on open.
 */
import { describe, expect, it } from 'vitest';

import { RuleError } from '@/ost/ost-errors';
import type { ApiNodeType } from '@/ost/ost.model';

import {
  type DocNode,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  MAX_LINKS_PER_NODE,
  MAX_NODES,
  MAX_NODES_WEIGHT,
  MAX_QUESTIONS_PER_NODE,
  NOTES_MAX,
  type OstDocument,
  emptyDocument,
  newNodeFields,
  nodeWeight,
  parseDocument,
  serializeDocument,
  validateDocument,
} from './document';
import LocalDocumentService from './local-document-service';

const node = (id: number, type: DocNode['type'], parentId: number | null, extra: Partial<DocNode> = {}): DocNode => ({
  id,
  type,
  parentId,
  title: `${type} ${id}`,
  notes: '',
  ...newNodeFields(type),
  sortOrder: 0,
  createdDate: null,
  lastModifiedDate: null,
  links: [],
  questions: [],
  ...extra,
});

const docOf = (...nodes: DocNode[]): OstDocument => ({ ...emptyDocument('Agreement'), nodes });

/** The promise the whole file rests on: what the service holds can be saved and opened again. */
function expectReopens(service: LocalDocumentService) {
  const text = serializeDocument(service.snapshot()!);
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_FILE_BYTES);
  const reopened = parseDocument(text);
  expect(serializeDocument(reopened)).toBe(text);
}

const rule = async (call: Promise<unknown>): Promise<string> => {
  try {
    await call;
  } catch (err) {
    if (err instanceof RuleError) return err.key;
    throw err;
  }
  return 'accepted';
};

/** Small deterministic generator, so a failure can be replayed from its seed. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the document service and the file format agree', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('any sequence of service calls leaves a document that opens again (seed %i)', async seed => {
    const random = mulberry32(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const TYPES: ApiNodeType[] = ['PROJECT', 'OUTCOME', 'OPPORTUNITY', 'SOLUTION', 'ASSUMPTION', 'EVIDENCE'];
    // Hostile on purpose: empty, too long, control characters, astral characters, lone surrogates, markup.
    const TEXTS = [
      '',
      ' ',
      'ok',
      'A title',
      'x'.repeat(99),
      'y'.repeat(600),
      '\u0000\u001f\n\t"\\',
      '😀'.repeat(40),
      '\ud800 lone',
      '<b>&</b>',
      '  padded  ',
    ];
    const URLS = [
      'https://example.com/a',
      'mailto:a@example.com',
      'javascript:alert(1)',
      '',
      'http://x',
      `https://example.com/${'p'.repeat(2100)}`,
    ];
    const NUMBERS = [-1, 0, 1, 3, 5, 50, 100, 101, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER];

    const service = new LocalDocumentService();
    // Start from the nastiest ids a valid file can carry.
    const top = Number.MAX_SAFE_INTEGER;
    service.open(
      validateDocument(
        docOf(
          node(top, 'project', null, { sortOrder: Number.MAX_VALUE }),
          node(top - 1, 'outcome', top),
          node(top - 2, 'opportunity', top - 1, {
            links: [{ id: top, name: 'Link', url: 'https://example.com' }],
            questions: [{ id: top, text: 'Question?', done: false }],
          }),
        ),
      ),
    );

    for (let step = 0; step < 400; step++) {
      const nodes = service.snapshot()!.nodes;
      const any = () => pick(nodes.length ? nodes : [node(1, 'project', null)]);
      const target = any();
      const links = nodes.flatMap(n => n.links);
      const questions = nodes.flatMap(n => n.questions);
      const attempt: Promise<unknown> = pick([
        () => service.createNode({ type: 'PROJECT', parentType: null, parentId: null, title: pick(TEXTS) }),
        () =>
          service.createNode({
            type: pick(TYPES),
            parentType: target.type.toUpperCase() as ApiNodeType,
            parentId: target.id,
            title: pick(TEXTS),
          }),
        () => service.createNode({ type: 'OPPORTUNITY', parentType: target.type.toUpperCase() as ApiNodeType, parentId: target.id }),
        () =>
          service.patchNode(target.type, target.id, {
            ...(random() < 0.5 ? { title: pick(TEXTS) } : {}),
            ...(random() < 0.5 ? { notes: random() < 0.2 ? 'n'.repeat(NOTES_MAX + (random() < 0.5 ? 0 : 1)) : pick(TEXTS) } : {}),
            ...(random() < 0.3 ? { status: pick(['EXPLORING', 'candidate', 'nope', 'SUPPORTED', '']) } : {}),
            ...(random() < 0.3 ? { confidence: pick(NUMBERS) } : {}),
            ...(random() < 0.3 ? { priority: pick(NUMBERS) } : {}),
            ...(random() < 0.3 ? { valueRating: pick(NUMBERS) } : {}),
            ...(random() < 0.3 ? { owner: pick([...TEXTS, null]) } : {}),
          }),
        () => {
          const parent = any();
          return service.moveNode({
            nodeType: target.type.toUpperCase() as ApiNodeType,
            nodeId: target.id,
            parentType: target.type === 'project' ? null : (parent.type.toUpperCase() as ApiNodeType),
            parentId: target.type === 'project' ? null : parent.id,
            ...(random() < 0.6 ? { position: pick([0, 1, 2, 7, -1, 1.5]) } : {}),
          });
        },
        () => (random() < 0.15 ? service.deleteNode(target.type, target.id) : Promise.resolve()),
        () => service.addLink(target.type, target.id, { name: pick(TEXTS), url: pick(URLS) }),
        () => (links.length ? service.updateLink(pick(links).id, { name: pick(TEXTS), url: pick(URLS) }) : Promise.resolve()),
        () => (links.length && random() < 0.3 ? service.deleteLink(pick(links).id) : Promise.resolve()),
        () => service.addQuestion(target.id, pick(TEXTS)),
        () =>
          questions.length ? service.updateQuestion(pick(questions).id, { text: pick(TEXTS), done: random() < 0.5 }) : Promise.resolve(),
        () => (questions.length && random() < 0.3 ? service.deleteQuestion(pick(questions).id) : Promise.resolve()),
        () => Promise.resolve(service.rename(pick(TEXTS))),
      ])();
      // A refusal is fine (and leaves the document untouched); anything else is a bug.
      await attempt.catch(err => expect(err).toBeInstanceOf(RuleError));
      if (step % 20 === 0) expectReopens(service);
    }
    expectReopens(service);
  });

  it('new nodes, links and questions get usable ids when the file already uses the largest id there is', async () => {
    const top = Number.MAX_SAFE_INTEGER;
    const service = new LocalDocumentService();
    service.open(
      docOf(
        node(top, 'project', null),
        node(1, 'outcome', top),
        node(2, 'opportunity', 1, {
          links: [{ id: top, name: 'L', url: 'https://example.com' }],
          questions: [{ id: top, text: 'Q', done: false }],
        }),
      ),
    );
    const first = await service.createNode({ type: 'PROJECT', parentType: null, parentId: null });
    const second = await service.createNode({ type: 'PROJECT', parentType: null, parentId: null });
    expect(new Set([first.id, second.id, top, 1, 2]).size).toBe(5);
    expect([first.id, second.id].every(Number.isSafeInteger)).toBe(true);
    const linkA = await service.addLink('opportunity', 2, { name: 'A', url: 'https://example.com/a' });
    const linkB = await service.addLink('opportunity', 2, { name: 'B', url: 'https://example.com/b' });
    expect(new Set([linkA.id, linkB.id, top]).size).toBe(3);
    const questionA = await service.addQuestion(2, 'One?');
    const questionB = await service.addQuestion(2, 'Two?');
    expect(new Set([questionA.id, questionB.id, top]).size).toBe(3);
    expectReopens(service);
  });

  it('refuses a node beyond MAX_NODES, with a message, and the document still opens', async () => {
    const service = new LocalDocumentService();
    const nodes = [node(1, 'project', null)];
    for (let id = 2; id <= MAX_NODES; id++) nodes.push(node(id, 'outcome', 1, { sortOrder: id }));
    service.open(docOf(...nodes));
    const refused = service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 });
    expect(await rule(refused)).toBe('toomanynodes');
    await expect(refused).rejects.toThrow(/at most/);
    expect(await rule(service.createNode({ type: 'PROJECT', parentType: null, parentId: null }))).toBe('toomanynodes');
    expect(service.snapshot()!.nodes).toHaveLength(MAX_NODES);
    expectReopens(service);
    // Deleting makes room again.
    await service.deleteNode('outcome', 2);
    expect(await rule(service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 }))).toBe('accepted');
  });

  it('refuses to create or move a node deeper than MAX_DEPTH', async () => {
    const service = new LocalDocumentService();
    // project (1) > outcome (2) > opportunities down to level MAX_DEPTH
    const chain = [node(1, 'project', null), node(2, 'outcome', 1)];
    for (let id = 3; id <= MAX_DEPTH; id++) chain.push(node(id, 'opportunity', id - 1));
    // a second, short branch: opportunity 1001 > opportunity 1002
    chain.push(node(1001, 'opportunity', 2), node(1002, 'opportunity', 1001));
    service.open(validateDocument(docOf(...chain)));

    expect(await rule(service.createNode({ type: 'OPPORTUNITY', parentType: 'OPPORTUNITY', parentId: MAX_DEPTH }))).toBe('toodeep');
    expect(await rule(service.createNode({ type: 'OPPORTUNITY', parentType: 'OPPORTUNITY', parentId: MAX_DEPTH - 1 }))).toBe('accepted');
    // Moving a two-level subtree under level MAX_DEPTH - 1 would make level MAX_DEPTH + 1.
    const move = (parentId: number) => service.moveNode({ nodeType: 'OPPORTUNITY', nodeId: 1001, parentType: 'OPPORTUNITY', parentId });
    expect(await rule(move(MAX_DEPTH - 1))).toBe('toodeep');
    expect(await rule(move(MAX_DEPTH - 2))).toBe('accepted');
    expectReopens(service);
  });

  it('refuses more links or open questions than a node may have', async () => {
    const service = new LocalDocumentService();
    service.open(
      docOf(
        node(1, 'project', null),
        node(2, 'outcome', 1),
        node(3, 'opportunity', 2, {
          links: Array.from({ length: MAX_LINKS_PER_NODE }, (_, i) => ({ id: i + 1, name: `L${i}`, url: 'https://example.com' })),
          questions: Array.from({ length: MAX_QUESTIONS_PER_NODE }, (_, i) => ({ id: i + 1, text: `Q${i}`, done: false })),
        }),
      ),
    );
    expect(await rule(service.addLink('opportunity', 3, { name: 'One more', url: 'https://example.com' }))).toBe('toomanylinks');
    expect(await rule(service.addQuestion(3, 'One more?'))).toBe('toomanyquestions');
    expectReopens(service);
  });

  it('refuses text that would make the file larger than a file may be, and takes it again once there is room', async () => {
    const service = new LocalDocumentService();
    // Astral characters: 20,000 UTF-16 units are 40,000 bytes in the file.
    const heavy = '😀'.repeat(NOTES_MAX / 2);
    const full = Math.floor(MAX_NODES_WEIGHT / nodeWeight(node(2, 'outcome', 1, { notes: heavy })));
    const count = Math.min(full, MAX_NODES - 2);
    const nodes = [node(1, 'project', null)];
    for (let id = 2; id < 2 + count; id++) nodes.push(node(id, 'outcome', 1, { notes: heavy }));
    service.open(docOf(...nodes));
    let refused = 0;
    for (let i = 0; i < 400 && !refused; i++) {
      const outcome = await service.createNode({ type: 'OUTCOME', parentType: 'PROJECT', parentId: 1 }).catch(() => null);
      if (!outcome) break;
      if ((await rule(service.patchNode('outcome', outcome.id, { notes: heavy }))) === 'documenttoolarge') refused++;
    }
    // Either the node cap or the size cap stopped the growth; the document opens again either way.
    expectReopens(service);
    if (refused) {
      await service.deleteNode('outcome', 2);
      const last = service.snapshot()!.nodes.at(-1)!;
      expect(await rule(service.patchNode('outcome', last.id, { notes: heavy }))).toBe('accepted');
      expectReopens(service);
    }
  });

  it('nodeWeight is never less than the bytes a node takes in the file', () => {
    const extreme = node(Number.MAX_SAFE_INTEGER, 'opportunity', Number.MAX_SAFE_INTEGER, {
      title: '\u0000'.repeat(200),
      notes: '\u001f"\\'.repeat(100),
      sortOrder: -Number.MAX_VALUE,
      createdDate: '2026-01-01T00:00:00.000000000+00:00 ',
      lastModifiedDate: '2026-01-01T00:00:00.000000000+00:00 ',
      links: [{ id: Number.MAX_SAFE_INTEGER, name: '😀', url: 'https://example.com/\u0001' }],
      questions: [{ id: Number.MAX_SAFE_INTEGER, text: '\ud800', done: false }],
    });
    for (const n of [extreme, node(1, 'project', null), node(2, 'assumption', 1, { owner: 'Someone' })]) {
      const bytes =
        new TextEncoder().encode(serializeDocument(docOf(n))).length - new TextEncoder().encode(serializeDocument(docOf())).length;
      expect(nodeWeight(n)).toBeGreaterThanOrEqual(bytes);
    }
  });
});
