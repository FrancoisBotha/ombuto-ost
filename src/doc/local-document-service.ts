/*
 * The local document service: the seam the tree store talks to. It has the method names and
 * promise-returning signatures of a remote tree API, but every call reads or changes an in-memory
 * `.ost` document — nothing leaves the device.
 *
 * The rules a server would enforce live here: id allocation, `sortOrder` on create (append) and on
 * move (both sibling groups are renumbered 0..n-1), the allowed parent -> child matrix, no moves
 * under a descendant, cascade delete of a subtree, and every limit of the file format (field
 * lengths, node count, depth, links and questions per node, total size). A refused write rejects
 * with a RuleError; the document is left untouched.
 *
 * The service and the file format agree: whatever sequence of calls is made here, the document it
 * holds is one `validateDocument` accepts, so the app never saves a file it cannot open again.
 *
 * It also keeps the history (history.ts): every change made here is a step that `undo` takes back
 * and `redo` makes again. Both put a whole earlier state back, through `validateDocument` — the
 * check a file goes through on open — so a restored document is held to every limit too. Ids are
 * part of the state and are never handed out twice, so a node that comes back is the node it was.
 */
import { TITLE_MIN, titleMax } from '@/ost/canvas/edit-rules';
import { nodeKey, toNodeType } from '@/ost/domain/mapping';
import { ALLOWED, STATUS, isSafeLinkUrl } from '@/ost/domain/rules';
import type { NodeType } from '@/ost/domain/types';
import { RuleError } from '@/ost/ost-errors';
import type {
  ApiNodeType,
  CreateNodeRequest,
  MoveNodeRequest,
  MoveNodeResponse,
  NodeLinkDTO,
  OpenQuestionDTO,
  PatchNodeRequest,
  TreeNodeDTO,
} from '@/ost/ost.model';

import {
  type DocNode,
  LINK_NAME_MAX,
  LINK_URL_MAX,
  MAX_DEPTH,
  MAX_LINKS_PER_NODE,
  MAX_NODES,
  MAX_NODES_WEIGHT,
  MAX_QUESTIONS_PER_NODE,
  NOTES_MAX,
  OWNER_MAX,
  type OstDocument,
  QUESTION_TEXT_MAX,
  cleanDocumentName,
  cloneDocument,
  defaultTitle,
  newNodeFields,
  nodeWeight,
  validateDocument,
} from './document';
import { type Change, type DocState, DocumentHistory, type HistoryStep, captureState } from './history';

/** Which node types each patchable field applies to. */
const APPLICABLE: Record<keyof PatchNodeRequest, NodeType[] | 'all'> = {
  title: 'all',
  notes: 'all',
  status: ['opportunity', 'solution', 'assumption'],
  confidence: ['assumption'],
  priority: ['opportunity'],
  valueRating: ['opportunity'],
  owner: ['assumption'],
};

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** How a change to each field reads in the history ("Undo rename …"); typing in a `text` field is one step. */
const FIELD_CHANGE: Record<keyof PatchNodeRequest, { verb: string; text?: boolean }> = {
  title: { verb: 'rename', text: true },
  notes: { verb: 'edit notes of', text: true },
  status: { verb: 'change status of' },
  confidence: { verb: 'change confidence of' },
  priority: { verb: 'change priority of' },
  valueRating: { verb: 'change value of' },
  owner: { verb: 'edit owner of', text: true },
};

const bySortOrder = (a: DocNode, b: DocNode) => a.sortOrder - b.sortOrder || a.id - b.id;

/**
 * Hands out ids that are unique and that the file format accepts (positive safe integers). Ids
 * count up from the largest one in the document; if a file already uses the largest number there
 * is, the smallest free id is used instead.
 */
class IdAllocator {
  private next = 1;

  constructor(private readonly used: () => number[]) {}

  reset(): void {
    this.next = this.used().reduce((a, b) => Math.max(a, b), 0) + 1;
  }

  take(): number {
    if (Number.isSafeInteger(this.next)) return this.next++;
    const taken = new Set(this.used());
    let id = 1;
    while (taken.has(id)) id++;
    return id;
  }
}

