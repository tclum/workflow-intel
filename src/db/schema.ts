import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// sources — the curated source universe.
//
// Authoring source-of-truth is config/sources.yaml (version-controlled,
// PR-reviewable). It is synced INTO this table, which owns (a) a stable FK
// target for items.source_id and (b) per-source fetch telemetry. The telemetry
// columns get their own home here (forpono: "telemetry gets its own columns")
// rather than living in YAML or a blob.
// ---------------------------------------------------------------------------
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    kind: text("kind").notNull().default("rss"),
    category: text("category"),
    enabled: boolean("enabled").notNull().default(true),
    // Per-source BASELINE credibility (0–3); mirrors migration 0002. Seeds each
    // item's per-item source_credibility (see EVAL_RUBRIC.md) — this is the
    // baseline, NOT the gate-read value. Synced from config/sources.yaml.
    sourceTier: smallint("source_tier").notNull().default(2),

    // per-source fetch telemetry (counts are integers)
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    fetchCount: integer("fetch_count").notNull().default(0),
    itemCount: integer("item_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    enabledIdx: index("sources_enabled_idx").on(t.enabled),
  }),
);

// ---------------------------------------------------------------------------
// items — one row per ingested feed entry.
//
// Slice 1 populates the ingestion columns. The embedding + dedup-telemetry
// columns (Slice 2) and triage columns (Slice 3) are created now as NULLable
// and populated by those later slices.
// ---------------------------------------------------------------------------
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    // Stable per-source identifier (feed guid/id, fallback to url) used for
    // ingest idempotency — see the unique index below.
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    summary: text("summary"),
    rawContent: text("raw_content"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // --- Slice 2: semantic dedup (embeddings + telemetry). NULL until populated. ---
    embedding: vector("embedding", { dimensions: 1024 }),
    nearestNeighborId: uuid("nearest_neighbor_id").references(
      (): AnyPgColumn => items.id,
      { onDelete: "set null" },
    ),
    similarityScore: real("similarity_score"),
    mergeDecision: text("merge_decision"),
    dedupedAt: timestamp("deduped_at", { withTimezone: true }),

    // --- Slice 3: cheap-model triage against EVAL_RUBRIC.md. NULL until populated.
    // Mirrors migration 0002_triage_dimensions.sql (already applied): the 0001
    // stub columns signal_score + triage_notes were dropped there. ---
    // Topic categorization, orthogonal to the verdict bucket. Closed enum enforced
    // in the Zod gate (TOPIC_CATEGORIES); the column itself is plain text.
    category: text("category"),
    // Verdict bucket (DISCARD/ARCHIVE/WAIT/TRACK/INVEST/ADOPT-CHEAP). No DB CHECK by
    // design — the routing function + Zod enum are the sole integrity guard.
    signalVerdict: text("signal_verdict"),
    // Advisory model self-verdict, observability only — the router (signal_verdict)
    // is authoritative. Persisted (migration 0003) so model-vs-router disagreement is
    // queryable per-row instead of existing only as the triage run's console counter.
    modelVerdict: text("model_verdict"),
    // Provenance pair (established convention): which model scored this row, when.
    triageModel: text("triage_model"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    // Six scored rubric ordinals (0–3). smallint mirrors 0002.
    evidenceStrength: smallint("evidence_strength"),
    sourceCredibility: smallint("source_credibility"),
    durability: smallint("durability"),
    commoditizationRisk: smallint("commoditization_risk"),
    compositionSpecificity: smallint("composition_specificity"),
    applicability: smallint("applicability"),
    // INVEST is a human-review candidate: the router raises this flag, Timothy
    // adjudicates — never auto-committed.
    investFlag: boolean("invest_flag"),
    // hype_markers: flagged, not scored (text[]).
    hypeMarkers: text("hype_markers").array(),
    // Rationale + extracted snippets (supersede the dropped triage_notes).
    rationale: text("rationale"),
    claim: text("claim"),
    evidence: text("evidence"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Ingest idempotency (NOT semantic dedup): re-polling a feed must not insert
    // the same entry twice. Inserts use ON CONFLICT DO NOTHING on this key.
    // Semantic dedup is Slice 2, via the embedding/nearest_neighbor columns above.
    sourceExternalUnique: uniqueIndex("items_source_external_id_unique").on(
      t.sourceId,
      t.externalId,
    ),
    // HNSW cosine index for Slice 2 nearest-neighbor search (pace-bot convention).
    embeddingIdx: index("items_embedding_hnsw").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    sourceIdIdx: index("items_source_id_idx").on(t.sourceId),
    publishedAtIdx: index("items_published_at_idx").on(t.publishedAt),
  }),
);

// ---------------------------------------------------------------------------
// strategy_docs — persisted synthesis output.
//
// Mirrors migration 0004_strategy_docs.sql (already applied to the live DB):
// every successful synthesis run writes the markdown strategy document here so
// the web UI, digest, and history can read the same generated artifact.
// ---------------------------------------------------------------------------
export const strategyDocs = pgTable(
  "strategy_docs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    synthesisModel: text("synthesis_model").notNull(),
    markdown: text("markdown").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    generatedAtIdx: index("strategy_docs_generated_at_idx").on(
      t.generatedAt.desc(),
    ),
  }),
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type StrategyDoc = typeof strategyDocs.$inferSelect;
export type NewStrategyDoc = typeof strategyDocs.$inferInsert;
