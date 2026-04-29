# Stratuu Brain MCP

> Shared persistent memory for vibe coders — between the [Stratuu desktop](https://github.com/Haamiahphp/stratuu-desktop) terminal and your CLI agents (Claude Code, Codex, Gemini CLI). Speaks the [Model Context Protocol](https://modelcontextprotocol.io).

**Status**: alpha (`v0.1.0`)

## What it is

Stratuu Brain is an MCP server backed by SQLite. It exposes a set of tools (`brain.create_project`, `brain.create_page`, `brain.search_pages`, `brain.find_blocks`, …) that any MCP-aware client can call to read and write a structured "second brain" of projects → pages → BlockNote-style content.

When the same Brain instance is wired into both your terminal/desktop app and your CLI agent, every tool sees the same memory. Your `claude code` session can save context that your next `codex` session reads — across machines, across days, across agents.

## Why

Vibe coders run multiple AI CLIs in their terminal. Each starts cold. Without a shared memory, your context lives in chat history that nobody else can see and that vanishes the moment the session ends.

Stratuu Brain gives you one persistent place — a tree of pages organized into projects — that all your agents can read, write, and search. The desktop app shows it as a Notion-like editor; the agents see it as MCP tools.

## Install

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
git clone https://github.com/Haamiahphp/stratuu-brain-mcp
cd stratuu-brain-mcp
bun install
bun test  # optional sanity check
```

To run as a standalone MCP server:

```bash
bun run start
```

By default the database lives at `~/Library/Application Support/Stratuu/brain.db` on macOS, `${XDG_DATA_HOME:-~/.local/share}/stratuu/brain.db` elsewhere. Override with `--db <path>`.

## Use it from Claude Code

Add this to `~/.claude/mcp_servers.json`:

```json
{
  "stratuu-brain": {
    "command": "bun",
    "args": ["run", "/absolute/path/to/stratuu-brain-mcp/bin/stratuu-brain-mcp.ts"]
  }
}
```

Then, inside a `claude code` session, the `brain.*` tools become available. Try:

> "Create a project called 'stratuu-desktop' and add a page called 'Architecture' summarizing the file `docs/superpowers/specs/2026-04-29-stratuu-desktop-design.md`."

## Tools

| Tool | Description |
|---|---|
| `brain.create_project` | Create a new project |
| `brain.list_projects` | Return all projects |
| `brain.update_project` | Rename, reorder, or change icon |
| `brain.delete_project` | Soft-delete a project |
| `brain.create_page` | Create a page in a project (optionally nested) |
| `brain.list_pages` | List a project's pages (root or children of a parent page) |
| `brain.read_page` | Get a page including its full BlockNote content |
| `brain.update_page` | Update title, icon, content, parent, or position |
| `brain.delete_page` | Soft-delete a page (also clears it from FTS) |
| `brain.search_pages` | Full-text search (SQLite FTS5) with snippets, optionally scoped |
| `brain.find_blocks` | Walk pages and return blocks of a given type, optionally filtered by props |

## Data model

Two tables: `projects` and `pages`. Pages support unbounded nesting via `parent_page_id`. Page content is BlockNote JSON stored as TEXT. There is no separate `tasks` table — task blocks (`type: "checkList"`) live inside page content and are queryable across all pages via `brain.find_blocks`.

Each row carries sync metadata (`client_op_id`, `revision`, `synced_at`, `deleted_at`) so a future cloud-sync layer can reconcile local writes with a remote replica.

## Architecture

```
┌──────────────────────┐     stdio MCP       ┌──────────────────────┐
│ Claude Code / Codex  │ ──────────────────► │  stratuu-brain-mcp   │
│   Gemini CLI         │ ◄────────────────── │   (Bun + SQLite)     │
└──────────────────────┘                     └──────────────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────────┐
                                              │ ~/Library/.../       │
                                              │   Stratuu/brain.db   │
                                              └──────────────────────┘
```

The Stratuu desktop app embeds this same server as a sidecar, so the editor in the app and the CLI agents in your terminal write to the same database.

## Roadmap

- v0.1: local SQLite, stdio transport, all `brain.*` tools (this release)
- v0.2: HTTP/SSE transport for cross-process / multi-agent fan-out
- v0.3: cloud sync adapter — same MCP tools, storage proxied to Stratuu Cloud (closed-source) for cross-device sync, embeddings, and web view
- v1.0: stable API contract

## License

[AGPL-3.0-only](LICENSE). Cloud sync features (`stratuu-cloud`) live in a separate, proprietary repository — open core / freemium model.
