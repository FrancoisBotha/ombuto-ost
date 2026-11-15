import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCUMENT_NAME,
  DOCUMENT_FORMAT,
  DOCUMENT_NAME_MAX,
  DOCUMENT_VERSION,
  DocumentFormatError,
  MAX_DEPTH,
  MAX_LINKS_PER_NODE,
  MAX_NODES,
  MAX_QUESTIONS_PER_NODE,
  cleanDocumentName,
  cloneDocument,
  defaultTitle,
  emptyDocument,
  fileNameFor,
  newNodeFields,
  parseDocument,
  serializeDocument,
  validateDocument,
} from './document';
import { NODE_COLORS } from '@/ost/domain/node-colors';

import { currentNodeKey, currentNodeType } from './legacy';
import { sampleDocument } from './sample';
import { legacyFileText, smallDocument } from './small-document.test-util';

/** A minimal valid file as plain JSON data; tests break one thing at a time. */
const valid = () => ({
  format: 'ombuto-ost',
  version: 1,
  name: 'My tree',
  nodes: [
    { id: 1, type: 'project', parentId: null, title: 'Project' },
    { id: 2, type: 'outcome', parentId: 1, title: 'Outcome' },
    {
      id: 3,
      type: 'opportunity',
      parentId: 2,
      title: 'Opportunity',
      status: 'exploring',
      priority: 50,
      valueRating: 3,
      links: [{ id: 1, name: 'Notes', url: 'https://example.com/n' }],
      questions: [{ id: 1, text: 'Who?', done: true }],
    },
    { id: 4, type: 'solution', parentId: 3, title: 'Solution', status: 'candidate' },
    { id: 5, type: 'assumption', parentId: 4, title: 'Assumption', status: 'untested', confidence: 40, owner: 'Kim' },
    { id: 6, type: 'evidence', parentId: 5, title: 'Evidence' },
  ] as Record<string, unknown>[],
});

const withNode = (index: number, patch: Record<string, unknown>) => {
  const file = valid();
  Object.assign(file.nodes[index], patch);
  return file;
};

const rejects = (value: unknown, message?: RegExp) => {
  expect(() => validateDocument(value)).toThrow(DocumentFormatError);
  if (message) expect(() => validateDocument(value)).toThrow(message);
};

