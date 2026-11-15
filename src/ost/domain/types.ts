/*
 * OST domain types.
 *
 * - `id` is the node key ("opportunity-12"); `dbId` carries the numeric id stored in the file.
 * - links and questions carry their ids so they can be edited and removed.
 */
export type NodeType = 'project' | 'outcome' | 'opportunity' | 'solution' | 'assumption' | 'evidence';

export const NODE_TYPES: NodeType[] = ['project', 'outcome', 'opportunity', 'solution', 'assumption', 'evidence'];

export interface LinkRef {
  id?: number;
  name: string;
  url: string;
}

export interface Question {
  id?: number;
  text: string;
  done: boolean;
}

export interface OstNode {
  /** Node key, e.g. "opportunity-12". Used as the Vue Flow node id. */
  id: string;
  /** Numeric id of the node in the document (unique across the whole file). */
  dbId: number;
  type: NodeType;
  /** Parent node key; null for a top-level project. */
  parent: string | null;
  title: string;
  note: string;
  /** assumption + solution + opportunity only; see STATUS in rules.ts. '' otherwise. */
  status: string;
  /** assumptions only, 0-100 */
  conf: number;
  /** opportunities only, 1-100 continuous */
  priority: number;
  /** opportunities only, 1-5 */
  value: number;
  /** assumptions only: free-text owner ('' when unassigned) */
  owner: string;
  sortOrder: number;
  createdDate: string | null;
  lastModifiedDate: string | null;
  links: LinkRef[];
  questions: Question[];
}
