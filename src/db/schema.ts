/**
 * SQLite schema and migrations for Stratuu Brain.
 *
 * All migrations are idempotent (CREATE IF NOT EXISTS) so calling
 * runMigrations() repeatedly on the same DB is safe.
 */

import type { Database } from "bun:sqlite";

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT,
    icon          TEXT,
    position      INTEGER NOT NULL DEFAULT 0,
    client_op_id  TEXT    NOT NULL,
    revision      INTEGER NOT NULL DEFAULT 1,
    synced_at     INTEGER,
    deleted_at    INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_position
    ON projects(position) WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS pages (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_page_id  TEXT    REFERENCES pages(id) ON DELETE CASCADE,
    title           TEXT    NOT NULL,
    icon            TEXT,
    content         TEXT    NOT NULL DEFAULT '[]',
    position        INTEGER NOT NULL DEFAULT 0,
    client_op_id    TEXT    NOT NULL,
    revision        INTEGER NOT NULL DEFAULT 1,
    synced_at       INTEGER,
    deleted_at      INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pages_project_position
    ON pages(project_id, position) WHERE deleted_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_pages_parent
    ON pages(parent_page_id) WHERE deleted_at IS NULL;

  -- Full-text search over the rendered text of a page content.
  -- The application layer populates the text column (after extracting plain
  -- text from the BlockNote document) on each insert/update.
  CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
    page_id UNINDEXED,
    project_id UNINDEXED,
    title,
    text,
    tokenize='unicode61 remove_diacritics 2'
  );
`;

export function runMigrations(db: Database): void {
  db.exec(SCHEMA_SQL);
}
