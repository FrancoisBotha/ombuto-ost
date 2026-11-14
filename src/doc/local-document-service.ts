/*
 * The local document service: the seam the tree store talks to. It has the method names and
 * promise-returning signatures of a remote tree API, but every call reads or changes an in-memory
 * `.ost` document — nothing leaves the device.
 *
 * The rules a server would enforce live here: id allocation, `sortOrder` on create (append) and on
 * move (both sibling groups are renumbered 0..n-1), the allowed parent -> child matrix, no moves
 * under a descendant, cascade delete of a subtree, and the limits on every field. A refused write
 * rejects with a RuleError; the document is left untouched.
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
  NOTES_MAX,
  OWNER_MAX,
  type OstDocument,
  QUESTION_TEXT_MAX,
  cleanDocumentName,
  cloneDocument,
  defaultTitle,
  newNodeFields,
} from './document';

/** Which node types each patchable field applies to. */
const APPLICABLE: Record<keyof PatchNodeRequest, NodeType[] | 'all'> = {
  title: 'all',
  notes: 'all',
  status: ['opportunity', 'solution', 'assumption'],
  confidence: ['assumption'],
  priority: ['opportunity'],
  valueRating: ['opportunity'],
  owner: ['assumption'],
  archived: ['product'],
};

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const bySortOrder = (a: DocNode, b: DocNode) => a.sortOrder - b.sortOrder || a.id - b.id;

export default class LocalDocumentService {
  private doc: OstDocument | null = null;
  private nextNodeId = 1;
  private nextLinkId = 1;
  private nextQuestionId = 1;
  private listener: () => void = () => {};

  // ---- document lifecycle ------------------------------------------------------------------------

  /** Called after every change to the open document (the document store marks it dirty and autosaves). */
  onChange(listener: () => void): void {
    this.listener = listener;
  }

  /** Makes `doc` the working document. The service keeps its own copy. Does not count as a change. */
  open(doc: OstDocument): void {
    this.doc = cloneDocument(doc);
    const max = (ids: number[]) => ids.reduce((a, b) => Math.max(a, b), 0);
    this.nextNodeId = max(this.doc.nodes.map(n => n.id)) + 1;
    this.nextLinkId = max(this.doc.nodes.flatMap(n => n.links.map(l => l.id))) + 1;
    this.nextQuestionId = max(this.doc.nodes.flatMap(n => n.questions.map(q => q.id))) + 1;
  }

