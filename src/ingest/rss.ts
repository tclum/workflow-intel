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
  creator?: string;
  author?: string;
  isoDate?: string;
  pubDate?: string;
};

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
    author: (item.creator ?? item.author ?? "").trim() || null,
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
