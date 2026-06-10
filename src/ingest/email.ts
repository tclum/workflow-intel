import { createHash } from "node:crypto";
import { simpleParser, type ParsedMail } from "mailparser";
import type { ImapFlow, SearchObject } from "imapflow";
import { stripHtml } from "./html.js";
import type { NormalizedItem } from "./rss.js";

// Email-newsletter ingestion (Slice 1.5). Split mirrors rss.ts:
//   - parseMessage(): PURE, offline-testable MIME → NormalizedItem.
//   - fetchFolder():  LIVE IMAP fetch, NOT unit-tested (offline only in Slice 1).
//
// Attribution is by FOLDER, not sender: each email source is one Gmail label
// exposed as an IMAP folder; the folder IS the source (see config/sources.yaml).
// parseMessage therefore does NO From-based routing — it only normalizes a single
// already-attributed message into the same `items` shape RSS produces.

// --- externalId ------------------------------------------------------------
// Prefer the RFC 5322 Message-ID (globally unique, stable across re-polls — the
// email analog of an RSS guid). If absent, derive a stable hash from
// from+subject+date so re-fetching the same message still dedupes via the
// UNIQUE(source_id, external_id) index. If NEITHER is derivable, the message has
// no stable identity and is skipped (mirrors rss.ts's normalizeOne returning null).
function deriveExternalId(parsed: ParsedMail): string | null {
  const messageId = parsed.messageId?.trim();
  if (messageId) return messageId;

  const from = parsed.from?.text?.trim() ?? "";
  const subject = parsed.subject?.trim() ?? "";
  const date = parsed.date ? parsed.date.toISOString() : "";
  if (!from && !subject && !date) return null; // no stable identity → skip

  // Prefixed so the hashed fallback is legible in telemetry and never collides
  // with a real `<...@...>` Message-ID.
  const hash = createHash("sha256").update(`${from}\n${subject}\n${date}`).digest("hex");
  return `sha256:${hash}`;
}

// --- permalink -------------------------------------------------------------
// items.url is NOT NULL. Use an embedded web permalink ONLY when cleanly
// available: a standard RFC 2369 List-Post header carrying an http(s) link.
// Usually List-Post is a mailto: address (no web link) → we fall through to a
// synthetic mid:<externalId>. We deliberately do NOT scrape the body for
// canonical links (brittle, per-newsletter) — mid: is the reliable default.
const HTTP_URL = /https?:\/\/[^\s>"]+/i;

function extractPermalink(parsed: ParsedMail): string | null {
  for (const h of parsed.headerLines) {
    if (h.key.toLowerCase() === "list-post") {
      const m = h.line.match(HTTP_URL);
      if (m) return m[0];
    }
  }
  return null;
}

// Normalize ONE raw RFC822 message into the shared items shape. PURE (no network):
// mailparser does MIME part-selection; we prefer the plaintext part and only fall
// back to stripHtml(html) when there is no text part. Returns null to skip a
// message with no derivable stable id.
export async function parseMessage(
  raw: string | Buffer,
): Promise<NormalizedItem | null> {
  const parsed = await simpleParser(raw);

  const externalId = deriveExternalId(parsed);
  if (!externalId) return null;

  // Prefer .text (no stripping needed). If only .html exists, strip it for the
  // summary and keep the raw html as rawContent (parallels rss.ts keeping
  // content:encoded raw while cleaning the snippet).
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const summary = (text || stripHtml(html)).trim() || null;
  const rawContent = text || html || null;

  const url = extractPermalink(parsed) ?? `mid:${externalId}`;

  return {
    externalId,
    url,
    title: stripHtml(parsed.subject) || null,
    summary,
    rawContent,
    author: parsed.from?.text?.trim() || null,
    publishedAt: parsed.date ?? null,
  };
}

// Normalize a batch of raw messages, dropping any that have no stable id.
export async function parseMessages(
  raws: Array<string | Buffer>,
): Promise<NormalizedItem[]> {
  const out: NormalizedItem[] = [];
  for (const raw of raws) {
    const n = await parseMessage(raw);
    if (n) out.push(n);
  }
  return out;
}

// --- live IMAP fetch (NOT unit-tested) -------------------------------------
// Open one folder READ-ONLY and return the raw source of every message matching
// SINCE sinceDate (or all messages on the first poll, when sinceDate is null).
// NEVER marks messages \Seen or mutates any flag/label — readOnly: true and no
// flag writes. Window overlap from SINCE's day-granularity is harmless: the
// Message-ID dedup on insert drops anything already stored. Connection lifecycle
// (connect/logout) is owned by the caller (run.ts).
export async function fetchFolder(
  client: ImapFlow,
  folderPath: string,
  sinceDate: Date | null,
): Promise<Buffer[]> {
  await client.mailboxOpen(folderPath, { readOnly: true });

  const query: SearchObject = sinceDate ? { since: sinceDate } : { all: true };
  const uids = await client.search(query, { uid: true });
  if (!uids || uids.length === 0) return [];

  const out: Buffer[] = [];
  for await (const msg of client.fetch(
    uids,
    { uid: true, source: true },
    { uid: true },
  )) {
    if (msg.source) out.push(msg.source);
  }
  return out;
}