  close(): void {
    this.doc = null;
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
      this.listener();
    }
    return doc.name;
  }

  // ---- tree read -----------------------------------------------------------------------------------

  /** Every node of the open document. */
  getTree(): Promise<TreeNodeDTO[]> {
    return this.run(() => {
      const doc = this.require();
      const types = new Map(doc.nodes.map(n => [n.id, n.type]));
      return doc.nodes.map(n => this.toDto(n, types));
    });
  }

  // ---- nodes ---------------------------------------------------------------------------------------

  createNode(request: CreateNodeRequest): Promise<TreeNodeDTO> {
    return this.write(() => {
      const doc = this.require();
      const type = this.type(request.type);
      let parentId: number | null = null;
      if (type === 'product') {
        if (request.parentId !== null || request.parentType !== null) throw new RuleError('invalidparent');
      } else {
        if (request.parentType === null || request.parentId === null) throw new RuleError('parentmissing');
        const parent = this.find(this.type(request.parentType), request.parentId, 'parentmissing');
        if (!ALLOWED[parent.type].includes(type)) throw new RuleError('invalidparent');
        parentId = parent.id;
      }
      const title = request.title?.trim() ? this.title(type, request.title) : defaultTitle(type);
      const last = this.siblings(type, parentId).at(-1);
      const now = new Date().toISOString();
      const node: DocNode = {
        id: this.nextNodeId++,
        type,
        parentId,
        title,
        notes: '',
        ...newNodeFields(type),
        sortOrder: last ? last.sortOrder + 1 : 0,
        archived: false,
        createdDate: now,
        lastModifiedDate: now,
        links: [],
        questions: [],
      };
      doc.nodes.push(node);
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
      if (body.archived !== undefined) next.archived = body.archived === true;
      // Every value was checked before anything is applied: a refused patch changes nothing.
      Object.assign(node, next, { lastModifiedDate: new Date().toISOString() });
      return this.toDto(node);
    });
  }

  /**
   * Moves a node under a new parent, or reorders it among its siblings (`position` is a zero-based
   * index among the same-type children of the target; omitted = last). Products have no parent:
   * `parentId: null` reorders them. Both affected sibling groups are renumbered.
   */
  moveNode(request: MoveNodeRequest): Promise<MoveNodeResponse> {
    return this.write(() => {
      const node = this.find(this.type(request.nodeType), request.nodeId);
      const { position } = request;
      if (position !== undefined && (!Number.isInteger(position) || position < 0)) throw new RuleError('invalidposition');
      let newParentId: number | null = null;
      if (node.type === 'product') {
        if (request.parentId !== null || request.parentType !== null) throw new RuleError('invalidparent');
      } else {
        if (request.parentType === null || request.parentId === null) throw new RuleError('parentmissing');
        const parent = this.find(this.type(request.parentType), request.parentId, 'parentmissing');
        if (!ALLOWED[parent.type].includes(node.type)) throw new RuleError('invalidparent');
        if (parent.id === node.id || this.subtreeIds(node.id).has(parent.id)) throw new RuleError('cycle');
        newParentId = parent.id;
      }
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
      doc.nodes = doc.nodes.filter(n => !doomed.has(n.id));
    });
  }

  // ---- links ---------------------------------------------------------------------------------------

  addLink(type: string, id: number, link: { name: string; url: string }): Promise<NodeLinkDTO> {
    return this.write(() => {
      const node = this.find(this.type(type), id);
      const created = { id: this.nextLinkId++, name: this.linkName(link.name), url: this.linkUrl(link.url) };
      node.links.push(created);
      this.touch(node);
      return { ...created };
    });
  }

  updateLink(linkId: number, patch: { name?: string; url?: string }): Promise<NodeLinkDTO> {
    return this.write(() => {
      const { node, link } = this.findLink(linkId);
      const name = patch.name !== undefined ? this.linkName(patch.name) : link.name;
      const url = patch.url !== undefined ? this.linkUrl(patch.url) : link.url;
      Object.assign(link, { name, url });
      this.touch(node);
      return { ...link };
    });
  }

  deleteLink(linkId: number): Promise<void> {
    return this.write(() => {
      const { node, link } = this.findLink(linkId);
      node.links.splice(node.links.indexOf(link), 1);
      this.touch(node);
    });
  }

  // ---- open questions (opportunities) ---------------------------------------------------------------

  addQuestion(opportunityId: number, text: string): Promise<OpenQuestionDTO> {
    return this.write(() => {
      const node = this.find('opportunity', opportunityId);
      const created = { id: this.nextQuestionId++, text: this.questionText(text), done: false };
      node.questions.push(created);
      this.touch(node);
      return { ...created };
    });
  }

  updateQuestion(questionId: number, patch: { text?: string; done?: boolean }): Promise<OpenQuestionDTO> {
    return this.write(() => {
      const { node, question } = this.findQuestion(questionId);
      const text = patch.text !== undefined ? this.questionText(patch.text) : question.text;
      const done = patch.done !== undefined ? patch.done === true : question.done;
      Object.assign(question, { text, done });
      this.touch(node);
      return { ...question };
    });
  }

  deleteQuestion(questionId: number): Promise<void> {
    return this.write(() => {
      const { node, question } = this.findQuestion(questionId);
      node.questions.splice(node.questions.indexOf(question), 1);
      this.touch(node);
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

  /** Runs a change and reports it. Nothing is reported when the change was refused. */
  private write<T>(action: () => T): Promise<T> {
    return this.run(() => {
      const result = action();
      this.listener();
      return result;
    });
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

  /** Same-type children of one parent (products: every product), in order. */
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

  /** `types` (node id -> type) saves a lookup per node when a whole tree is converted. */
  private toDto(node: DocNode, types?: Map<number, NodeType>): TreeNodeDTO {
    const parentType =
      node.parentId === null ? undefined : (types?.get(node.parentId) ?? this.require().nodes.find(n => n.id === node.parentId)?.type);
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
      archived: node.archived,
      createdDate: node.createdDate,
      lastModifiedDate: node.lastModifiedDate,
      links: node.links.map(l => ({ ...l })),
      questions: node.questions.map(q => ({ ...q })),
    };
  }
}
