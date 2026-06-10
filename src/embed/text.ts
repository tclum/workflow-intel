// Pure text-prep + batching helpers for the embed step (Slice 2a). No env / DB /
// network imports, so they are unit-testable offline. The Voyage client lives in
// src/embed/voyage.ts; the DB wiring in scripts/embed.ts.

// Max characters of (title + summary) sent to the embedder. Email summaries can
// be full newsletter bodies, so capping bounds per-item cost and stays well under
// voyage-3's 32K-token context. ~2000 chars ≈ ~500 tokens.
export const EMBED_TEXT_CAP = 2000;

// Texts per Voyage request. Voyage allows up to 1000 per call, but also enforces
// an aggregate per-request token cap; 128 texts × ~500 tokens ≈ 64K keeps every
// batch comfortably under any tier's limit. Conservative on purpose.
export const EMBED_BATCH_SIZE = 128;

// Build the embedding input for one item: title and summary joined by a newline,
// each trimmed, empties dropped (so a null title leaves no leading newline), then
// truncated to `cap`. Returns "" when there is nothing to embed (caller skips).
export function prepareEmbedText(
  title: string | null | undefined,
  summary: string | null | undefined,
  cap: number = EMBED_TEXT_CAP,
): string {
  const text = [title, summary]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n");
  return text.length > cap ? text.slice(0, cap) : text;
}

// Split a list into consecutive chunks of at most `size`. Used to batch items
// into Voyage requests. Throws on a non-positive size (programmer error).
export function chunkBatches<T>(list: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`batch size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}
