/*
 * The built-in example tree ("Open example" on the empty state and in the File menu): a generic
 * product-discovery tree that shows every node type, sub-projects inside a project, a nested
 * opportunity, most statuses, notes, links and open questions. It is ordinary document data, built
 * here rather than fetched; it opens as an unsaved document that belongs to no file.
 *
 * It is kept to eight columns of leaves, so the whole tree fits a 1600px-wide window at the
 * smallest zoom Fit uses.
 */
import type { NodeType } from '@/ost/domain/types';

import { type DocNode, type OstDocument, emptyDocument, newNodeFields } from './document';

type Extra = Partial<Pick<DocNode, 'notes' | 'status' | 'confidence' | 'priority' | 'valueRating' | 'owner'>> & {
  links?: { name: string; url: string }[];
  questions?: { text: string; done?: boolean }[];
};

export function sampleDocument(now = new Date()): OstDocument {
  const doc = emptyDocument('Example: meal-planning app');
  const stamp = now.toISOString();
  let nextId = 1;
  let nextLinkId = 1;
  let nextQuestionId = 1;

  /** Adds a node under `parent` (null for the top-level project) and returns its id. */
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

  // One top-level project with two sub-projects. Each sub-project has its own outcome; the project
  // itself has one too, beside them.
  const app = add('project', null, 'Meal-planning app', {
    notes: 'An example tree. Change anything: it only lives on this device.\nEach sub-project below has its own outcome to move.',
    links: [{ name: 'Discovery plan', url: 'https://example.com/discovery-plan' }],
  });

  // ---- sub-project: Weekly planner ---------------------------------------------------------------
  const planner = add('project', app, 'Weekly planner', { notes: 'Choosing the meals for the week ahead.' });
  const planning = add('outcome', planner, 'More households plan a full week of meals', {
    notes: 'Measured as the share of active households that finish a weekly plan.',
  });
  const deciding = add('opportunity', planning, 'Deciding what to cook takes too long', {
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
  add('evidence', willAccept, 'Prototype test: 5 of 8 kept at least four suggestions', {
    links: [{ name: 'Test sessions', url: 'https://example.com/prototype-test' }],
  });
  add('opportunity', planning, 'Plans fall apart when the week changes', { status: 'parked', priority: 30, valueRating: 2 });

  // ---- sub-project: Shopping list ----------------------------------------------------------------
  const shopping = add('project', app, 'Shopping list', { notes: 'Getting from the plan to the food in the kitchen.' });
  const forgotten = add('outcome', shopping, 'Fewer forgotten ingredients per shop', {
    notes: 'Measured as extra trips to the shop reported per household per month.',
  });
  const mismatch = add('opportunity', forgotten, 'The shopping list does not match the plan', {
    status: 'validated',
    priority: 64,
    valueRating: 5,
    links: [{ name: 'Interview notes', url: 'https://example.com/interview-notes' }],
  });
  const autoList = add('solution', mismatch, 'Build the list from the plan automatically', { status: 'building' });
  const merging = add('assumption', autoList, 'Quantities can be merged across recipes reliably', { status: 'supported', confidence: 80 });
  add('evidence', merging, 'Merge check on 40 real plans: 38 lists were correct');
  const photo = add('solution', mismatch, 'Import a photo of a paper list', {
    status: 'dropped',
    notes: 'Dropped after the survey: too few people start from paper.',
  });
  const onPaper = add('assumption', photo, 'Most households still write their list on paper', {
    status: 'refuted',
    confidence: 15,
    owner: 'Research',
  });
  add('evidence', onPaper, 'Survey of 120 households: only 9 start from paper');
  const inShop = add('opportunity', forgotten, 'Finding the items in the shop takes too long', {
    status: 'exploring',
    priority: 48,
    valueRating: 3,
    questions: [{ text: 'Does this differ between a weekly shop and a top-up shop?' }],
  });
  const byAisle = add('solution', inShop, 'Sort the list by aisle', { status: 'candidate' });
  const aisles = add('assumption', byAisle, 'Aisle order is similar enough between shops', {
    status: 'untested',
    confidence: 40,
    owner: 'Design',
  });
  add('evidence', aisles, 'Walked six shops: the first four aisles matched in five');

  // ---- the project's own outcome -----------------------------------------------------------------
  const habit = add('outcome', app, 'Households still plan after the first month', {
    notes: 'An outcome of the whole app, so it sits on the project itself, beside the sub-projects.',
  });
  const fading = add('opportunity', habit, 'Planning is forgotten once the novelty fades', {
    status: 'exploring',
    priority: 71,
    valueRating: 4,
  });
  add('solution', fading, 'A Sunday reminder to plan the week', { status: 'shipped' });

  return doc;
}