describe('the .ost document format', () => {
  describe('writing', () => {
    it('writes pretty-printed JSON with the format marker first and a trailing newline', () => {
      const text = serializeDocument(sampleDocument(new Date('2026-01-02T03:04:05Z')));
      expect(text.startsWith('{\n  "format": "ombuto-ost",\n  "version": 1,\n  "name": ')).toBe(true);
      expect(text.endsWith('}\n')).toBe(true);
      // One property per line: the file diffs line by line.
      expect(text).toContain('\n      "type": "opportunity",\n');
    });

    it('writes every node field, in a stable order', () => {
      const [node] = JSON.parse(serializeDocument(sampleDocument())).nodes;
      expect(Object.keys(node)).toEqual([
        'id',
        'type',
        'parentId',
        'title',
        'notes',
        'status',
        'confidence',
        'priority',
        'valueRating',
        'owner',
        'sortOrder',
        'createdDate',
        'lastModifiedDate',
        'links',
        'questions',
      ]);
    });

    it('round-trips: what is written reads back as the same document', () => {
      const doc = sampleDocument(new Date('2026-01-02T03:04:05Z'));
      expect(parseDocument(serializeDocument(doc))).toEqual(doc);
      expect(serializeDocument(parseDocument(serializeDocument(doc)))).toBe(serializeDocument(doc));
    });

    it('never writes anything that is not part of the format', () => {
      const doc = emptyDocument('X') as unknown as Record<string, unknown>;
      doc.secret = 'nope';
      expect(serializeDocument(doc as never)).not.toContain('secret');
    });

    it('cloneDocument shares nothing with the original', () => {
      const doc = sampleDocument();
      const copy = cloneDocument(doc);
      expect(copy).toEqual(doc);
      copy.nodes[0].title = 'changed';
      copy.nodes[2].questions.push({ id: 99, text: 'x', done: false });
      expect(doc.nodes[0].title).not.toBe('changed');
      expect(doc.nodes[2].questions.some(q => q.id === 99)).toBe(false);
    });
  });

  describe('reading: what is accepted', () => {
    it('accepts a minimal file and fills in what may be left out', () => {
      const doc = validateDocument(valid());
      expect(doc.format).toBe(DOCUMENT_FORMAT);
      expect(doc.version).toBe(DOCUMENT_VERSION);
      expect(doc.name).toBe('My tree');
      expect(doc.nodes[0]).toEqual({
        id: 1,
        type: 'project',
        parentId: null,
        title: 'Project',
        notes: '',
        status: null,
        confidence: null,
        priority: null,
        valueRating: null,
        owner: null,
        sortOrder: 0,
        createdDate: null,
        lastModifiedDate: null,
        links: [],
        questions: [],
      });
      expect(doc.nodes[2]).toMatchObject({ status: 'exploring', priority: 50, valueRating: 3 });
      expect(doc.nodes[4]).toMatchObject({ confidence: 40, owner: 'Kim' });
    });

    it('accepts an empty tree and the built-in example', () => {
      expect(validateDocument(emptyDocument()).nodes).toEqual([]);
      expect(validateDocument(JSON.parse(serializeDocument(sampleDocument()))).nodes.length).toBeGreaterThan(10);
    });

    it('rebuilds nodes from the known fields only: nothing else from a file gets in', () => {
      const file = valid();
      Object.assign(file, { extra: 1 });
      Object.assign(file.nodes[0], { __proto__: { polluted: true }, onclick: 'alert(1)', html: '<img src=x onerror=alert(1)>' });
      const [node] = validateDocument(file).nodes;
      expect(Object.keys(node)).toHaveLength(15);
      expect(node).not.toHaveProperty('onclick');
      expect(node).not.toHaveProperty('html');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('keeps text as text: markup in a title or note is just characters', () => {
      const doc = validateDocument(withNode(0, { title: '<script>alert(1)</script>', notes: '<b onmouseover=x>hi</b>' }));
      expect(doc.nodes[0].title).toBe('<script>alert(1)</script>');
      expect(doc.nodes[0].notes).toBe('<b onmouseover=x>hi</b>');
    });

    it('keeps a link whose URL is not http(s) or mailto as data (the UI never makes it clickable)', () => {
      const doc = validateDocument(withNode(2, { links: [{ id: 7, name: 'Odd', url: 'javascript:alert(1)' }] }));
      expect(doc.nodes[2].links).toEqual([{ id: 7, name: 'Odd', url: 'javascript:alert(1)' }]);
    });

    it('trims titles, link and question text, and tidies the name', () => {
      const file = withNode(2, {
        title: '  Padded  ',
        links: [{ id: 1, name: ' Notes ', url: ' https://example.com ' }],
        questions: [{ id: 1, text: ' Who? ' }],
      });
      file.name = '   Many   spaces   ';
      const doc = validateDocument(file);
      expect(doc.name).toBe('Many spaces');
      expect(doc.nodes[2].title).toBe('Padded');
      expect(doc.nodes[2].links[0]).toEqual({ id: 1, name: 'Notes', url: 'https://example.com' });
      expect(doc.nodes[2].questions[0]).toEqual({ id: 1, text: 'Who?', done: false });
    });

    it('accepts an empty owner as unassigned', () => {
      expect(validateDocument(withNode(4, { owner: '' })).nodes[4].owner).toBeNull();
      expect(validateDocument(withNode(4, { owner: null })).nodes[4].owner).toBeNull();
    });
  });

  describe('reading: what is refused', () => {
    it('refuses text that is not JSON, and JSON that is not this format', () => {
      for (const text of [
        '',
        'hello',
        '<svg/>',
        '[]',
        'null',
        '42',
        '{"format":"other","version":1,"name":"x","nodes":[]}',
        '{"nodes":[]}',
      ]) {
        expect(() => parseDocument(text), text).toThrow('This file is not an Ombuto OST tree.');
      }
    });

    it('refuses a file from a newer version, saying so', () => {
      rejects({ ...valid(), version: 2 }, /newer version/);
      rejects({ ...valid(), version: 0 });
      rejects({ ...valid(), version: '1' });
      rejects({ ...valid(), version: 1.5 });
    });

    it('refuses a file without a name or a node list', () => {
      rejects({ ...valid(), name: 42 }, /has no name/);
      rejects({ ...valid(), nodes: {} }, /has no list of nodes/);
      rejects({ format: 'ombuto-ost', version: 1, name: 'x' });
    });

    it('refuses more nodes than any real tree has', () => {
      const nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ id: i + 1, type: 'project', parentId: null, title: 'Project' }));
      rejects({ ...valid(), nodes }, /more than/);
    });

    it('accepts a tree exactly MAX_DEPTH levels deep and refuses one level more, without recursing', () => {
      const chain = (levels: number) => {
        const nodes: Record<string, unknown>[] = [
          { id: 1, type: 'project', parentId: null, title: 'Project' },
          { id: 2, type: 'outcome', parentId: 1, title: 'Outcome' },
        ];
        for (let id = 3; id <= levels; id++) {
          nodes.push({
            id,
            type: 'opportunity',
            parentId: id - 1,
            title: 'Opportunity',
            status: 'exploring',
            priority: 50,
            valueRating: 3,
          });
        }
        // Children before parents: the check must not depend on the order in the file.
        return { ...valid(), nodes: nodes.reverse() };
      };
      expect(validateDocument(chain(MAX_DEPTH)).nodes).toHaveLength(MAX_DEPTH);
      rejects(chain(MAX_DEPTH + 1), /more than \d+ levels deep/);
      // Far past the call-stack depth of a recursive walk: still a clean refusal.
      rejects(chain(MAX_NODES), /levels deep/);
    });

    it('refuses more links or open questions on a node than the app lets you add', () => {
      const links = Array.from({ length: MAX_LINKS_PER_NODE + 1 }, (_, i) => ({ id: i + 1, name: 'Link', url: 'https://example.com' }));
      rejects(withNode(0, { links }), /more than \d+ links/);
      expect(() => validateDocument(withNode(0, { links: links.slice(1) }))).not.toThrow();
      const questions = Array.from({ length: MAX_QUESTIONS_PER_NODE + 1 }, (_, i) => ({ id: i + 100, text: 'Why?' }));
      rejects(withNode(2, { questions }), /more than \d+ open questions/);
    });

    it('refuses a tree whose text would not fit in one file when it is saved again', () => {
      // 600 nodes of 20,000 astral characters: 24 MB of notes once written as UTF-8.
      const notes = '😀'.repeat(10000);
      const nodes = [
        { id: 1, type: 'project', parentId: null, title: 'Project' },
        ...Array.from({ length: 600 }, (_, i) => ({ id: i + 2, type: 'outcome', parentId: 1, title: 'Outcome', notes })),
      ];
      rejects({ ...valid(), nodes }, /more text than/);
    });

    it('refuses bad ids and types, naming the node', () => {
      rejects(withNode(1, { id: 0 }), /entry 2 of "nodes" has no valid id/);
      rejects(withNode(1, { id: '2' }));
      rejects(withNode(1, { id: 1.5 }));
      rejects(withNode(1, { id: 1 }), /node 1 appears more than once/);
      rejects(withNode(1, { type: 'bet' }), /node 2 has an unknown type/);
      rejects(withNode(1, { type: 'OUTCOME' }));
      rejects({ ...valid(), nodes: ['x'] }, /is not an object/);
    });

    it('refuses a broken structure', () => {
      rejects(withNode(0, { parentId: 2 }), /node 1 is a project under a outcome, which is not allowed/);
      rejects(withNode(1, { parentId: null }), /node 2 has no valid parentId/);
      rejects(withNode(1, { parentId: 99 }), /refers to a parent \(99\) that is not in the file/);
      rejects(withNode(3, { parentId: 2 }), /is a solution under a outcome, which is not allowed/);
      rejects(withNode(5, { parentId: 4 }), /is a evidence under a solution/);
    });

    it('refuses a loop of opportunities (the only loop the type rules allow)', () => {
      const file = valid();
      file.nodes.push(
        { id: 10, type: 'opportunity', parentId: 11, title: 'Loop A', status: 'unexplored', priority: 1, valueRating: 1 },
        { id: 11, type: 'opportunity', parentId: 10, title: 'Loop B', status: 'unexplored', priority: 1, valueRating: 1 },
      );
      rejects(file, /loop of parents/);
      rejects(withNode(2, { parentId: 3 }), /loop of parents/);
    });

    it('refuses a loop of projects', () => {
      const file = valid();
      file.nodes.push(
        { id: 10, type: 'project', parentId: 11, title: 'Loop A' },
        { id: 11, type: 'project', parentId: 10, title: 'Loop B' },
      );
      rejects(file, /loop of parents/);
      rejects(withNode(0, { parentId: 1 }), /loop of parents/);
    });

    it('refuses titles outside the limits of their type', () => {
      rejects(withNode(0, { title: 'x' }), /needs a title of 2 to 100 characters/);
      rejects(withNode(0, { title: '   ' }));
      rejects(withNode(0, { title: 5 }));
      rejects(withNode(0, { title: 'p'.repeat(101) }));
      expect(validateDocument(withNode(1, { title: 'o'.repeat(200) })).nodes[1].title).toHaveLength(200);
      rejects(withNode(1, { title: 'o'.repeat(201) }));
      expect(validateDocument(withNode(5, { title: 'e'.repeat(500) })).nodes[5].title).toHaveLength(500);
      rejects(withNode(5, { title: 'e'.repeat(501) }));
    });

    it('refuses field values of the wrong kind or range', () => {
      rejects(withNode(0, { notes: 5 }), /invalid notes/);
      rejects(withNode(0, { notes: 'n'.repeat(20001) }));
      rejects(withNode(2, { status: 'candidate' }), /needs a status that is one of: unexplored, exploring, validated, parked/);
      rejects(withNode(2, { status: 'EXPLORING' }));
      rejects(withNode(3, { status: undefined }));
      rejects(withNode(0, { status: 'exploring' }), /status, which does not apply to project nodes/);
      rejects(withNode(4, { confidence: 101 }), /confidence between 0 and 100/);
      rejects(withNode(4, { confidence: 40.5 }));
      rejects(withNode(4, { confidence: '40' }));
      rejects(withNode(3, { confidence: 40 }), /confidence, which does not apply to solution nodes/);
      rejects(withNode(2, { priority: 0 }), /priority between 1 and 100/);
      rejects(withNode(2, { valueRating: 6 }), /valueRating between 1 and 5/);
      rejects(withNode(3, { priority: 10 }));
      rejects(withNode(3, { valueRating: 2 }));
      rejects(withNode(3, { owner: 'Kim' }), /owner, which does not apply/);
      rejects(withNode(4, { owner: 'k'.repeat(101) }), /invalid owner/);
      rejects(withNode(0, { sortOrder: '1' }), /invalid sortOrder/);
      rejects(withNode(0, { sortOrder: Infinity }));
      rejects(withNode(0, { createdDate: 'yesterday' }), /invalid createdDate/);
      rejects(withNode(0, { lastModifiedDate: 12345 }), /invalid lastModifiedDate/);
    });

    it('refuses broken links', () => {
      const link = (patch: Record<string, unknown>) => withNode(0, { links: [{ id: 1, name: 'A', url: 'https://example.com', ...patch }] });
      rejects(withNode(0, { links: 'x' }), /links that are not a list/);
      rejects(withNode(0, { links: [null] }), /link that is not an object/);
      rejects(link({ id: -1 }), /missing or repeated id/);
      rejects(link({ name: '' }), /invalid name/);
      rejects(link({ name: 'n'.repeat(101) }));
      rejects(link({ url: '' }), /invalid URL/);
      rejects(link({ url: 'u'.repeat(2001) }));
      rejects(link({ url: 42 }));
      // Link ids are unique across the whole file, not just within a node.
      const file = valid();
      file.nodes[0].links = [{ id: 1, name: 'Dup', url: 'https://example.com' }];
      rejects(file, /missing or repeated id/);
    });

    it('refuses broken open questions, and questions anywhere but on an opportunity', () => {
      const question = (patch: Record<string, unknown>) => withNode(2, { questions: [{ id: 1, text: 'Who?', ...patch }] });
      rejects(withNode(2, { questions: {} }), /open questions that are not a list/);
      rejects(question({ id: null }), /missing or repeated id/);
      rejects(question({ text: ' ' }), /invalid text/);
      rejects(question({ text: 't'.repeat(501) }));
      rejects(question({ done: 'yes' }), /invalid "done"/);
      rejects(withNode(3, { questions: [{ id: 9, text: 'Why?' }] }), /only opportunities can have/);
      rejects(
        withNode(2, {
          questions: [
            { id: 1, text: 'A' },
            { id: 1, text: 'B' },
          ],
        }),
        /missing or repeated id/,
      );
    });

    it('never throws anything but a DocumentFormatError for hostile shapes', () => {
      for (const value of [
        undefined,
        null,
        0,
        'x',
        [],
        { format: 'ombuto-ost' },
        { format: 'ombuto-ost', version: 1, name: 'x', nodes: [[]] },
      ]) {
        expect(() => validateDocument(value)).toThrow(DocumentFormatError);
      }
    });
  });

  describe('names', () => {
    it('cleans a document name and falls back to the default', () => {
      expect(cleanDocumentName('  My   tree \n')).toBe('My tree');
      expect(cleanDocumentName('   ')).toBe(DEFAULT_DOCUMENT_NAME);
      expect(cleanDocumentName('n'.repeat(500))).toHaveLength(DOCUMENT_NAME_MAX);
    });

    it('derives a safe file name from the document name', () => {
      expect(fileNameFor('My tree')).toBe('My tree.ost');
      expect(fileNameFor('Q3: plan / ideas?')).toBe('Q3 plan ideas.ost');
      expect(fileNameFor('a\\b<c>d|e*f"g')).toBe('a b c d e f g.ost');
      expect(fileNameFor('trailing dots...')).toBe('trailing dots.ost');
      expect(fileNameFor('///')).toBe(`${DEFAULT_DOCUMENT_NAME}.ost`);
      expect(fileNameFor('tab\there')).toBe('tab here.ost');
    });
  });

  describe('new nodes', () => {
    it('start with the first status of their type and the default numbers', () => {
      expect(newNodeFields('project')).toEqual({ status: null, confidence: null, priority: null, valueRating: null, owner: null });
      expect(newNodeFields('opportunity')).toEqual({ status: 'unexplored', confidence: null, priority: 50, valueRating: 3, owner: null });
      expect(newNodeFields('solution').status).toBe('candidate');
      expect(newNodeFields('assumption')).toMatchObject({ status: 'untested', confidence: 40 });
      expect(newNodeFields('evidence').status).toBeNull();
    });

    it('get a default title', () => {
      expect(defaultTitle('opportunity')).toBe('New opportunity');
      expect(defaultTitle('evidence')).toBe('New snippet');
    });
  });
  describe('projects inside projects', () => {
    /** project 1 > (outcome 2 > …, project 7 > (outcome 8, project 9)), plus project 10 at the top. */
    const nested = () => {
      const file = valid();
      file.nodes.push(
        { id: 7, type: 'project', parentId: 1, title: 'Sub-project' },
        { id: 8, type: 'outcome', parentId: 7, title: 'Its outcome' },
        { id: 9, type: 'project', parentId: 7, title: 'Sub-sub-project', sortOrder: 0 },
        { id: 10, type: 'project', parentId: null, title: 'Another top-level project', sortOrder: 1 },
      );
      return file;
    };

    it('a project may be at the top or under another project, with projects and outcomes mixed beneath it', () => {
      const doc = validateDocument(nested());
      expect(doc.nodes.filter(n => n.type === 'project').map(n => [n.id, n.parentId])).toEqual([
        [1, null],
        [7, 1],
        [9, 7],
        [10, null],
      ]);
      expect(doc.nodes.filter(n => n.parentId === 1).map(n => n.type)).toEqual(['outcome', 'project']);
      // What is written is read back unchanged.
      expect(parseDocument(serializeDocument(doc))).toEqual(doc);
    });

    it('only a project holds a project, and only a project may have no parent', () => {
      for (const parentId of [2, 3, 4, 5, 6]) {
        const file = nested();
        Object.assign(file.nodes[6], { parentId });
        rejects(file, /node 7 is a project under a \w+, which is not allowed/);
      }
      const orphan = nested();
      Object.assign(orphan.nodes[7], { parentId: null });
      rejects(orphan, /node 8 has no valid parentId/);
    });

    it('nested projects count towards the depth limit', () => {
      const chain = (levels: number) => ({
        ...valid(),
        nodes: Array.from({ length: levels }, (_, i) => ({
          id: i + 1,
          type: 'project',
          parentId: i === 0 ? null : i,
          title: `Level ${i + 1}`,
        })),
      });
      expect(validateDocument(chain(MAX_DEPTH)).nodes).toHaveLength(MAX_DEPTH);
      rejects(chain(MAX_DEPTH + 1), /more than 64 levels deep/);
    });
  });

  describe('files from the first published build ("product" instead of "project")', () => {
    it('opens them: every product is a project, everything else is as it was', () => {
      const now = new Date('2026-01-02T03:04:05Z');
      const text = legacyFileText(now);
      expect(JSON.parse(text).nodes[0]).toMatchObject({ id: 1, type: 'product', parentId: null });
      expect(parseDocument(text)).toEqual(smallDocument(now));
    });

    it('still reads version 1, and writes "project" from then on', () => {
      const file = valid();
      file.nodes[0].type = 'product';
      const doc = validateDocument(file);
      expect(doc.version).toBe(1);
      expect(doc.nodes[0]).toMatchObject({ id: 1, type: 'project', parentId: null });
      const written = serializeDocument(doc);
      expect(written).toContain('"type": "project"');
      expect(written).not.toContain('product');
    });

    it('applies the rules of a project to them', () => {
      const file = valid();
      file.nodes[0].type = 'product';
      rejects({ ...file, nodes: [{ ...file.nodes[0], title: 'p'.repeat(101) }] }, /needs a title of 2 to 100 characters/);
      rejects({ ...file, nodes: [{ ...file.nodes[0], status: 'exploring' }] }, /does not apply to project nodes/);
      // A product under a product is simply a project under a project.
      file.nodes.push({ id: 7, type: 'product', parentId: 1, title: 'Inner' });
      expect(validateDocument(file).nodes.at(-1)).toMatchObject({ type: 'project', parentId: 1 });
    });

    it('maps that one name only: other unknown types are still refused', () => {
      for (const type of ['Product', 'PRODUCT', 'products', 'programme', '']) rejects(withNode(0, { type }), /has an unknown type/);
    });

    it('the mapping itself: type names and remembered node keys', () => {
      expect(currentNodeType('product')).toBe('project');
      expect(currentNodeType('project')).toBe('project');
      expect(currentNodeType('outcome')).toBe('outcome');
      expect(currentNodeType('toString')).toBe('toString');
      expect(currentNodeType(7)).toBe(7);
      expect(currentNodeKey('product-12')).toBe('project-12');
      expect(currentNodeKey('project-12')).toBe('project-12');
      expect(currentNodeKey('opportunity-3')).toBe('opportunity-3');
      expect(currentNodeKey('product')).toBe('product');
    });
  });
});
describe('node colours in the file', () => {
  const STAMP = new Date('2026-03-01T09:00:00.000Z');
  /** The keys of a node as the format has always written them, in order. */
  const KEYS = [
    'id',
    'type',
    'parentId',
    'title',
    'notes',
    'status',
    'confidence',
    'priority',
    'valueRating',
    'owner',
    'sortOrder',
    'createdDate',
    'lastModifiedDate',
    'links',
    'questions',
  ];
  const withColor = (color: unknown) => {
    const file = valid();
    (file.nodes[1] as Record<string, unknown>).color = color;
    return file;
  };

  it('a file without colours is written exactly as before: no "color" key anywhere, the same keys in the same order', () => {
    const text = serializeDocument(smallDocument(STAMP));
    expect(text).not.toContain('color');
    for (const node of JSON.parse(text).nodes) expect(Object.keys(node)).toEqual(KEYS);
    // Opening and saving it again gives the same bytes.
    expect(serializeDocument(parseDocument(text))).toBe(text);
    expect(parseDocument(text).nodes.every(n => !('color' in n))).toBe(true);
  });

  it('the built-in example and a first-build file round-trip byte for byte too', () => {
    const example = serializeDocument(sampleDocument(STAMP));
    expect(serializeDocument(parseDocument(example))).toBe(example);
    const legacy = parseDocument(legacyFileText(STAMP));
    expect(serializeDocument(legacy)).not.toContain('color');
  });

  it.each([...NODE_COLORS])('keeps the known name "%s", written after "owner" on any node type', name => {
    const doc = validateDocument(withColor(name));
    expect(doc.nodes[1].color).toBe(name);
    expect(doc.nodes[0]).not.toHaveProperty('color');
    const text = serializeDocument(doc);
    expect(text).toContain(`    "owner": null,\n      "color": "${name}",\n      "sortOrder": 0,`);
    expect(Object.keys(JSON.parse(text).nodes[1])).toEqual([...KEYS.slice(0, 10), 'color', ...KEYS.slice(10)]);
    expect(serializeDocument(parseDocument(text))).toBe(text);
    expect(cloneDocument(doc)).toEqual(doc);
  });

  it.each([
    ['a value that tries to carry CSS', 'red; background:url(https://example.com)'],
    ['a hex value', '#ff0000'],
    ['a name in another case', 'Teal'],
    ['a padded name', ' teal '],
    ['an unknown name', 'chartreuse'],
    ['an object property name', 'constructor'],
    ['an empty string', ''],
    ['a number', 7],
    ['a boolean', true],
    ['null', null],
    ['an object', { name: 'teal' }],
    ['a list', ['teal']],
  ])('drops %s: the node opens with its default look and the file still opens', (_what, value) => {
    const doc = validateDocument(withColor(value));
    expect(doc.nodes).toHaveLength(valid().nodes.length);
    expect(doc.nodes[1]).not.toHaveProperty('color');
    const text = serializeDocument(doc);
    expect(text).not.toContain('color');
    expect(text).not.toContain('example.com)');
    expect(text).toBe(serializeDocument(validateDocument(valid())));
  });

  it('never writes a colour that is not in the palette, even if one got into memory', () => {
    const doc = validateDocument(valid());
    (doc.nodes[0] as { color?: unknown }).color = 'url(https://example.com)';
    expect(serializeDocument(doc)).not.toContain('color');
  });
});
