/*
 * The `.ost` document: one file holds one tree (which may contain several projects, and projects
 * inside projects).
 *
 * The file is pretty-printed JSON so it diffs well and reads easily, for people and for AI agents:
 *
 *   { "format": "ombuto-ost", "version": 1, "name": "…", "nodes": [ { "id": 1, "type": "project", … } ] }
 *
 * Opening a file is strict: `parseDocument` checks every value and rebuilds a clean object from the
 * known fields only, so nothing unexpected from a file ever reaches the app. File content is only
 * ever shown as text.
 *
 * Files from the first published build call a project a "product": see legacy.ts.
 */
import { TITLE_MIN, titleMax } from '@/ost/canvas/edit-rules';
import { ALLOWED, STATUS } from '@/ost/domain/rules';
import { NODE_TYPES, type NodeType } from '@/ost/domain/types';

import { currentNodeType } from './legacy';

export const DOCUMENT_FORMAT = 'ombuto-ost';
export const DOCUMENT_VERSION = 1;
export const FILE_EXTENSION = '.ost';
export const FILE_MIME = 'application/json';
export const DEFAULT_DOCUMENT_NAME = 'Untitled tree';

export const DOCUMENT_NAME_MAX = 120;
export const NOTES_MAX = 20000;
export const OWNER_MAX = 100;
export const LINK_NAME_MAX = 100;
export const LINK_URL_MAX = 2000;
export const QUESTION_TEXT_MAX = 500;
export const MAX_LINKS_PER_NODE = 200;
export const MAX_QUESTIONS_PER_NODE = 200;
/**
 * The largest tree the app opens or lets you build. Measured, not guessed: at this size opening,
 * editing, collapsing and panning stay responsive in a desktop browser (the numbers are in
 * README.md, "Limits"). Far beyond any real tree.
 */
export const MAX_NODES = 1000;
/**
 * The deepest a tree may be, counting the top-level project as level 1. Only projects and
 * opportunities nest, and real trees stay well under 20 levels; the cap keeps every walk over the tree far from the call-stack
 * limit and the canvas a size that can be drawn.
 */
export const MAX_DEPTH = 64;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const DEFAULT_CONFIDENCE = 40;
export const DEFAULT_PRIORITY = 50;
export const DEFAULT_VALUE_RATING = 3;

export interface DocLink {
  id: number;
  name: string;
  url: string;
}

export interface DocQuestion {
  id: number;
  text: string;
  done: boolean;
}

export interface DocNode {
  /** Unique in the file, across every node type. */
  id: number;
  type: NodeType;
  /** null for a top-level project; a sub-project names its parent project. */
  parentId: number | null;
  title: string;
  notes: string;
  /** opportunity / solution / assumption: one of STATUS[type]; null for the other types. */
  status: string | null;
  /** assumptions only (0-100); null otherwise. */
  confidence: number | null;
  /** opportunities only (1-100); null otherwise. */
  priority: number | null;
  /** opportunities only (1-5); null otherwise. */
  valueRating: number | null;
  /** assumptions only: free text; null when unassigned or not applicable. */
  owner: string | null;
  /** Order among siblings of the same type under one parent (top-level projects: among each other). */
  sortOrder: number;
  createdDate: string | null;
  lastModifiedDate: string | null;
  links: DocLink[];
  /** opportunities only; empty otherwise. */
  questions: DocQuestion[];
}

export interface OstDocument {
  format: typeof DOCUMENT_FORMAT;
  version: typeof DOCUMENT_VERSION;
  name: string;
  nodes: DocNode[];
}

/** A file that is not a valid Ombuto OST document. The message is written for the person opening it. */
export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentFormatError';
  }
}

export const emptyDocument = (name = DEFAULT_DOCUMENT_NAME): OstDocument => ({
  format: DOCUMENT_FORMAT,
  version: DOCUMENT_VERSION,
  name,
  nodes: [],
});

/** Field defaults of a freshly created node of `type` (the caller sets id, parent, order and dates). */
export function newNodeFields(type: NodeType): Pick<DocNode, 'status' | 'confidence' | 'priority' | 'valueRating' | 'owner'> {
  return {
    status: STATUS[type][0] ?? null,
    confidence: type === 'assumption' ? DEFAULT_CONFIDENCE : null,
    priority: type === 'opportunity' ? DEFAULT_PRIORITY : null,
    valueRating: type === 'opportunity' ? DEFAULT_VALUE_RATING : null,
    owner: null,
  };
}

