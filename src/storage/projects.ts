import type { Database } from "bun:sqlite";
import type {
  CreateProjectInput,
  Project,
  ProjectId,
  UpdateProjectInput,
} from "../types";
import { newId, nowMs } from "./util";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  client_op_id: string;
  revision: number;
  synced_at: number | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return { ...row };
}

export class ProjectsRepo {
  constructor(private db: Database) {}

  create(input: CreateProjectInput): Project {
    const now = nowMs();
    const id = newId();
    const client_op_id = input.client_op_id ?? newId();

    // Position: place at end of current list.
    const max = this.db
      .query("SELECT COALESCE(MAX(position), -1) as p FROM projects WHERE deleted_at IS NULL")
      .get() as { p: number };

    const project: Project = {
      id,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      position: max.p + 1,
      client_op_id,
      revision: 1,
      synced_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO projects
           (id, name, description, icon, position,
            client_op_id, revision, synced_at, deleted_at,
            created_at, updated_at)
         VALUES
           ($id, $name, $description, $icon, $position,
            $client_op_id, $revision, $synced_at, $deleted_at,
            $created_at, $updated_at)`
      )
      // bun:sqlite's strict typings reject our typed object even though it's valid;
      // cast to satisfy the binding overload.
      .run(project as never);

    return project;
  }

  list(): Project[] {
    const rows = this.db
      .query(
        `SELECT * FROM projects
         WHERE deleted_at IS NULL
         ORDER BY position ASC, created_at ASC`
      )
      .all() as ProjectRow[];
    return rows.map(rowToProject);
  }

  get(id: ProjectId): Project | null {
    const row = this.db
      .query("SELECT * FROM projects WHERE id = $id AND deleted_at IS NULL")
      .get({ id }) as ProjectRow | null;
    return row ? rowToProject(row) : null;
  }

  update(input: UpdateProjectInput): Project {
    const existing = this.get(input.id);
    if (!existing) {
      throw new Error(`Project not found: ${input.id}`);
    }

    const now = nowMs();
    const updated: Project = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.icon !== undefined && { icon: input.icon }),
      ...(input.position !== undefined && { position: input.position }),
      revision: existing.revision + 1,
      synced_at: null, // mark as needing sync
      updated_at: now,
      ...(input.client_op_id !== undefined && { client_op_id: input.client_op_id }),
    };

    this.db
      .prepare(
        `UPDATE projects SET
           name = $name,
           description = $description,
           icon = $icon,
           position = $position,
           client_op_id = $client_op_id,
           revision = $revision,
           synced_at = $synced_at,
           updated_at = $updated_at
         WHERE id = $id`
      )
      .run(updated as never);

    return updated;
  }

  /**
   * Soft-delete a project. The row stays in the DB but `deleted_at` is set
   * so list/get/search ignore it. Sync layer can replicate the deletion.
   */
  remove(id: ProjectId): void {
    const now = nowMs();
    this.db
      .prepare("UPDATE projects SET deleted_at = $now, updated_at = $now WHERE id = $id")
      .run({ now, id });
  }
}