function toDto(node: DocNode, parentType: NodeType | undefined): TreeNodeDTO {
  return {
    key: nodeKey(node.type, node.id),
    type: node.type.toUpperCase() as ApiNodeType,
    id: node.id,
    parentKey: parentType && node.parentId !== null ? nodeKey(parentType, node.parentId) : null,
    title: node.title,
    notes: node.notes || null,
    status: node.status ? node.status.toUpperCase() : null,
    confidence: node.confidence,
    priority: node.priority,
    valueRating: node.valueRating,
    owner: node.owner,
    sortOrder: node.sortOrder,
    createdDate: node.createdDate,
    lastModifiedDate: node.lastModifiedDate,
    links: node.links.map(l => ({ ...l })),
    questions: node.questions.map(q => ({ ...q })),
  };
}

/** The tree as the store reads it: every node of `doc`, with its key and its parent's key. */
export function readTree(doc: OstDocument): TreeNodeDTO[] {
  const types = new Map(doc.nodes.map(n => [n.id, n.type]));
  return doc.nodes.map(n => toDto(n, n.parentId === null ? undefined : types.get(n.parentId)));
}

export default class LocalDocumentService {
  private doc: OstDocument | null = null;
  private readonly nodeIds = new IdAllocator(() => (this.doc?.nodes ?? []).map(n => n.id));
  private readonly linkIds = new IdAllocator(() => (this.doc?.nodes ?? []).flatMap(n => n.links.map(l => l.id)));
  private readonly questionIds = new IdAllocator(() => (this.doc?.nodes ?? []).flatMap(n => n.questions.map(q => q.id)));
  /** Running total of `nodeWeight` over the document (see MAX_NODES_WEIGHT). */
  private weight = 0;
  private listener: () => void = () => {};
  private readonly history = new DocumentHistory();
  /** What the write in progress is, for the history; set by the write itself. */
  private change: Change | null = null;

  // ---- document lifecycle ------------------------------------------------------------------------

  /** Called after every change to the open document, an undo or redo included (the document store autosaves). */
  onChange(listener: () => void): void {
    this.listener = listener;
  }

  /** Makes `doc` the working document. The service keeps its own copy. Does not count as a change. */
  open(doc: OstDocument): void {
    this.doc = cloneDocument(doc);
    this.nodeIds.reset();
    this.linkIds.reset();
    this.questionIds.reset();
    this.weight = this.doc.nodes.reduce((sum, n) => sum + nodeWeight(n), 0);
    this.clearHistory();
  }

  close(): void {
    this.doc = null;
    this.clearHistory();
  }

  get isOpen(): boolean {
    return this.doc !== null;
  }

  get name(): string {
    return this.doc?.name ?? '';
  }

  /** A copy of the working document, ready to write to a file or to the autosave store. */
  snapshot(): OstDocument | null {
    return this.doc ? cloneDocument(this.doc) : null;
  }

  /** Renames the document; returns the name actually stored (trimmed, never empty). */
  rename(name: string): string {
    const doc = this.require();
    const next = cleanDocumentName(name);
    if (next !== doc.name) {
      doc.name = next;
      this.record({ verb: 'rename the tree', key: 'name' });
      this.listener();
    }
    return doc.name;
  }

  // ---- history -------------------------------------------------------------------------------------

  /** The step `undo()` would take back, in words; null when there is none. */
  get undoStep(): HistoryStep | null {
    return this.history.undoStep;
  }

  get redoStep(): HistoryStep | null {
    return this.history.redoStep;
  }

  /**
   * Names the state the document is in: the same value for as long as nothing changes, and again
   * whenever an undo or redo comes back to that state. Null when no document is open.
   */
  mark(): object | null {
    return this.history.present;
  }

  /** The next edit is a step of its own (a field was left, the document was saved). */
  sealHistory(): void {
    this.history.seal();
  }

  /** Forgets every step: nothing to undo or redo. The document stays as it is. */
  clearHistory(): void {
    this.history.reset(this.doc ? captureState(this.doc, this.weight) : null);
  }

  /** Takes back the last step. Returns it, or null when there was nothing to undo. */
  undo(): HistoryStep | null {
    return this.restore(this.history.peekUndo(), () => this.history.undo());
  }

