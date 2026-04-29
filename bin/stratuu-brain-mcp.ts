#!/usr/bin/env bun
/**
 * Stratuu Brain MCP server — stdio entrypoint.
 *
 * Usage:
 *   stratuu-brain-mcp [--db <path>]
 *
 * Defaults to a SQLite database at ~/Library/Application Support/Stratuu/brain.db
 * on macOS, ~/.local/share/stratuu/brain.db elsewhere. Override with --db.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { openDb } from "../src/db";
import { buildServer } from "../src/mcp/server";

function defaultDbPath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Stratuu", "brain.db");
  }
  // Linux / others: XDG-ish.
  const xdgDataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  return join(xdgDataHome, "stratuu", "brain.db");
}

function parseArgs(argv: string[]): { dbPath: string; help: boolean } {
  let dbPath = defaultDbPath();
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db" || arg === "-d") {
      const next = argv[++i];
      if (!next) {
        console.error("Error: --db requires a path argument");
        process.exit(1);
      }
      dbPath = next;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return { dbPath, help };
}

function printHelp(): void {
  console.error(`stratuu-brain-mcp — Stratuu Brain MCP server (stdio transport)

Usage:
  stratuu-brain-mcp [options]

Options:
  -d, --db <path>   Path to SQLite database. Default: ${defaultDbPath()}
  -h, --help        Show this help message.

Once running, the server speaks the Model Context Protocol over stdio.
Configure it in your CLI agent (e.g. Claude Code, Codex) via mcp_servers.json.

Example Claude Code config (~/.claude/mcp_servers.json):
  {
    "stratuu-brain": {
      "command": "stratuu-brain-mcp"
    }
  }
`);
}

async function main(): Promise<void> {
  const { dbPath, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printHelp();
    return;
  }

  // Ensure parent directory exists.
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = openDb(dbPath);
  const server = buildServer(db);

  // Log to stderr (stdout is reserved for MCP protocol messages).
  console.error(`[stratuu-brain-mcp] db=${dbPath}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown.
  const shutdown = (signal: string): void => {
    console.error(`[stratuu-brain-mcp] received ${signal}, closing db`);
    try {
      db.close();
    } catch (err) {
      console.error(`[stratuu-brain-mcp] error closing db: ${err}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

await main();
