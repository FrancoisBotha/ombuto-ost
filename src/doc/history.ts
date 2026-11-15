/*
 * Undo and redo for the open document: a bounded stack of whole document states.
 *
 * A state is the document as the local document service held it after an edit. States share what
 * did not change: a node (and its list of links and of open questions) that an edit left alone is
 * the same object in the state before and after, so a step costs the nodes it touched plus one
 * array of references — not a copy of the tree.
 *
 * The bound is a count: HISTORY_LIMIT steps. One step holds at most the text of one edit (a
 * 20,000-character note is about 40 KB) and, for a move that renumbers a very long row of
 * siblings, the small shells of those nodes; a full history of a 1,000-node tree stays in the low
 * megabytes. The oldest step is dropped when the limit is passed.
 *
 * Typing is one step: consecutive edits that carry the same `key` (one text field of one node)
 * fold into the step the first of them made, until the field is left (`seal`), a pause of
 * COALESCE_PAUSE_MS, an edit of anything else, or an undo / redo.
 *
 * History lives in memory, for this tab, until another document is opened or the page goes away.
 * It is never written to the `.ost` file or to the autosaved working copy.
 */
import type { DocLink, DocNode, DocQuestion, OstDocument } from './document';

/** How many steps can be undone. */
export const HISTORY_LIMIT = 100;

/** Edits of one field further apart than this are separate steps. */
export const COALESCE_PAUSE_MS = 5000;

/** Titles in a step's label are cut to this many characters. */
const LABEL_TITLE_MAX = 40;

/** One document state. Never changed once captured. */
export interface DocState {
  readonly name: string;
  readonly nodes: readonly DocNode[];
  /** The service's running `nodeWeight` total for this state. */
  readonly weight: number;
}

/** What an edit was, as the service reports it. */
export interface Change {
  /** "delete", "rename", "edit notes of", … — reads after "Undo" and before the title. */
  verb: string;
  /** Title of the node the edit was about (none: the edit was about the tree itself). */
  title?: string;
  /** Key of that node, so the screen can tell whether the edit was somewhere in view. */
  nodeKey?: string | null;
  /** Edits with the same key, made in one go, are one step (see the header). */
  key?: string;
}

/** A step that can be undone or redone, in words. */
export interface HistoryStep {
  /** e.g. `delete “Weekly planner”`. */
  label: string;
  nodeKey: string | null;
}

interface Entry {
  /** Undo stack: the state before the step. Redo stack: the state after it. */
  state: DocState;
  verb: string;
  title: string | undefined;
  nodeKey: string | null;
  key: string | undefined;
  /** When the step's last edit was made. */
  at: number;
}

const sameLinks = (a: readonly DocLink[], b: readonly DocLink[]): boolean =>
  a.length === b.length && a.every((l, i) => l.id === b[i].id && l.name === b[i].name && l.url === b[i].url);

const sameQuestions = (a: readonly DocQuestion[], b: readonly DocQuestion[]): boolean =>
  a.length === b.length && a.every((q, i) => q.id === b[i].id && q.text === b[i].text && q.done === b[i].done);

/** Do two nodes hold the same values? `dates: false` leaves the last-modified date out of it. */
function sameNode(a: DocNode, b: DocNode, dates = true): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.parentId === b.parentId &&
    a.title === b.title &&
    a.notes === b.notes &&
    a.status === b.status &&
    a.confidence === b.confidence &&
    a.priority === b.priority &&
    a.valueRating === b.valueRating &&
    a.owner === b.owner &&
    a.color === b.color &&
    a.sortOrder === b.sortOrder &&
    a.createdDate === b.createdDate &&
    (!dates || a.lastModifiedDate === b.lastModifiedDate) &&
    sameLinks(a.links, b.links) &&
    sameQuestions(a.questions, b.questions)
  );
}

/**
 * The document as a state. Whatever is unchanged since `previous` is taken from it rather than
 * copied; the rest is copied, so later edits to `doc` never reach a captured state.
 */
