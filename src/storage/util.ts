/**
 * Shared utilities for storage modules.
 */

import type { Block, BlockNoteDocument } from "../types";

export function nowMs(): number {
  return Date.now();
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Extract plain text from a BlockNote document for full-text search indexing.
 *
 * BlockNote `content` can be a string, an array of inline content nodes, or
 * undefined (for blocks like `divider`). We flatten everything we can find
 * into a single space-separated string. This is intentionally lossy — we just
 * want enough text to make FTS5 useful.
 */
export function blocksToPlainText(doc: BlockNoteDocument): string {
  const parts: string[] = [];
  walkBlocks(doc, (block) => {
    if (typeof block.content === "string") {
      parts.push(block.content);
    } else if (Array.isArray(block.content)) {
      for (const node of block.content) {
        if (node && typeof node === "object" && "text" in node && typeof node.text === "string") {
          parts.push(node.text);
        }
      }
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Visit every block in a document, including nested children, in document
 * order. Useful for `find_blocks` and `blocksToPlainText`.
 */
export function walkBlocks(doc: BlockNoteDocument, visit: (block: Block) => void): void {
  for (const block of doc) {
    visit(block);
    if (block.children && block.children.length > 0) {
      walkBlocks(block.children, visit);
    }
  }
}

/**
 * Parse a JSON string into a BlockNote document. Returns `[]` for null/empty
 * input or invalid JSON (we tolerate corruption rather than crash on read).
 */
export function parseDoc(json: string | null | undefined): BlockNoteDocument {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Match a block against a flat key/value filter. Each filter key must equal
 * the corresponding value in `block.props`. Missing props count as no-match.
 */
export function matchesBlockFilter(block: Block, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true;
  const props = block.props ?? {};
  for (const [key, expected] of Object.entries(filter)) {
    if (!Object.is(props[key], expected)) {
      return false;
    }
  }
  return true;
}
