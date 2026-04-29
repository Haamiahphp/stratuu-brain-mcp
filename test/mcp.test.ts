import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDb, type Database } from "../src/db";
import { buildServer } from "../src/mcp/server";

let db: Database;
let client: Client;

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

beforeEach(async () => {
  db = openDb(":memory:");
  const server = buildServer(db);
  client = new Client({ name: "test-client", version: "0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  db.close();
});

describe("MCP server", () => {
  test("lists all 10 brain.* tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "brain.create_page",
      "brain.create_project",
      "brain.delete_page",
      "brain.delete_project",
      "brain.find_blocks",
      "brain.list_pages",
      "brain.list_projects",
      "brain.read_page",
      "brain.search_pages",
      "brain.update_page",
      "brain.update_project",
    ].sort());
  });

  test("end-to-end: create_project + create_page + list", async () => {
    const projectResp = await client.callTool({
      name: "brain.create_project",
      arguments: { name: "Stratuu Desktop", icon: "🖥️" },
    });
    const project = parseJson(getText(projectResp)) as { id: string; name: string };
    expect(project.name).toBe("Stratuu Desktop");
    expect(project.id).toBeString();

    const pageResp = await client.callTool({
      name: "brain.create_page",
      arguments: {
        project_id: project.id,
        title: "Architecture",
        content: [
          { id: "h1", type: "heading", content: "Stratuu Brain", props: { level: 1 } },
          { id: "p1", type: "paragraph", content: "Memory shared across CLI agents." },
        ],
      },
    });
    const page = parseJson(getText(pageResp)) as { id: string; title: string };
    expect(page.title).toBe("Architecture");

    const listResp = await client.callTool({
      name: "brain.list_pages",
      arguments: { project_id: project.id },
    });
    const pages = parseJson(getText(listResp)) as Array<{ id: string }>;
    expect(pages).toHaveLength(1);
    expect(pages[0]!.id).toBe(page.id);
  });

  test("search_pages returns hits with snippets", async () => {
    const projectResp = await client.callTool({
      name: "brain.create_project",
      arguments: { name: "T" },
    });
    const project = parseJson(getText(projectResp)) as { id: string };

    await client.callTool({
      name: "brain.create_page",
      arguments: {
        project_id: project.id,
        title: "PostgreSQL tuning",
        content: [{ id: "p", type: "paragraph", content: "Increase shared_buffers carefully." }],
      },
    });

    const searchResp = await client.callTool({
      name: "brain.search_pages",
      arguments: { query: "shared_buffers" },
    });
    const hits = parseJson(getText(searchResp)) as Array<{
      page: { title: string };
      snippet: string;
    }>;
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.page.title).toBe("PostgreSQL tuning");
    expect(hits[0]!.snippet).toContain("<b>");
  });

  test("find_blocks returns matching tasks across pages", async () => {
    const projectResp = await client.callTool({
      name: "brain.create_project",
      arguments: { name: "T" },
    });
    const project = parseJson(getText(projectResp)) as { id: string };

    await client.callTool({
      name: "brain.create_page",
      arguments: {
        project_id: project.id,
        title: "Tasks Page A",
        content: [
          { id: "t1", type: "checkList", content: "Ship", props: { checked: false } },
          { id: "t2", type: "checkList", content: "Test", props: { checked: true } },
        ],
      },
    });
    await client.callTool({
      name: "brain.create_page",
      arguments: {
        project_id: project.id,
        title: "Tasks Page B",
        content: [{ id: "t3", type: "checkList", content: "Polish", props: { checked: false } }],
      },
    });

    const openResp = await client.callTool({
      name: "brain.find_blocks",
      arguments: { type: "checkList", filter: { checked: false } },
    });
    const open = parseJson(getText(openResp)) as Array<{ block: { id: string } }>;
    expect(open).toHaveLength(2);
    expect(open.map((h) => h.block.id).sort()).toEqual(["t1", "t3"]);
  });

  test("read_page on missing id returns isError", async () => {
    const resp = await client.callTool({
      name: "brain.read_page",
      arguments: { id: "nonexistent" },
    });
    expect(resp.isError).toBe(true);
    expect(getText(resp)).toContain("not found");
  });

  test("update_project bumps revision", async () => {
    const created = await client.callTool({
      name: "brain.create_project",
      arguments: { name: "Old" },
    });
    const project = parseJson(getText(created)) as { id: string; revision: number };
    expect(project.revision).toBe(1);

    const updated = await client.callTool({
      name: "brain.update_project",
      arguments: { id: project.id, name: "New" },
    });
    const after = parseJson(getText(updated)) as { name: string; revision: number };
    expect(after.name).toBe("New");
    expect(after.revision).toBe(2);
  });
});

function getText(resp: { content: unknown[] }): string {
  const first = resp.content[0] as { type: string; text: string } | undefined;
  if (!first || first.type !== "text") {
    throw new Error("MCP response had no text content");
  }
  return first.text;
}
