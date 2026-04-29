import { Database } from "bun:sqlite";
import { runMigrations } from "./schema";

/**
 * Open a Brain database at the given path (or `:memory:`) and run migrations.
 * The returned handle is a long-lived connection; the caller is responsible
 * for `db.close()` on shutdown.
 */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  runMigrations(db);
  return db;
}

export type { Database };
