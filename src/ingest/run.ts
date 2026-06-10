import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { env } from "../config/env.js";
import { db, sqlClient } from "../db/client.js";
import { items, sources, type NewItem } from "../db/schema.js";
import { appendMetrics, type MetricsRow } from "../metrics/csv.js";
import { fetchFolder, parseMessages } from "./email.js";
import { filterRecentItems, RECENCY_WINDOW_DAYS } from "./recency.js";
import { fetchAndNormalize, type NormalizedItem } from "./rss.js";
import { enabledSources, loadSourcesFile, type SourceConfig } from "./sources.js";

// One ingest run: sync sources.yaml → sources table, then ingest each ENABLED
// source. rss/atom sources are fetched per-URL; email sources (Slice 1.5) are
// pulled over ONE read-only IMAP connection, one Gmail folder per source. Both
// paths normalize to NormalizedItem and share persistItems (ON CONFLICT DO
// NOTHING) + per-source telemetry. NO LLM / embeddings here (Slices 2-3).
//
// ⚠️  Running this hits LIVE feeds + the live mailbox. It was NOT executed in the
//     Slice 0-1.5 build; it is exercised only after the migration is applied,
//     DATABASE_URL is set, and (for email) IMAP_USER / IMAP_PASSWORD are set.

const SOURCES_PATH = fileURLToPath(
  new URL("../../config/sources.yaml", import.meta.url),
);
const METRICS_PATH = fileURLToPath(
  new URL("../../data/ingest_metrics.csv", import.meta.url),
);

async function upsertSource(
  s: SourceConfig,
): Promise<{ id: string; lastSuccessAt: Date | null }> {
  const [row] = await db
    .insert(sources)
    .values({
      slug: s.slug,
      name: s.name,
      url: s.url,
      kind: s.kind,
      category: s.category ?? null,
      enabled: s.enabled,
    })
    .onConflictDoUpdate({
      target: sources.slug,
      set: {
        name: s.name,
        url: s.url,
        kind: s.kind,
        category: s.category ?? null,
        enabled: s.enabled,
        updatedAt: new Date(),
      },
    })
    // lastSuccessAt is never touched by the upsert; it carries the prior poll's
    // success timestamp (NULL on first insert) and seeds the email SINCE window.
    .returning({ id: sources.id, lastSuccessAt: sources.lastSuccessAt });
  if (!row) throw new Error(`failed to upsert source ${s.slug}`);
  return row;
}

// Insert normalized items with ingest-idempotency (ON CONFLICT DO NOTHING on the
// UNIQUE(source_id, external_id) index) and return how many rows were NEW. Shared
// by the rss/atom and email paths.
async function persistItems(
  sourceId: string,
  normalized: NormalizedItem[],
): Promise<number> {
  if (normalized.length === 0) return 0;
  const rows: NewItem[] = normalized.map((n) => ({
    sourceId,
    externalId: n.externalId,
    url: n.url,
    title: n.title,
    summary: n.summary,
    rawContent: n.rawContent,
    author: n.author,
    publishedAt: n.publishedAt,
  }));
  const inserted = await db
    .insert(items)
    .values(rows)
    .onConflictDoNothing({ target: [items.sourceId, items.externalId] })
    .returning({ id: items.id });
  return inserted.length;
}

async function markSourceSuccess(
  sourceId: string,
  now: Date,
  insertedCount: number,
): Promise<void> {
  await db
    .update(sources)
    .set({
      lastFetchedAt: now,
      lastSuccessAt: now,
      lastError: null,
      consecutiveFailures: 0,
      fetchCount: sql`${sources.fetchCount} + 1`,
      itemCount: sql`${sources.itemCount} + ${insertedCount}`,
      updatedAt: now,
    })
    .where(eq(sources.id, sourceId));
}

async function markSourceFailure(
  sourceId: string,
  now: Date,
  err: unknown,
): Promise<void> {
  await db
    .update(sources)
    .set({
      lastFetchedAt: now,
      lastError: err instanceof Error ? err.message : String(err),
      consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
      fetchCount: sql`${sources.fetchCount} + 1`,
      updatedAt: now,
    })
    .where(eq(sources.id, sourceId));
}

// Per-run accumulators, mutated as sources are processed.
interface Acc {
  sourcesOk: number;
  sourcesFailed: number;
  itemsFetched: number;
  itemsInserted: number;
  itemsSkipped: number;
}

