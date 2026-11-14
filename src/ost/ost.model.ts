/**
 * Wire types of the tree service seam (see `@/doc/local-document-service`). They mirror the DTOs
 * the tree store has always consumed: upper-case enums, numeric ids, and a node key
 * ("opportunity-12") that names a node everywhere in the UI.
 */

export type ApiNodeType = 'PRODUCT' | 'OUTCOME' | 'OPPORTUNITY' | 'SOLUTION' | 'ASSUMPTION' | 'EVIDENCE';

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
  archived: boolean | null;
  createdDate: string | null;
  lastModifiedDate: string | null;
  links: NodeLinkDTO[] | null;
  questions: OpenQuestionDTO[] | null;
}

/** `parentType` / `parentId` are null only for a product (the top of a branch). */
export interface CreateNodeRequest {
  type: ApiNodeType;
  parentType: ApiNodeType | null;
  parentId: number | null;
  title?: string;
}

/** PATCH body: absent = unchanged; null clears notes / owner. */
export interface PatchNodeRequest {
  title?: string;
  notes?: string | null;
  status?: string;
  confidence?: number;
  priority?: number;
  valueRating?: number;
  owner?: string | null;
  archived?: boolean;
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