  /** Makes the last undone step again. Returns it, or null when there was nothing to redo. */
  redo(): HistoryStep | null {
    return this.restore(this.history.peekRedo(), () => this.history.redo());
  }

  // ---- tree read -----------------------------------------------------------------------------------

  /** Every node of the open document, now. */
  readTree(): TreeNodeDTO[] {
    return readTree(this.require());
  }

  /** Every node of the open document. */
  getTree(): Promise<TreeNodeDTO[]> {
    return this.run(() => this.readTree());
  }

  // ---- nodes ---------------------------------------------------------------------------------------

  createNode(request: CreateNodeRequest): Promise<TreeNodeDTO> {
    return this.write(() => {
      const doc = this.require();
      const type = this.type(request.type);
      const parent = this.parent(type, request.parentType, request.parentId);
      if (parent && this.depth(parent) + 1 > MAX_DEPTH) throw new RuleError('toodeep');
      const parentId = parent?.id ?? null;
      if (doc.nodes.length >= MAX_NODES) throw new RuleError('toomanynodes');
      const title = request.title?.trim() ? this.title(type, request.title) : defaultTitle(type);
      const last = this.siblings(type, parentId).at(-1);
      const now = new Date().toISOString();
      const node: DocNode = {
        id: 0,
        type,
        parentId,
        title,
        notes: '',
        ...newNodeFields(type),
        sortOrder: last ? last.sortOrder + 1 : 0,
        createdDate: now,
        lastModifiedDate: now,
        links: [],
        questions: [],
      };
      this.charge(nodeWeight(node));
      node.id = this.nodeIds.take();
      doc.nodes.push(node);
      // Naming the new node straight away belongs to adding it: one step.
      this.describe('add', node, `title:${node.id}`);
      return this.toDto(node);
    });
  }

