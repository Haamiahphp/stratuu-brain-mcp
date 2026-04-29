import type { Database } from "bun:sqlite";
import type {
  CreatePageInput,
  FindBlocksHit,
  FindBlocksInput,
  Page,
  PageId,
  ProjectId,
  SearchPagesHit,
  SearchPagesInput,
  UpdatePageInput,
} from "../types";
import {
  blocksToPlainText,
  matchesBlockFilter,
  newId,
  nowMs,
  parseDoc,
  walkBlocks,
} from "./util";

interface PageRow {
  id: string;
  project_id: string;
  parent_page_id: string | null;
  title: string;
  icon: string | null;
  content: string; // JSON
  position: number;
  client_op_id: string;
  revision: number;
  synced_at: number | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowToPage(row: PageRow): Page {
  return {
    ...row,
    content: parseDoc(row.content),
  };
}

export class PagesRepo {
  constructor(private db: Database) {}

  create(input: CreatePageInput): Page {
    const now = nowMs();
    const id = newId();
    const client_op_id = input.client_op_id ?? newId();
    const content = input.content ?? [];
    const contentJson = JSON.stringify(content);

    // Position: append at end of siblings (same parent).
    const max = this.db
      .query(
        `SELECT COALESCE(MAX(position), -1) as p FROM pages
         WHERE project_id = $project_id
           AND ((parent_page_id IS NULL AND $parent IS NULL)
             OR parent_page_id = $parent)
           AND deleted_at IS NULL`
      )
      .get({
        project_id: input.project_id,
        parent: input.parent_page_id ?? null,
      }) as { p: number };

    const page: Page = {
      id,
      project_id: input.project_id,
      parent_page_id: input.parent_page_id ?? null,
      title: input.title,
      icon: input.icon ?? null,
      content,
      position: max.p + 1,
      client_op_id,
      revision: 1,
      synced_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO pages
             (id, project_id, parent_page_id, title, icon, content, position,
              client_op_id, revision, synced_at, deleted_at,
              created_at, updated_at)
           VALUES
             ($id, $project_id, $parent_page_id, $title, $icon, $content, $position,
              $client_op_id, $revision, $synced_at, $deleted_at,
              $created_at, $updated_at)`
        )
        .run({
          id: page.id,
          project_id: page.project_id,
          parent_page_id: page.parent_page_id,
          title: page.title,
          icon: page.icon,
          content: contentJson,
          position: page.position,
          client_op_id: page.client_op_id,
          revision: page.revision,
          synced_at: page.synced_at,
          deleted_at: page.deleted_at,
          created_at: page.created_at,
          updated_at: page.updated_at,
        });

      this.upsertFts(page.id, page.project_id, page.title, blocksToPlainText(content));
    })();

    return page;
  }

  list(project_id: ProjectId, parent_page_id: PageId | null = null): Page[] {
    const rows = this.db
      .query(
        `SELECT * FROM pages
         WHERE project_id = $project_id
           AND ((parent_page_id IS NULL AND $parent IS NULL)
             OR parent_page_id = $parent)
           AND deleted_at IS NULL
         ORDER BY position ASC, created_at ASC`
      )
      .all({ project_id, parent: parent_page_id }) as PageRow[];
    return rows.map(rowToPage);
  }

  get(id: PageId): Page | null {
    const row = this.db
      .query("SELECT * FROM pages WHERE id = $id AND deleted_at IS NULL")
      .get({ id }) as PageRow | null;
    return row ? rowToPage(row) : null;
  }

  update(input: UpdatePageInput): Page {
    const existing = this.get(input.id);
    if (!existing) {
      throw new Error(`Page not found: ${input.id}`);
    }

    const now = nowMs();
    const updated: Page = {
      ...existing,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.icon !== undefined && { icon: input.icon }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.parent_page_id !== undefined && { parent_page_id: input.parent_page_id }),
      ...(input.position !== undefined && { position: input.position }),
      revision: existing.revision + 1,
      synced_at: null,
      updated_at: now,
      ...(input.client_op_id !== undefined && { client_op_id: input.client_op_id }),
    };

    const contentJson = JSON.stringify(updated.content);

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE pages SET
             title = $title,
             icon = $icon,
             content = $content,
             parent_page_id = $parent_page_id,
             position = $position,
             client_op_id = $client_op_id,
             revision = $revision,
             synced_at = $synced_at,
             updated_at = $updated_at
           WHERE id = $id`
        )
        .run({
          id: updated.id,
          title: updated.title,
          icon: updated.icon,
          content: contentJson,
          parent_page_id: updated.parent_page_id,
          position: updated.position,
          client_op_id: updated.client_op_id,
          revision: updated.revision,
          synced_at: updated.synced_at,
          updated_at: updated.updated_at,
        });

      this.upsertFts(
        updated.id,
        updated.project_id,
        updated.title,
        blocksToPlainText(updated.content)
      );
    })();

