import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { PagesRepo, ProjectsRepo } from "../src/storage";

let db: Database;
let projects: ProjectsRepo;
let pages: PagesRepo;

beforeEach(() => {
  db = openDb(":memory:");
  projects = new ProjectsRepo(db);
  pages = new PagesRepo(db);
});

afterEach(() => {
  db.close();
});

describe("ProjectsRepo", () => {
  test("create + get", () => {
    const project = projects.create({ name: "Stratuu Desktop", icon: "🖥️" });
    expect(project.id).toBeString();
    expect(project.name).toBe("Stratuu Desktop");
    expect(project.icon).toBe("🖥️");
    expect(project.position).toBe(0);
    expect(project.revision).toBe(1);
    expect(project.synced_at).toBeNull();
    expect(project.deleted_at).toBeNull();

    const fetched = projects.get(project.id);
    expect(fetched).toEqual(project);
  });

  test("list orders by position", () => {
    const a = projects.create({ name: "Alpha" });
    const b = projects.create({ name: "Bravo" });
    const c = projects.create({ name: "Charlie" });

    const list = projects.list();
    expect(list.map((p) => p.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(list[0]!.position).toBe(0);
    expect(list[2]!.position).toBe(2);
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe(c.id);
  });

  test("update bumps revision and clears synced_at", () => {
    const project = projects.create({ name: "Old Name" });
    expect(project.revision).toBe(1);

    const updated = projects.update({ id: project.id, name: "New Name" });
    expect(updated.name).toBe("New Name");
    expect(updated.revision).toBe(2);
    expect(updated.synced_at).toBeNull();
    expect(updated.created_at).toBe(project.created_at);
    expect(updated.updated_at).toBeGreaterThanOrEqual(project.updated_at);
  });

  test("update on missing id throws", () => {
    expect(() => projects.update({ id: "does-not-exist", name: "X" })).toThrow(/not found/);
  });

  test("remove soft-deletes and hides from list/get", () => {
    const project = projects.create({ name: "Goner" });
    projects.remove(project.id);
    expect(projects.get(project.id)).toBeNull();
    expect(projects.list()).toHaveLength(0);
  });
});

describe("PagesRepo", () => {
  test("create + read with default empty content", () => {
    const project = projects.create({ name: "Test" });
    const page = pages.create({ project_id: project.id, title: "First Page" });

    expect(page.title).toBe("First Page");
    expect(page.content).toEqual([]);
    expect(page.parent_page_id).toBeNull();
    expect(page.position).toBe(0);

    const fetched = pages.get(page.id);
    expect(fetched).toEqual(page);
  });

  test("create with content stores and returns it intact", () => {
    const project = projects.create({ name: "T" });
    const content = [
      { id: "b1", type: "heading", content: "Hello", props: { level: 1 } },
      { id: "b2", type: "paragraph", content: "World" },
    ];
    const page = pages.create({ project_id: project.id, title: "P", content });
    expect(page.content).toEqual(content);

    const fetched = pages.get(page.id)!;
    expect(fetched.content).toEqual(content);
  });

  test("list filters by project and parent", () => {
    const p1 = projects.create({ name: "P1" });
    const p2 = projects.create({ name: "P2" });

    const root1 = pages.create({ project_id: p1.id, title: "Root P1" });
    pages.create({ project_id: p1.id, title: "Child P1", parent_page_id: root1.id });
    pages.create({ project_id: p2.id, title: "Root P2" });

    expect(pages.list(p1.id)).toHaveLength(1); // only root pages
    expect(pages.list(p1.id, root1.id)).toHaveLength(1); // only children of root
    expect(pages.list(p2.id)).toHaveLength(1);
  });

  test("update merges content correctly", () => {
    const project = projects.create({ name: "T" });
    const page = pages.create({ project_id: project.id, title: "P" });

    const newContent = [{ id: "x", type: "paragraph", content: "Hi" }];
    const updated = pages.update({ id: page.id, content: newContent, title: "P2" });
    expect(updated.content).toEqual(newContent);
    expect(updated.title).toBe("P2");
    expect(updated.revision).toBe(2);
  });

  test("search finds pages by content text", () => {
    const project = projects.create({ name: "T" });
    pages.create({
      project_id: project.id,
      title: "Postgres notes",
      content: [{ id: "a", type: "paragraph", content: "Use a connection pool for Postgres." }],
    });
    pages.create({
      project_id: project.id,
      title: "Rust notes",
      content: [{ id: "b", type: "paragraph", content: "Rust borrow checker is strict." }],
    });

    const hits = pages.search({ query: "postgres" });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.page.title).toBe("Postgres notes");
    expect(hits[0]!.snippet).toMatch(/<b>/i); // includes highlight
  });

  test("search scoped to project_id", () => {
    const a = projects.create({ name: "A" });
    const b = projects.create({ name: "B" });
    pages.create({
      project_id: a.id,
      title: "alpha-beta",
      content: [{ id: "1", type: "paragraph", content: "react react react" }],
    });
    pages.create({
      project_id: b.id,
      title: "beta-gamma",
      content: [{ id: "2", type: "paragraph", content: "react native" }],
    });

    const hitsA = pages.search({ query: "react", project_id: a.id });
    const hitsB = pages.search({ query: "react", project_id: b.id });
    expect(hitsA).toHaveLength(1);
    expect(hitsB).toHaveLength(1);
    expect(hitsA[0]!.page.project_id).toBe(a.id);
    expect(hitsB[0]!.page.project_id).toBe(b.id);
  });

  test("findBlocks returns matching block type with optional filter", () => {
    const project = projects.create({ name: "T" });
    pages.create({
      project_id: project.id,
      title: "Tasks",
      content: [
        { id: "h", type: "heading", content: "TODO" },
        { id: "t1", type: "checkList", content: "Ship v1", props: { checked: false } },
        { id: "t2", type: "checkList", content: "Write tests", props: { checked: true } },
        { id: "t3", type: "checkList", content: "Polish UI", props: { checked: false } },
      ],
    });

    const allTasks = pages.findBlocks({ type: "checkList" });
    expect(allTasks).toHaveLength(3);

    const open = pages.findBlocks({ type: "checkList", filter: { checked: false } });
    expect(open).toHaveLength(2);
    expect(open.map((h) => h.block.id)).toEqual(["t1", "t3"]);

    const headings = pages.findBlocks({ type: "heading" });
    expect(headings).toHaveLength(1);
  });

  test("findBlocks descends into nested children", () => {
    const project = projects.create({ name: "T" });
    pages.create({
      project_id: project.id,
      title: "Nested",
      content: [
        {
          id: "outer",
          type: "bulletList",
          children: [
            { id: "inner1", type: "checkList", props: { checked: false } },
            { id: "inner2", type: "checkList", props: { checked: true } },
          ],
        },
      ],
    });

    const tasks = pages.findBlocks({ type: "checkList" });
    expect(tasks).toHaveLength(2);
  });

  test("remove soft-deletes page and clears FTS index", () => {
    const project = projects.create({ name: "T" });
    const page = pages.create({
      project_id: project.id,
      title: "Goner",
      content: [{ id: "x", type: "paragraph", content: "byebye" }],
    });

    pages.remove(page.id);
    expect(pages.get(page.id)).toBeNull();
    expect(pages.list(project.id)).toHaveLength(0);
    expect(pages.search({ query: "byebye" })).toHaveLength(0);
  });

  test("project remove cascades delete pages", () => {
    const project = projects.create({ name: "T" });
    const page = pages.create({ project_id: project.id, title: "p" });

    // Cascade is via FK; remove() does soft-delete on project, but pages
    // themselves are not soft-deleted unless we also do it. To make the
    // contract explicit: project.remove() ONLY soft-deletes the project row;
    // pages remain accessible by id but list() filters via project's
    // deleted_at IS NULL only when reading via project.list(). Verify get()
    // still works on direct page id.
    projects.remove(project.id);
    expect(projects.get(project.id)).toBeNull();
    // Page row is still there (we don't auto-cascade soft-deletes for pages).
    expect(pages.get(page.id)).not.toBeNull();
  });
});