  patchNode(type: string, id: number, body: PatchNodeRequest): Promise<TreeNodeDTO> {
    return this.write(() => {
      const node = this.find(this.type(type), id);
      const next: Partial<DocNode> = {};
      for (const field of Object.keys(body) as (keyof PatchNodeRequest)[]) {
        const applies = APPLICABLE[field];
        if (!applies || (applies !== 'all' && !applies.includes(node.type))) throw new RuleError('fieldnotapplicable');
      }
      if (body.title !== undefined) next.title = this.title(node.type, body.title);
      if (body.notes !== undefined) {
        if (body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > NOTES_MAX)) throw new RuleError('invalidnotes');
        next.notes = body.notes ?? '';
      }
      if (body.status !== undefined) {
        const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
        if (!STATUS[node.type].includes(status)) throw new RuleError('invalidstatus');
        next.status = status;
      }
      if (body.confidence !== undefined) {
        if (!isIntIn(body.confidence, 0, 100)) throw new RuleError('invalidconfidence');
        next.confidence = body.confidence;
      }
      if (body.priority !== undefined) {
        if (!isIntIn(body.priority, 1, 100)) throw new RuleError('invalidpriority');
        next.priority = body.priority;
      }
      if (body.valueRating !== undefined) {
        if (!isIntIn(body.valueRating, 1, 5)) throw new RuleError('invalidvaluerating');
        next.valueRating = body.valueRating;
      }
      if (body.owner !== undefined) {
        if (body.owner !== null && (typeof body.owner !== 'string' || body.owner.trim().length > OWNER_MAX)) {
          throw new RuleError('invalidowner');
        }
        next.owner = body.owner?.trim() || null;
      }
      // Every value was checked before anything is applied: a refused patch changes nothing.
      this.charge(nodeWeight({ ...node, ...next }) - nodeWeight(node));
      Object.assign(node, next, { lastModifiedDate: new Date().toISOString() });
      const fields = Object.keys(next) as (keyof PatchNodeRequest)[];
      const one = fields.length === 1 ? FIELD_CHANGE[fields[0]] : null;
      this.describe(one?.verb ?? 'edit', node, one?.text ? `${fields[0]}:${node.id}` : undefined);
      return this.toDto(node);
    });
  }

  /**
   * Moves a node under a new parent, or reorders it among its siblings (`position` is a zero-based
   * index among the same-type children of the target; omitted = last). `parentId: null` is the top
   * level, where only projects live: it reorders the top-level projects, and moves a sub-project
   * out to the top. Both affected sibling groups are renumbered.
   */
  moveNode(request: MoveNodeRequest): Promise<MoveNodeResponse> {
    return this.write(() => {
      const node = this.find(this.type(request.nodeType), request.nodeId);
      const { position } = request;
      if (position !== undefined && (!Number.isInteger(position) || position < 0)) throw new RuleError('invalidposition');
      const parent = this.parent(node.type, request.parentType, request.parentId);
      if (parent) {
        // A project may go under any project except itself and the projects inside it.
        if (parent.id === node.id || this.subtreeIds(node.id).has(parent.id)) throw new RuleError('cycle');
        if (parent.id !== node.parentId && this.depth(parent) + this.height(node.id) > MAX_DEPTH) throw new RuleError('toodeep');
      }
      const newParentId = parent?.id ?? null;
      const oldParentId = node.parentId;
      const reparented = oldParentId !== newParentId;
      node.parentId = newParentId;

      const ordered = this.siblings(node.type, newParentId).filter(n => n.id !== node.id);
      ordered.splice(position === undefined ? ordered.length : Math.min(position, ordered.length), 0, node);
      const groups = [ordered];
      if (reparented) {
        groups.push(this.siblings(node.type, oldParentId));
        node.lastModifiedDate = new Date().toISOString();
      }
      for (const group of groups) group.forEach((n, i) => (n.sortOrder = i));
      this.describe(reparented ? 'move' : 'reorder', node);
      return {
        node: this.toDto(node),
        siblings: groups.flat().map(n => ({ key: nodeKey(n.type, n.id), sortOrder: n.sortOrder })),
      };
    });
  }

  /** Deletes the node and its whole subtree (with their links and open questions). */
  deleteNode(type: string, id: number): Promise<void> {
    return this.write(() => {
      const doc = this.require();
      const node = this.find(this.type(type), id);
      const doomed = this.subtreeIds(node.id);
      doomed.add(node.id);
      this.describe('delete', node);
      doc.nodes = doc.nodes.filter(n => {
        if (!doomed.has(n.id)) return true;
        this.weight -= nodeWeight(n);
        return false;
      });
    });
  }

  // ---- links ---------------------------------------------------------------------------------------

  addLink(type: string, id: number, link: { name: string; url: string }): Promise<NodeLinkDTO> {
    return this.write(() => {
      const node = this.find(this.type(type), id);
      if (node.links.length >= MAX_LINKS_PER_NODE) throw new RuleError('toomanylinks');
      const created = { id: 0, name: this.linkName(link.name), url: this.linkUrl(link.url) };
      this.charge(nodeWeight({ ...node, links: [...node.links, created] }) - nodeWeight(node));
      created.id = this.linkIds.take();
      node.links.push(created);
      this.touch(node);
      this.describe('add a link to', node);
      return { ...created };
    });
  }

  updateLink(linkId: number, patch: { name?: string; url?: string }): Promise<NodeLinkDTO> {
    return this.write(() => {
      const { node, link } = this.findLink(linkId);
      const name = patch.name !== undefined ? this.linkName(patch.name) : link.name;
      const url = patch.url !== undefined ? this.linkUrl(patch.url) : link.url;
      const links = node.links.map(l => (l === link ? { ...l, name, url } : l));
      this.charge(nodeWeight({ ...node, links }) - nodeWeight(node));
      Object.assign(link, { name, url });
      this.touch(node);
      this.describe('edit a link of', node, `link:${link.id}`);
      return { ...link };
    });
  }

  deleteLink(linkId: number): Promise<void> {
    return this.write(() => {
      const { node, link } = this.findLink(linkId);
      const before = nodeWeight(node);
      node.links.splice(node.links.indexOf(link), 1);
      this.weight += nodeWeight(node) - before;
      this.touch(node);
      this.describe('remove a link from', node);
    });
  }

  // ---- open questions (opportunities) ---------------------------------------------------------------

  addQuestion(opportunityId: number, text: string): Promise<OpenQuestionDTO> {
    return this.write(() => {
      const node = this.find('opportunity', opportunityId);
      if (node.questions.length >= MAX_QUESTIONS_PER_NODE) throw new RuleError('toomanyquestions');
      const created = { id: 0, text: this.questionText(text), done: false };
      this.charge(nodeWeight({ ...node, questions: [...node.questions, created] }) - nodeWeight(node));
      created.id = this.questionIds.take();
      node.questions.push(created);
      this.touch(node);
      this.describe('add a question to', node);
      return { ...created };
    });
  }

  updateQuestion(questionId: number, patch: { text?: string; done?: boolean }): Promise<OpenQuestionDTO> {
    return this.write(() => {
      const { node, question } = this.findQuestion(questionId);
      const text = patch.text !== undefined ? this.questionText(patch.text) : question.text;
      const done = patch.done !== undefined ? patch.done === true : question.done;
      const questions = node.questions.map(q => (q === question ? { ...q, text, done } : q));
      this.charge(nodeWeight({ ...node, questions }) - nodeWeight(node));
      Object.assign(question, { text, done });
      this.touch(node);
      // Ticking a question is a step of its own; typing its text is one step.
      this.describe('edit a question of', node, patch.done === undefined ? `question:${question.id}` : undefined);
      return { ...question };
    });
  }

  deleteQuestion(questionId: number): Promise<void> {
    return this.write(() => {
      const { node, question } = this.findQuestion(questionId);
      const before = nodeWeight(node);
      node.questions.splice(node.questions.indexOf(question), 1);
      this.weight += nodeWeight(node) - before;
      this.touch(node);
      this.describe('remove a question from', node);
    });
  }

  // ---- internals -----------------------------------------------------------------------------------

  /** Runs a read; a thrown rule violation becomes a rejected promise, like a refused request. */
  private run<T>(action: () => T): Promise<T> {
    try {
      return Promise.resolve(action());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Runs a change, records it as a step and reports it. A refused change is neither recorded nor reported. */
  private write<T>(action: () => T): Promise<T> {
    return this.run(() => {
      this.change = null;
      const result = action();
      this.record(this.change ?? { verb: 'edit' });
      this.listener();
      return result;
    });
  }

  /** Says what the write in progress is: "<verb> “<the node's title>”". */
  private describe(verb: string, node: DocNode, key?: string): void {
    this.change = { verb, title: node.title, nodeKey: nodeKey(node.type, node.id), key };
  }

  private record(change: Change): void {
    const takenBack = this.history.record(captureState(this.require(), this.weight, this.history.present), change);
    if (!takenBack) return;
    // The edit undid its own step (Escape in a field): the document is again exactly what it was
    // before the typing began, last-modified date included, so it also reads as saved if it was.
    try {
      this.put(takenBack);
    } catch {
      this.clearHistory();
    }
  }

  /** Makes `state` the working document, by way of the check a file goes through on open. */
  private put(state: DocState): void {
    const doc = this.require();
    this.doc = validateDocument({ format: doc.format, version: doc.version, name: state.name, nodes: state.nodes });
    this.weight = state.weight;
  }

  /**
   * Puts an earlier state in place of the document, by way of the check a file goes through on
   * open; `step` then moves the history. A state that does not pass (which would be a bug) is
   * refused: the document and the history stay as they are.
   */
  private restore(state: DocState | null, step: () => HistoryStep | null): HistoryStep | null {
    this.require();
    if (!state) return null;
    try {
      this.put(state);
    } catch {
      throw new RuleError('historybroken');
    }
    const taken = step();
    this.listener();
    return taken;
  }

  private require(): OstDocument {
    if (!this.doc) throw new RuleError('nodocument');
    return this.doc;
  }

  private type(value: string): NodeType {
    try {
      return toNodeType(String(value));
    } catch {
      throw new RuleError('unknowntype');
    }
  }

  private find(type: NodeType, id: number, missing: 'nodemissing' | 'parentmissing' = 'nodemissing'): DocNode {
    const node = this.require().nodes.find(n => n.id === id && n.type === type);
    if (!node) throw new RuleError(missing);
    return node;
  }

  /**
   * The parent a node of `type` is asked to go under, checked against the allowed parent -> child
   * matrix. Null is the top level, where only a project may be.
   */
  private parent(type: NodeType, parentType: ApiNodeType | null, parentId: number | null): DocNode | null {
    if (parentType === null && parentId === null) {
      if (type !== 'project') throw new RuleError('parentmissing');
      return null;
    }
    if (parentType === null || parentId === null) throw new RuleError(type === 'project' ? 'invalidparent' : 'parentmissing');
    const parent = this.find(this.type(parentType), parentId, 'parentmissing');
    if (!ALLOWED[parent.type].includes(type)) throw new RuleError('invalidparent');
    return parent;
  }

  private findLink(linkId: number) {
    for (const node of this.require().nodes) {
      const link = node.links.find(l => l.id === linkId);
      if (link) return { node, link };
    }
    throw new RuleError('linkmissing');
  }

  private findQuestion(questionId: number) {
    for (const node of this.require().nodes) {
      const question = node.questions.find(q => q.id === questionId);
      if (question) return { node, question };
    }
    throw new RuleError('questionmissing');
  }

  /** Same-type children of one parent (`null`: the top-level projects), in order. */
  private siblings(type: NodeType, parentId: number | null): DocNode[] {
    return this.require()
      .nodes.filter(n => n.type === type && n.parentId === parentId)
      .sort(bySortOrder);
  }

  /** Ids of every node below `id` (not including it). */
  private subtreeIds(id: number): Set<number> {
    const kids = new Map<number, number[]>();
    for (const n of this.require().nodes) {
      if (n.parentId === null) continue;
      const bucket = kids.get(n.parentId);
      if (bucket) bucket.push(n.id);
      else kids.set(n.parentId, [n.id]);
    }
    const out = new Set<number>();
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (out.has(next)) continue;
      out.add(next);
      stack.push(...(kids.get(next) ?? []));
    }
    return out;
  }

  private touch(node: DocNode): void {
    node.lastModifiedDate = new Date().toISOString();
  }

  private title(type: NodeType, value: unknown): string {
    const title = typeof value === 'string' ? value.trim() : '';
    if (title.length < TITLE_MIN || title.length > titleMax(type)) throw new RuleError('invalidtitle');
    return title;
  }

  private linkName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > LINK_NAME_MAX) throw new RuleError('linknameinvalid');
    return name;
  }

  private linkUrl(value: unknown): string {
    const url = typeof value === 'string' ? value.trim() : '';
    if (url.length > LINK_URL_MAX || !isSafeLinkUrl(url)) throw new RuleError('linkurlinvalid');
    return url;
  }

  private questionText(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > QUESTION_TEXT_MAX) throw new RuleError('questiontextinvalid');
    return text;
  }

  /** Levels from the top-level project down to `node`, both included (a top-level project is 1). */
  private depth(node: DocNode): number {
    const byId = new Map(this.require().nodes.map(n => [n.id, n]));
    let depth = 1;
    let current = node;
    // The bound only matters for a document that is already broken: never loop.
    while (current.parentId !== null && depth <= MAX_DEPTH) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
      depth++;
    }
    return depth;
  }

  /** Levels in the subtree of `id`, itself included (a leaf is 1). */
  private height(id: number): number {
    const kids = new Map<number, number[]>();
    for (const n of this.require().nodes) {
      if (n.parentId === null) continue;
      const bucket = kids.get(n.parentId);
      if (bucket) bucket.push(n.id);
      else kids.set(n.parentId, [n.id]);
    }
    let height = 0;
    let level = [id];
    while (level.length && height <= MAX_DEPTH) {
      height++;
      level = level.flatMap(parent => kids.get(parent) ?? []);
    }
    return height;
  }

  /** Counts `delta` more bytes of text against the size of one file; refuses growth past it. */
  private charge(delta: number): void {
    if (delta > 0 && this.weight + delta > MAX_NODES_WEIGHT) throw new RuleError('documenttoolarge');
    this.weight += delta;
  }

  private toDto(node: DocNode): TreeNodeDTO {
    const parentType = node.parentId === null ? undefined : this.require().nodes.find(n => n.id === node.parentId)?.type;
    return toDto(node, parentType);
  }
}