export function captureState(doc: OstDocument, weight: number, previous: DocState | null = null): DocState {
  const known = new Map<number, DocNode>();
  for (const n of previous?.nodes ?? []) known.set(n.id, n);
  const nodes = doc.nodes.map(node => {
    const old = known.get(node.id);
    if (old && sameNode(old, node)) return old;
    return Object.freeze({
      ...node,
      links: old && sameLinks(old.links, node.links) ? old.links : Object.freeze(node.links.map(l => Object.freeze({ ...l }))),
      questions:
        old && sameQuestions(old.questions, node.questions)
          ? old.questions
          : Object.freeze(node.questions.map(q => Object.freeze({ ...q }))),
    }) as DocNode;
  });
  return Object.freeze({ name: doc.name, nodes: Object.freeze(nodes), weight });
}

/** The same nodes in the same order, and the same name: nothing an undo could put back. */
const unchanged = (a: DocState, b: DocState): boolean =>
  a.name === b.name && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n === b.nodes[i]);

/** As `unchanged`, by value and leaving the last-modified dates out: an edit that was taken back. */
const sameContent = (a: DocState, b: DocState): boolean =>
  a.name === b.name && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n === b.nodes[i] || sameNode(n, b.nodes[i], false));

function label(entry: Pick<Entry, 'verb' | 'title'>): string {
  if (entry.title === undefined) return entry.verb;
  const title = entry.title.length > LABEL_TITLE_MAX ? `${entry.title.slice(0, LABEL_TITLE_MAX - 1).trimEnd()}…` : entry.title;
  return `${entry.verb} “${title}”`;
}

const stepOf = (entry: Entry | undefined): HistoryStep | null => (entry ? { label: label(entry), nodeKey: entry.nodeKey } : null);

export class DocumentHistory {
  private current: DocState | null = null;
  private past: Entry[] = [];
  private future: Entry[] = [];
  /** The step on top of the undo stack takes no more edits. */
  private sealed = true;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Starts afresh from `state` (another document, or no document): nothing to undo or redo. */
  reset(state: DocState | null): void {
    this.current = state;
    this.past = [];
    this.future = [];
    this.sealed = true;
  }

  /** The state the document is in. The same object for as long as the document does not change. */
  get present(): DocState | null {
    return this.current;
  }

  get undoStep(): HistoryStep | null {
    return stepOf(this.past.at(-1));
  }

  get redoStep(): HistoryStep | null {
    return stepOf(this.future.at(-1));
  }

  /** How many steps can be undone. */
  get length(): number {
    return this.past.length;
  }

  /**
   * The document changed to `state`. A new step, unless the edit continues the one on top of the
   * stack (see the header), or changed nothing. Whatever could be redone is gone.
   *
   * Returns a state only when the edit took back what its step had typed (Escape in a field puts
   * the old text back): the step is dropped, and the returned state — the document exactly as it
   * was before the step, dates included — is the present one. The caller must put it in place.
   */
  record(state: DocState, change: Change): DocState | null {
    const before = this.current;
    if (!before || unchanged(before, state)) return null;
    const at = this.now();
    const top = this.past.at(-1);
    this.future = [];
    if (!this.sealed && top && change.key !== undefined && top.key === change.key && at - top.at <= COALESCE_PAUSE_MS) {
      if (sameContent(top.state, state)) {
        this.past.pop();
        this.sealed = true;
        this.current = top.state;
        return top.state;
      }
      this.current = state;
      top.at = at;
      top.title = change.title;
      return null;
    }
    this.current = state;
    this.past.push({ state: before, verb: change.verb, title: change.title, nodeKey: change.nodeKey ?? null, key: change.key, at });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.sealed = false;
    return null;
  }

  /** The next edit starts a new step, whatever it is (the field was left, the document was saved). */
  seal(): void {
    this.sealed = true;
  }

  /** The state an undo would go back to. */
  peekUndo(): DocState | null {
    return this.past.at(-1)?.state ?? null;
  }

  /** The state a redo would go forward to. */
  peekRedo(): DocState | null {
    return this.future.at(-1)?.state ?? null;
  }

  /** Steps back; the caller has already put `peekUndo()` in place of the document. */
  undo(): HistoryStep | null {
    return this.travel(this.past, this.future);
  }

  /** Steps forward; the caller has already put `peekRedo()` in place of the document. */
  redo(): HistoryStep | null {
    return this.travel(this.future, this.past);
  }

  private travel(from: Entry[], to: Entry[]): HistoryStep | null {
    const entry = from.pop();
    if (!entry || !this.current) return null;
    to.push({ ...entry, state: this.current });
    this.current = entry.state;
    this.sealed = true;
    return stepOf(entry);
  }
}
