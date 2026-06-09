import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { db, sqlClient } from "../db/client.js";
import { items, sources, type NewItem } from "../db/schema.js";
import { appendMetrics, type MetricsRow } from "../metrics/csv.js";
import { fetchAndNormalize } from "./rss.js";
import { enabledSources, loadSourcesFile, type SourceConfig } from "./sources.js";

// One ingest run: sync sources.yaml → sources table, then for each ENABLED
// source fetch + normalize + insert (ON CONFLICT DO NOTHING), update per-source
// telemetry, and append a metrics row. NO LLM / embeddings here (Slices 2-3).
//
// ⚠️  Running this hits LIVE feeds. It was NOT executed in the Slice 0-1 build;
//     it is exercised only after the migration is applied and DATABASE_URL is set.

const SOURCES_PATH = fileURLToPath(
  new URL("../../config/sources.yaml", import.meta.url),
);
const METRICS_PATH = fileURLToPath(
  new URL("../../data/ingest_metrics.csv", import.meta.url),
);

async function upsertSource(s: SourceConfig): Promise<string> {
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
    .returning({ id: sources.id });
  if (!row) throw new Error(`failed to upsert source ${s.slug}`);
  return row.id;
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

  let sourcesOk = 0;
  let sourcesFailed = 0;
  let itemsFetched = 0;
  let itemsInserted = 0;
  let itemsSkipped = 0;

  for (const s of targets) {
    const sourceId = await upsertSource(s);
    const now = new Date();
    try {
      const normalized = await fetchAndNormalize(s);
      itemsFetched += normalized.length;

      let insertedCount = 0;
      if (normalized.length > 0) {
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
        insertedCount = inserted.length;
      }
      itemsInserted += insertedCount;
      itemsSkipped += normalized.length - insertedCount;

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
      sourcesOk += 1;
      console.log(
        `  ✓ ${s.slug}: fetched ${normalized.length}, inserted ${insertedCount}`,
      );
    } catch (err) {
      sourcesFailed += 1;
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
      console.error(`  ! ${s.slug}: ${String(err)}`);
    }
  }

  const durationMs = Date.now() - startedAt;
  const row: MetricsRow = {
    timestamp_utc: new Date(startedAt).toISOString(),
    run_id: runId,
    sources_total: targets.length,
    sources_ok: sourcesOk,
    sources_failed: sourcesFailed,
    items_fetched: itemsFetched,
    items_inserted: itemsInserted,
    items_skipped: itemsSkipped,
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
    sourcesOk,
    sourcesFailed,
    itemsFetched,
    itemsInserted,
    itemsSkipped,
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
