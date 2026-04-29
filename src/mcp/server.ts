import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { PagesRepo, ProjectsRepo } from "../storage";

/**
 * Build an MCP server pre-wired with all `brain.*` tools backed by the given
 * database handle. The caller is responsible for connecting a transport
 * (stdio, HTTP/SSE, etc.) and for closing the DB on shutdown.
 */
export function buildServer(db: Database): McpServer {
  const projects = new ProjectsRepo(db);
  const pages = new PagesRepo(db);

  const server = new McpServer({
    name: "stratuu-brain",
    version: "0.1.0",
  });

  // Helper: stringify a result for the text content of a tool response.
  const json = (value: unknown): { content: Array<{ type: "text"; text: string }> } => ({
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  });

  // -- Projects -------------------------------------------------------------

  server.registerTool(
    "brain.create_project",
    {
      title: "Create project",
      description: "Create a new project (top-level container for pages).",
      inputSchema: {
        name: z.string().min(1, "name is required"),
        description: z.string().optional(),
        icon: z.string().optional(),
      },
    },
    async ({ name, description, icon }) => json(projects.create({ name, description, icon }))
  );

  server.registerTool(
    "brain.list_projects",
    {
      title: "List projects",
      description: "Return all non-deleted projects ordered by position.",
      inputSchema: {},
    },
    async () => json(projects.list())
  );

  server.registerTool(
    "brain.update_project",
    {
      title: "Update project",
      description: "Rename, change icon, or reorder a project.",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
        position: z.number().int().optional(),
      },
    },
    async ({ id, name, description, icon, position }) =>
      json(projects.update({ id, name, description, icon, position }))
  );

  server.registerTool(
    "brain.delete_project",
    {
      title: "Delete project",
      description: "Soft-delete a project. Pages remain in the database but become orphaned.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      projects.remove(id);
      return json({ ok: true });
    }
  );

  // -- Pages ----------------------------------------------------------------

  server.registerTool(
    "brain.create_page",
    {
      title: "Create page",
      description:
        "Create a page inside a project (optionally as a child of another page). " +
        "Content is a BlockNote-style array of blocks (default: empty).",
      inputSchema: {
        project_id: z.string(),
        title: z.string().min(1, "title is required"),
        parent_page_id: z.string().optional(),
        icon: z.string().optional(),
        content: z.array(z.any()).optional(),
      },
    },
    async ({ project_id, title, parent_page_id, icon, content }) =>
      json(
        pages.create({
          project_id,
          title,
          parent_page_id,
          icon,
          content,
        })
      )
  );

  server.registerTool(
    "brain.list_pages",
    {
      title: "List pages",
      description:
        "List pages in a project. If parent_page_id is omitted, returns root pages " +
        "(those without a parent). If provided, returns the children of that page.",
      inputSchema: {
        project_id: z.string(),
        parent_page_id: z.string().optional(),
      },
    },
    async ({ project_id, parent_page_id }) => json(pages.list(project_id, parent_page_id ?? null))
  );

  server.registerTool(
    "brain.read_page",
    {
      title: "Read page",
      description: "Return a page by id including its full BlockNote content.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const page = pages.get(id);
      if (!page) {
        return {
          isError: true,
          content: [{ type: "text", text: `Page not found: ${id}` }],
        };
      }
      return json(page);
    }
  );

  server.registerTool(
    "brain.update_page",
    {
      title: "Update page",
      description:
        "Update a page's title, icon, content, parent, or position. Each call " +
        "increments the page's revision and clears synced_at (re-syncing on next push).",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        icon: z.string().nullable().optional(),
        content: z.array(z.any()).optional(),
        parent_page_id: z.string().nullable().optional(),
        position: z.number().int().optional(),
      },
    },
    async ({ id, title, icon, content, parent_page_id, position }) =>
      json(pages.update({ id, title, icon, content, parent_page_id, position }))
  );

  server.registerTool(
    "brain.delete_page",
    {
      title: "Delete page",
      description: "Soft-delete a page. Removes it from list/get and from FTS index.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      pages.remove(id);
      return json({ ok: true });
    }
  );

  // -- Search ---------------------------------------------------------------

  server.registerTool(
    "brain.search_pages",
    {
      title: "Search pages",
      description:
        "Full-text search over page titles and content (SQLite FTS5). Returns " +
        "ranked hits with HTML-highlighted snippets. Optionally scope to one project.",
      inputSchema: {
        query: z.string().min(1, "query is required"),
        project_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, project_id, limit }) => json(pages.search({ query, project_id, limit }))
  );

  server.registerTool(
    "brain.find_blocks",
    {
      title: "Find blocks by type",
      description:
        "Walk pages in scope (or all pages) and return blocks matching a given " +
        "type, optionally filtered by their props. Useful for cross-page queries " +
        "like 'list all unchecked tasks'.",
      inputSchema: {
        type: z.string().min(1, "block type is required"),
        project_id: z.string().optional(),
        filter: z.record(z.string(), z.any()).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ type, project_id, filter, limit }) =>
      json(pages.findBlocks({ type, project_id, filter, limit }))
  );

  return server;
}
