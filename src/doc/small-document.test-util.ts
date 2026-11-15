/*
 * Test-only: a small, fixed document for specs that count nodes or name them by id (not imported by
 * application code). One project, one outcome, nested opportunities, solutions, assumptions and
 * evidence; ids 1 to 14 in the order the nodes are added below. The built-in example the app shows
 * (sample.ts) is free to change without touching those specs.
 */
import type { NodeType } from '@/ost/domain/types';

import { type DocNode, type OstDocument, emptyDocument, newNodeFields, serializeDocument } from './document';

type Extra = Partial<Pick<DocNode, 'notes' | 'status' | 'confidence' | 'priority' | 'valueRating' | 'owner'>> & {
  links?: { name: string; url: string }[];
  questions?: { text: string; done?: boolean }[];
};

export function smallDocument(now = new Date()): OstDocument {
  const doc = emptyDocument('Example: meal-planning app');
  const stamp = now.toISOString();
  let nextId = 1;
  let nextLinkId = 1;
  let nextQuestionId = 1;

  /** Adds a node under `parent` (null for the project) and returns its id. */
  const add = (type: NodeType, parent: number | null, title: string, extra: Extra = {}): number => {
    const { links = [], questions = [], ...fields } = extra;
    const id = nextId++;
    doc.nodes.push({
      id,
      type,
      parentId: parent,
      title,
      notes: '',
      ...newNodeFields(type),
      ...fields,
      sortOrder: doc.nodes.filter(n => n.type === type && n.parentId === parent).length,
      createdDate: stamp,
      lastModifiedDate: stamp,
      links: links.map(l => ({ id: nextLinkId++, ...l })),
      questions: questions.map(q => ({ id: nextQuestionId++, text: q.text, done: q.done === true })),
    });
    return id;
  };

  const project = add('project', null, 'Meal-planning app', {
    notes: 'A small example tree. Change anything: it only lives on this device.',
  });
  const outcome = add('outcome', project, 'More people plan a full week of meals', {
    notes: 'Measured as the share of active households that finish a weekly plan.',
  });

  const deciding = add('opportunity', outcome, 'Deciding what to cook takes too long', {
    status: 'exploring',
    priority: 82,
    valueRating: 4,
    notes: 'Came up in most interviews: the plan stalls on the first empty evening.',
    questions: [{ text: 'Is this worse on weekdays than at weekends?' }, { text: 'Who in the household decides?', done: true }],
  });
  add('evidence', deciding, '7 of 10 interviewees gave up before filling Wednesday');
  add('opportunity', deciding, 'Nobody remembers what was liked last time', { status: 'unexplored', priority: 55, valueRating: 3 });

  const suggestions = add('solution', deciding, 'Suggest a week from past favourites', { status: 'exploring' });
  const willAccept = add('assumption', suggestions, 'People accept a suggested plan with small edits', {
    status: 'testing',
    confidence: 60,
    owner: 'Research',
  });
  add('evidence', willAccept, 'Prototype test: 5 of 8 kept at least four suggestions');
  add('assumption', suggestions, 'Past meals are logged often enough to learn from', { status: 'untested', confidence: 40 });
  add('solution', deciding, 'Themed nights that fill themselves in', { status: 'candidate' });

  const shopping = add('opportunity', outcome, 'The shopping list does not match the plan', {
    status: 'validated',
    priority: 64,
    valueRating: 5,
    links: [{ name: 'Interview notes', url: 'https://example.com/interview-notes' }],
  });
  const autoList = add('solution', shopping, 'Build the list from the plan automatically', { status: 'building' });
  add('assumption', autoList, 'Quantities can be merged across recipes reliably', { status: 'supported', confidence: 80 });

  add('opportunity', outcome, 'Plans fall apart when the week changes', { status: 'parked', priority: 30, valueRating: 2 });

  return doc;
}

/**
 * The small document as the first published build saved it: the top node type was called
 * "product" (see legacy.ts). The text of a `.ost` file from that build.
 */
export function legacyFileText(now = new Date()): string {
  const text = serializeDocument(smallDocument(now)).replaceAll('"type": "project"', '"type": "product"');
  if (!text.includes('"type": "product"') || text.includes('"type": "project"')) throw new Error('not a legacy file');
  return text;
}