/** Title given to a node created without one. */
export const defaultTitle = (type: NodeType): string => (type === 'evidence' ? 'New snippet' : `New ${type}`);

/** Trimmed document name, or the default when nothing usable is left. */
export function cleanDocumentName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_NAME_MAX);
  return name || DEFAULT_DOCUMENT_NAME;
}

// ---- writing --------------------------------------------------------------------------------------

/** The file text: stable key order, two-space indent, trailing newline. */
export function serializeDocument(doc: OstDocument): string {
  const nodes = doc.nodes.map(n => ({
    id: n.id,
    type: n.type,
    parentId: n.parentId,
    title: n.title,
    notes: n.notes,
    status: n.status,
    confidence: n.confidence,
    priority: n.priority,
    valueRating: n.valueRating,
    owner: n.owner,
    sortOrder: n.sortOrder,
    createdDate: n.createdDate,
    lastModifiedDate: n.lastModifiedDate,
    links: n.links.map(l => ({ id: l.id, name: l.name, url: l.url })),
    questions: n.questions.map(q => ({ id: q.id, text: q.text, done: q.done })),
  }));
  return `${JSON.stringify({ format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name: doc.name, nodes }, null, 2)}\n`;
}

/** A structured copy with no shared references (what goes to IndexedDB, and what `open` keeps). */
export const cloneDocument = (doc: OstDocument): OstDocument => JSON.parse(serializeDocument(doc)) as OstDocument;

// ---- size ---------------------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Bytes of `text` as it is written in the file: a JSON string, in UTF-8. */
const jsonBytes = (text: string | null): number => (text === null ? 4 : encoder.encode(JSON.stringify(text)).length);

/** More than the keys, numbers, dates, indentation and separators of one node / link / question can take. */
const NODE_OVERHEAD_BYTES = 640;
const LINK_OVERHEAD_BYTES = 110;
const QUESTION_OVERHEAD_BYTES = 120;
/** More than the format line, the name and the brackets around the nodes can take. */
const ENVELOPE_BYTES = 2048;

/**
 * An upper bound on the bytes one node takes in the file. It depends only on the node's text, so
 * moving or renumbering nodes never changes it, and the document service can keep a running total.
 */
export function nodeWeight(node: DocNode): number {
  let bytes = NODE_OVERHEAD_BYTES + jsonBytes(node.title) + jsonBytes(node.notes) + jsonBytes(node.status) + jsonBytes(node.owner);
  for (const l of node.links) bytes += LINK_OVERHEAD_BYTES + jsonBytes(l.name) + jsonBytes(l.url);
  for (const q of node.questions) bytes += QUESTION_OVERHEAD_BYTES + jsonBytes(q.text);
  return bytes;
}

/** The most `nodeWeight` a document's nodes may add up to: its file then fits in MAX_FILE_BYTES. */
export const MAX_NODES_WEIGHT = MAX_FILE_BYTES - ENVELOPE_BYTES;

/** Characters a file system refuses in a file name. */
const UNSAFE_FILE_CHARS = new Set('<>:"/\\|?*');

/** "My tree" -> "My tree.ost" (characters a file system refuses are replaced). */
export function fileNameFor(name: string): string {
  const base = [...name]
    .map(ch => (UNSAFE_FILE_CHARS.has(ch) || ch.charCodeAt(0) < 32 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
  return `${base || DEFAULT_DOCUMENT_NAME}${FILE_EXTENSION}`;
}

// ---- reading (strict) -----------------------------------------------------------------------------

const NOT_OST = 'This file is not an Ombuto OST tree.';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function fail(where: string, problem: string): never {
  throw new DocumentFormatError(`This file cannot be opened: ${where} ${problem}.`);
}

function readDate(value: unknown, where: string, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) fail(where, `has an invalid ${field}`);
  return value;
}

function readLinks(value: unknown, where: string, seen: Set<number>): DocLink[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) fail(where, 'has links that are not a list');
  if (value.length > MAX_LINKS_PER_NODE) fail(where, `has more than ${MAX_LINKS_PER_NODE} links`);
  return value.map(raw => {
    if (!isRecord(raw)) fail(where, 'has a link that is not an object');
    const { id, name, url } = raw;
    if (!isId(id) || seen.has(id)) fail(where, 'has a link with a missing or repeated id');
    seen.add(id);
    if (typeof name !== 'string' || !name.trim() || name.length > LINK_NAME_MAX) fail(where, 'has a link with an invalid name');
    if (typeof url !== 'string' || !url.trim() || url.length > LINK_URL_MAX) fail(where, 'has a link with an invalid URL');
    return { id, name: name.trim(), url: url.trim() };
  });
}

