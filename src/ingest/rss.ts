import Parser from "rss-parser";
import { stripHtml } from "./html.js";
import type { SourceConfig } from "./sources.js";

// Normalized feed entry — the shape we insert into `items`. Mirrors the fields
// bus-finance's NewsItem extracts (source/title/summary/url/published), plus a
// stable external_id (for ingest idempotency), raw content, and author.
export interface NormalizedItem {
  externalId: string;
  url: string;
  title: string | null;
  summary: string | null;
  rawContent: string | null;
  author: string | null;
  publishedAt: Date | null;
}

// An author/creator field is USUALLY a string, but rss-parser passes the raw
// xml2js object straight through for RSS 2.0 feeds whose <author> carries child
// elements (e.g. blog.google: <author><name>…</name><email>…</email></author>).
// xml2js wraps text nodes in single-element arrays, hence the array members.
type AuthorPerson = { name?: unknown; email?: unknown };
type AuthorField = string | AuthorPerson | null | undefined;

// rss-parser's item type is loose; capture only the fields we read.
type FeedItem = {
  guid?: string;
  id?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  summary?: string;
  content?: string;
  "content:encoded"?: string;
  creator?: AuthorField;
  author?: AuthorField;
  isoDate?: string;
  pubDate?: string;
};

// Reduce an xml2js-flavored value to a trimmed string. Handles the plain string,
// the single-element array wrapping (["text"]), and the attributed-node shape
// ({ _: "text", $: {…} }) xml2js can emit. Returns null if nothing usable.
function flattenText(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && typeof (v as { _?: unknown })._ === "string") {
    return ((v as { _: string })._).trim() || null;
  }
  return null;
}

// Coerce a creator/author field to a display string. A string is trimmed; an
// object (RSS-2.0 nested <author>) yields its .name, else its .email; anything
// else is null. NEVER throws on an object-valued author (the blog.google crash).
export function coerceAuthor(value: AuthorField): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object") {
    return flattenText(value.name) ?? flattenText(value.email);
  }
  return null;
}

function parsePublished(item: FeedItem): Date | null {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeOne(item: FeedItem): NormalizedItem | null {
  const url = (item.link ?? "").trim();
  // external_id: prefer a stable guid/id; fall back to the link. Without any
  // identifier (or a url) we cannot dedupe-on-insert, so skip the entry.
  const externalId = (item.guid ?? item.id ?? url).trim();
  if (!externalId || !url) return null;

  return {
    externalId,
    url,
    title: stripHtml(item.title) || null,
    summary: stripHtml(item.contentSnippet ?? item.summary) || null,
    rawContent: item["content:encoded"] ?? item.content ?? null,
    // Precedence: creator then author (preserved). Coercion is type-aware so an
    // object-valued author (RSS-2.0 nested <author>) no longer crashes .trim().
    author: coerceAuthor(item.creator ?? item.author),
    publishedAt: parsePublished(item),
  };
}

export function normalizeFeed(feedItems: FeedItem[]): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const item of feedItems) {
    const n = normalizeOne(item);
    if (n) out.push(n);
  }
  return out;
}

const parser = new Parser();

// Parse feed XML from a string. Used by offline tests (no network).
export async function parseFeedString(xml: string): Promise<NormalizedItem[]> {
  const feed = await parser.parseString(xml);
  return normalizeFeed(feed.items as FeedItem[]);
}

// Fetch + normalize a live feed. NOT exercised by Slice 1 tests (offline only);
// wired for the ingest run + future scheduling.
export async function fetchAndNormalize(
  source: SourceConfig,
): Promise<NormalizedItem[]> {
  const feed = await parser.parseURL(source.url);
  return normalizeFeed(feed.items as FeedItem[]);
}
