/**
 * Core types for Stratuu Brain.
 */

export type ProjectId = string;
export type PageId = string;

export interface Project {
  id: ProjectId;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  client_op_id: string;
  revision: number;
  synced_at: number | null; // unix ms; null = local-only / pending sync
  deleted_at: number | null; // unix ms; null = not deleted (soft delete)
  created_at: number; // unix ms
  updated_at: number; // unix ms
}

export interface Page {
  id: PageId;
  project_id: ProjectId;
  parent_page_id: PageId | null;
  title: string;
  icon: string | null;
  /**
   * BlockNote-compatible JSON document. Stored as TEXT in SQLite, parsed at the
   * application layer. Empty document is represented as `[]`.
   */
  content: BlockNoteDocument;
  position: number;
  client_op_id: string;
  revision: number;
  synced_at: number | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * BlockNote stores documents as an array of blocks. We model it loosely so we
 * don't pin the wire format too tightly; the BlockNote frontend is the
 * canonical source of structure. We only care about the `type` and `props` for
 * `find_blocks` queries.
 */
export type BlockNoteDocument = Block[];

export interface Block {
  id: string;
  type: string; // "paragraph", "heading", "checkList", "code", etc.
  content?: unknown;
  props?: Record<string, unknown>;
  children?: Block[];
}

// Input shapes (what callers pass when creating/updating)

export interface CreateProjectInput {
  name: string;
  description?: string;
  icon?: string;
  client_op_id?: string;
}

export interface UpdateProjectInput {
  id: ProjectId;
  name?: string;
  description?: string | null;
  icon?: string | null;
  position?: number;
  client_op_id?: string;
}

export interface CreatePageInput {
  project_id: ProjectId;
  title: string;
  parent_page_id?: PageId;
  icon?: string;
  content?: BlockNoteDocument;
  client_op_id?: string;
}

export interface UpdatePageInput {
  id: PageId;
  title?: string;
  icon?: string | null;
  content?: BlockNoteDocument;
  parent_page_id?: PageId | null;
  position?: number;
  client_op_id?: string;
}

export interface SearchPagesInput {
  query: string;
  project_id?: ProjectId;
  limit?: number;
}

export interface SearchPagesHit {
  page: Page;
  snippet: string; // FTS5 snippet of the matching content
}

export interface FindBlocksInput {
  type: string; // ex: "checkList"
  project_id?: ProjectId;
  /**
   * Optional shallow filter on block.props. Each key/value must match.
   * Example: { checked: false } returns unchecked task blocks.
   */
  filter?: Record<string, unknown>;
  limit?: number;
}

export interface FindBlocksHit {
  page_id: PageId;
  project_id: ProjectId;
  block: Block;
}