function readQuestions(value: unknown, where: string, type: NodeType, seen: Set<number>): DocQuestion[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) fail(where, 'has open questions that are not a list');
  if (value.length && type !== 'opportunity') fail(where, 'has open questions, which only opportunities can have');
  if (value.length > MAX_QUESTIONS_PER_NODE) fail(where, `has more than ${MAX_QUESTIONS_PER_NODE} open questions`);
  return value.map(raw => {
    if (!isRecord(raw)) fail(where, 'has an open question that is not an object');
    const { id, text, done } = raw;
    if (!isId(id) || seen.has(id)) fail(where, 'has an open question with a missing or repeated id');
    seen.add(id);
    if (typeof text !== 'string' || !text.trim() || text.length > QUESTION_TEXT_MAX) fail(where, 'has an open question with invalid text');
    if (done !== undefined && typeof done !== 'boolean') fail(where, 'has an open question with an invalid "done" value');
    return { id, text: text.trim(), done: done === true };
  });
}

/** A value that must be absent for this node type. */
function requireUnset(value: unknown, where: string, field: string, type: NodeType): void {
  if (value !== null && value !== undefined) fail(where, `has a ${field}, which does not apply to ${type} nodes`);
}

function readNode(raw: unknown, index: number, linkIds: Set<number>, questionIds: Set<number>): DocNode {
  if (!isRecord(raw)) fail(`entry ${index + 1} of "nodes"`, 'is not an object');
  const { id } = raw;
  // The one place a file's type name is read: "product" from the first published build is a project.
  const type = currentNodeType(raw.type);
  if (!isId(id)) fail(`entry ${index + 1} of "nodes"`, 'has no valid id');
  const where = `node ${id}`;
  if (typeof type !== 'string' || !NODE_TYPES.includes(type as NodeType)) fail(where, 'has an unknown type');
  const nodeType = type as NodeType;

  const parentId = raw.parentId ?? null;
  // Only a project may be at the top of the tree (no parent). What a parent may hold is checked
  // once every node is known (ALLOWED, in validateDocument).
  if (parentId !== null ? !isId(parentId) : nodeType !== 'project') fail(where, 'has no valid parentId');

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length < TITLE_MIN || title.length > titleMax(nodeType)) {
    fail(where, `needs a title of ${TITLE_MIN} to ${titleMax(nodeType)} characters`);
  }

  const notes = raw.notes ?? '';
  if (typeof notes !== 'string' || notes.length > NOTES_MAX) fail(where, 'has invalid notes');

  const vocabulary = STATUS[nodeType];
  let status: string | null = null;
  if (vocabulary.length) {
    if (typeof raw.status !== 'string' || !vocabulary.includes(raw.status)) {
      fail(where, `needs a status that is one of: ${vocabulary.join(', ')}`);
    }
    status = raw.status;
  } else if (raw.status !== '') {
    requireUnset(raw.status, where, 'status', nodeType);
  }

  let confidence: number | null = null;
  let owner: string | null = null;
  if (nodeType === 'assumption') {
    if (!isIntIn(raw.confidence, 0, 100)) fail(where, 'needs a confidence between 0 and 100');
    confidence = raw.confidence;
    const rawOwner = raw.owner ?? '';
    if (typeof rawOwner !== 'string' || rawOwner.length > OWNER_MAX) fail(where, 'has an invalid owner');
    owner = rawOwner.trim() || null;
  } else {
    requireUnset(raw.confidence, where, 'confidence', nodeType);
    if (raw.owner !== '') requireUnset(raw.owner, where, 'owner', nodeType);
  }

  let priority: number | null = null;
  let valueRating: number | null = null;
  if (nodeType === 'opportunity') {
    if (!isIntIn(raw.priority, 1, 100)) fail(where, 'needs a priority between 1 and 100');
    if (!isIntIn(raw.valueRating, 1, 5)) fail(where, 'needs a valueRating between 1 and 5');
    priority = raw.priority;
    valueRating = raw.valueRating;
  } else {
    requireUnset(raw.priority, where, 'priority', nodeType);
    requireUnset(raw.valueRating, where, 'valueRating', nodeType);
  }

  const sortOrder = raw.sortOrder ?? 0;
  if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) fail(where, 'has an invalid sortOrder');

  return {
    id,
    type: nodeType,
    parentId: parentId as number | null,
    title,
    notes,
    status,
    confidence,
    priority,
    valueRating,
    owner,
    sortOrder,
    createdDate: readDate(raw.createdDate, where, 'createdDate'),
    lastModifiedDate: readDate(raw.lastModifiedDate, where, 'lastModifiedDate'),
    links: readLinks(raw.links, where, linkIds),
    questions: readQuestions(raw.questions, where, nodeType, questionIds),
  };
}

