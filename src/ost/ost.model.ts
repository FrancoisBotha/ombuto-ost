/**
 * The shapes the local document service (`@/doc/local-document-service`) hands to the tree store
 * and takes from it: upper-case type and status names, the numeric ids stored in the file, and a
 * node key ("opportunity-12") that names a node everywhere in the UI.
 */

export type ApiNodeType = 'PROJECT' | 'OUTCOME' | 'OPPORTUNITY' | 'SOLUTION' | 'ASSUMPTION' | 'EVIDENCE';

export interface NodeLinkDTO {
  id: number;
  name: string;
  url: string;
}

export interface OpenQuestionDTO {
  id: number;
  text: string;
  done: boolean;
}

export interface TreeNodeDTO {
  key: string;
  type: ApiNodeType;
  id: number;
  parentKey: string | null;
  title: string;
  notes: string | null;
  status: string | null;
  confidence: number | null;
  priority: number | null;
  valueRating: number | null;
  owner: string | null;
  sortOrder: number | null;
  createdDate: string | null;
  lastModifiedDate: string | null;
  links: NodeLinkDTO[] | null;
  questions: OpenQuestionDTO[] | null;
}

/** `parentType` / `parentId` are null only for a project (the top of a branch). */
export interface CreateNodeRequest {
  type: ApiNodeType;
  parentType: ApiNodeType | null;
  parentId: number | null;
  title?: string;
}

/** A change to a node's fields: absent = unchanged; null clears notes / owner. */
export interface PatchNodeRequest {
  title?: string;
  notes?: string | null;
  status?: string;
  confidence?: number;
  priority?: number;
  valueRating?: number;
  owner?: string | null;
}

export interface MoveNodeRequest {
  nodeType: ApiNodeType;
  nodeId: number;
  parentType: ApiNodeType | null;
  parentId: number | null;
  position?: number;
}

export interface MoveNodeResponse {
  node: TreeNodeDTO;
  siblings: { key: string; sortOrder: number }[];
}