// Process one already-upserted source: fetch → recency-filter → persist →
// telemetry. A fetch (or persist) failure is contained to THIS source — it is
// marked failed and the run continues. Used by both the rss/atom and email
// paths, so the recency window bounds EVERY feed uniformly.
async function ingestSource(
  acc: Acc,
  sourceId: string,
  slug: string,
  fetch: () => Promise<NormalizedItem[]>,
): Promise<void> {
  const now = new Date();
  try {
    const normalized = await fetch();
    // Drop items older than the recency window BEFORE persisting; only `kept`
    // reaches the DB. Skipped now folds two reasons: old (out of window) and dup
    // (already stored). The metrics invariant fetched = inserted + skipped holds.
    const { kept, droppedOld } = filterRecentItems(
      normalized,
      RECENCY_WINDOW_DAYS,
      now,
    );
    const insertedCount = await persistItems(sourceId, kept);
    const droppedDup = kept.length - insertedCount;
    acc.itemsFetched += normalized.length;
    acc.itemsInserted += insertedCount;
    acc.itemsSkipped += normalized.length - insertedCount;
    await markSourceSuccess(sourceId, now, insertedCount);
    acc.sourcesOk += 1;
    console.log(
      `  ✓ ${slug}: fetched ${normalized.length}, inserted ${insertedCount} ` +
        `(skipped ${normalized.length - insertedCount}: ${droppedOld} old, ${droppedDup} dup)`,
    );
  } catch (err) {
    acc.sourcesFailed += 1;
    await markSourceFailure(sourceId, now, err);
    console.error(`  ! ${slug}: ${String(err)}`);
  }
}

// Mark EVERY enabled email source failed with a shared error — used when the IMAP
// connection (or credential check) fails so no folder can be polled. Each source's
// consecutive_failures climbs independently, matching the rss-per-source semantics.
async function failAllEmailSources(
  acc: Acc,
  emailTargets: SourceConfig[],
  err: unknown,
): Promise<void> {
  for (const s of emailTargets) {
    const { id } = await upsertSource(s);
    acc.sourcesFailed += 1;
    await markSourceFailure(id, new Date(), err);
    console.error(`  ! ${s.slug}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Ingest every enabled email source over ONE read-only IMAP connection. A
// connection/credential failure fails ALL email sources (failAllEmailSources); a
// single folder-select/fetch failure fails just that source (ingestSource's catch).
async function ingestEmailSources(
  acc: Acc,
  emailTargets: SourceConfig[],
): Promise<void> {
  const { IMAP_HOST, IMAP_USER, IMAP_PASSWORD } = env;
  if (!IMAP_USER || !IMAP_PASSWORD) {
    await failAllEmailSources(
      acc,
      emailTargets,
      new Error("IMAP_USER / IMAP_PASSWORD not set"),
    );
    return;
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    await failAllEmailSources(acc, emailTargets, err);
    return;
  }

  try {
    for (const s of emailTargets) {
      const { id: sourceId, lastSuccessAt } = await upsertSource(s);
      // SINCE the last successful poll (NULL → fetch all on first run). Window
      // overlap is harmless: Message-ID dedup drops anything already stored.
      await ingestSource(acc, sourceId, s.slug, async () => {
        const raws = await fetchFolder(client, s.url, lastSuccessAt);
        return parseMessages(raws);
      });
    }
  } finally {
    // Read-only session: logout cleanly; never mutated any flag/label.
    await client.logout().catch(() => {});
  }
}

export interface IngestResult {
  runId: string;
  sourcesTotal: number;
  sourcesOk: number;
  sourcesFailed: number;
  itemsFetched: number;
  itemsInserted: number;
  itemsSkipped: number;
  durationMs: number;
}

export async function runIngest(): Promise<IngestResult> {
  const runId = `ingest-${randomUUID()}`;
  const startedAt = Date.now();
  const file = loadSourcesFile(SOURCES_PATH);
  const targets = enabledSources(file);

  // Partition by kind: rss/atom are fetched per-URL; email over one IMAP conn.
  const feedTargets = targets.filter(
    (s) => s.kind === "rss" || s.kind === "atom",
  );
  const emailTargets = targets.filter((s) => s.kind === "email");

  const acc: Acc = {
    sourcesOk: 0,
    sourcesFailed: 0,
    itemsFetched: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
  };

  // rss/atom path (unchanged behavior, now via the shared helpers).
  for (const s of feedTargets) {
    const { id: sourceId } = await upsertSource(s);
    await ingestSource(acc, sourceId, s.slug, () => fetchAndNormalize(s));
  }

  // email path (Slice 1.5): only opens a connection if there are email sources.
  if (emailTargets.length > 0) {
    await ingestEmailSources(acc, emailTargets);
  }

  const durationMs = Date.now() - startedAt;
  const row: MetricsRow = {
    timestamp_utc: new Date(startedAt).toISOString(),
    run_id: runId,
    sources_total: targets.length,
    sources_ok: acc.sourcesOk,
    sources_failed: acc.sourcesFailed,
    items_fetched: acc.itemsFetched,
    items_inserted: acc.itemsInserted,
    items_skipped: acc.itemsSkipped,
    duration_ms: durationMs,
    // Reserved for the LLM slices — unused in ingestion.
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };
  appendMetrics(METRICS_PATH, row);

  return {
    runId,
    sourcesTotal: targets.length,
    sourcesOk: acc.sourcesOk,
    sourcesFailed: acc.sourcesFailed,
    itemsFetched: acc.itemsFetched,
    itemsInserted: acc.itemsInserted,
    itemsSkipped: acc.itemsSkipped,
    durationMs,
  };
}

async function main() {
  try {
    const result = await runIngest();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    // postgres-js holds the pool open; close it so the process can exit.
    await sqlClient.end();
  }
}

// Auto-run when invoked directly (`pnpm ingest`). Tests never import this module.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