/** Checks a parsed JSON value and returns a clean document, or throws DocumentFormatError. */
export function validateDocument(value: unknown): OstDocument {
  if (!isRecord(value) || value.format !== DOCUMENT_FORMAT) throw new DocumentFormatError(NOT_OST);
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) throw new DocumentFormatError(NOT_OST);
  if (value.version > DOCUMENT_VERSION) {
    throw new DocumentFormatError('This file was saved by a newer version of Ombuto OST. Update the app to open it.');
  }
  if (typeof value.name !== 'string') fail('the tree', 'has no name');
  if (!Array.isArray(value.nodes)) fail('the tree', 'has no list of nodes');
  if (value.nodes.length > MAX_NODES) fail('the tree', `has more than ${MAX_NODES.toLocaleString('en')} nodes`);

  const linkIds = new Set<number>();
  const questionIds = new Set<number>();
  const nodes = value.nodes.map((raw, i) => readNode(raw, i, linkIds, questionIds));

  const byId = new Map<number, DocNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) fail(`node ${n.id}`, 'appears more than once');
    byId.set(n.id, n);
  }
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const parent = byId.get(n.parentId);
    if (!parent) fail(`node ${n.id}`, `refers to a parent (${n.parentId}) that is not in the file`);
    if (!ALLOWED[parent.type].includes(n.type)) fail(`node ${n.id}`, `is a ${n.type} under a ${parent.type}, which is not allowed`);
  }
  // Every node must reach a top-level project, within MAX_DEPTH levels. The type matrix already
  // rules out every loop except one made of projects or one made of opportunities, which would
  // otherwise hang off nothing.
  const depths = new Map<number, number>();
  for (const start of nodes) {
    const trail: DocNode[] = [];
    const onTrail = new Set<number>();
    let current: DocNode | undefined = start;
    while (current && !depths.has(current.id) && current.parentId !== null) {
      if (onTrail.has(current.id)) fail(`node ${start.id}`, 'is part of a loop of parents');
      onTrail.add(current.id);
      trail.push(current);
      current = byId.get(current.parentId);
    }
    // `current` is a top-level project, or a node whose depth is already known.
    let depth = current ? (depths.get(current.id) ?? 1) : 1;
    if (current) depths.set(current.id, depth);
    for (let i = trail.length - 1; i >= 0; i--) depths.set(trail[i].id, ++depth);
    if (depth > MAX_DEPTH) fail('the tree', `is more than ${MAX_DEPTH} levels deep`);
  }

  let weight = 0;
  for (const n of nodes) weight += nodeWeight(n);
  if (weight > MAX_NODES_WEIGHT) fail('the tree', 'holds more text than an Ombuto OST file can');

  return { format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name: cleanDocumentName(value.name), nodes };
}

/** Parses the text of a `.ost` file. Throws DocumentFormatError with a message for the user. */
export function parseDocument(text: string): OstDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DocumentFormatError(NOT_OST);
  }
  return validateDocument(value);
}