    return updated;
  }

  remove(id: PageId): void {
    const now = nowMs();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE pages SET deleted_at = $now, updated_at = $now WHERE id = $id")
        .run({ now, id });
      this.db.prepare("DELETE FROM pages_fts WHERE page_id = $id").run({ id });
    })();
  }

  search(input: SearchPagesInput): SearchPagesHit[] {
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));

    // FTS5 MATCH expects a query syntax; we wrap user input as a phrase to
    // avoid surprises (operators like AND/OR in raw user text).
    const ftsQuery = ftsEscape(input.query);

    const rows = this.db
      .query(
        `SELECT pages.*,
                snippet(pages_fts, 3, '<b>', '</b>', '...', 16) AS _snippet
         FROM pages_fts
         JOIN pages ON pages.id = pages_fts.page_id
         WHERE pages_fts MATCH $q
           AND pages.deleted_at IS NULL
           ${input.project_id ? "AND pages.project_id = $project_id" : ""}
         ORDER BY rank
         LIMIT $limit`
      )
      .all({
        q: ftsQuery,
        ...(input.project_id ? { project_id: input.project_id } : {}),
        limit,
      }) as Array<PageRow & { _snippet: string }>;

    return rows.map((row) => {
      const { _snippet, ...rest } = row;
      return {
        page: rowToPage(rest),
        snippet: _snippet,
      };
    });
  }

  findBlocks(input: FindBlocksInput): FindBlocksHit[] {
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));

    // Server-side: scan content of pages in scope, walk blocks, match by type
    // and (optional) flat props filter. Cheap enough for v1; if it gets slow
    // we add a derived block_index table.
    const rows = (input.project_id
      ? this.db
          .query(
            `SELECT id, project_id, content FROM pages
             WHERE project_id = $project_id AND deleted_at IS NULL`
          )
          .all({ project_id: input.project_id })
      : this.db
          .query(`SELECT id, project_id, content FROM pages WHERE deleted_at IS NULL`)
          .all()) as Array<{ id: string; project_id: string; content: string }>;

    const hits: FindBlocksHit[] = [];
    for (const row of rows) {
      const doc = parseDoc(row.content);
      walkBlocks(doc, (block) => {
        if (hits.length >= limit) return;
        if (block.type === input.type && matchesBlockFilter(block, input.filter)) {
          hits.push({
            page_id: row.id,
            project_id: row.project_id,
            block,
          });
        }
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  private upsertFts(pageId: string, projectId: string, title: string, text: string): void {
    this.db.prepare("DELETE FROM pages_fts WHERE page_id = $id").run({ id: pageId });
    this.db
      .prepare(
        `INSERT INTO pages_fts (page_id, project_id, title, text)
         VALUES ($page_id, $project_id, $title, $text)`
      )
      .run({ page_id: pageId, project_id: projectId, title, text });
  }
}

/**
 * Escape a user-supplied search query for FTS5 MATCH. We use the simplest
 * safe form: wrap each whitespace-separated token in double quotes (which
 * makes them literal phrases) and join with a space (= AND).
 */
function ftsEscape(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => `"${tok.replace(/"/g, '""')}"`)
    .join(" ");
}
