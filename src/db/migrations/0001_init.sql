-- workflow-intel — migration 0001 (init)
--
-- Slice 0: store foundation for the AI workflow & token-efficiency intelligence
-- pipeline. Creates the `sources` universe + `items` table. The embedding +
-- dedup-telemetry columns (Slice 2) and triage columns (Slice 3) are created now
-- as NULLable and populated by those later slices.
--
-- ⚠️  HARD GATE: this migration is UNAPPLIED. Review it line-by-line, then apply
--     it yourself against a reviewed target (e.g. `pnpm migrate`). Nothing in
--     this repo auto-applies it.
--
-- Kept in parity with src/db/schema.ts (Drizzle). gen_random_uuid() comes from
-- pgcrypto; the vector type + HNSW index come from pgvector — both created below
-- (mirrors pace-bot/src/db/migrations/0000_init.sql).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- sources: curated source universe. Authored in config/sources.yaml and synced
-- here; this table also owns per-source fetch telemetry + the FK target for items.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  url                   TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'rss',
  category              TEXT,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  -- per-source fetch telemetry (counts are integers)
  last_fetched_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  fetch_count           INTEGER NOT NULL DEFAULT 0,
  item_count            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_enabled_idx ON sources (enabled);

-- ---------------------------------------------------------------------------
-- items: one row per ingested feed entry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id           TEXT NOT NULL,
  url                   TEXT NOT NULL,
  title                 TEXT,
  summary               TEXT,
  raw_content           TEXT,
  author                TEXT,
  published_at          TIMESTAMPTZ,
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Slice 2: semantic dedup (embeddings + telemetry); NULL until populated.
  embedding             VECTOR(1024),
  nearest_neighbor_id   UUID REFERENCES items(id) ON DELETE SET NULL,
  similarity_score      REAL,
  merge_decision        TEXT,
  deduped_at            TIMESTAMPTZ,

  -- Slice 3: cheap-model triage + categorization; NULL until populated.
  category              TEXT,
  signal_verdict        TEXT,
  signal_score          INTEGER,
  triage_notes          TEXT,
  triage_model          TEXT,
  triaged_at            TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingest idempotency (NOT semantic dedup): re-polling a feed must not insert the
-- same entry twice. Inserts use ON CONFLICT DO NOTHING on this key. Modeled as a
-- UNIQUE INDEX to match the Drizzle uniqueIndex() in schema.ts.
CREATE UNIQUE INDEX IF NOT EXISTS items_source_external_id_unique
  ON items (source_id, external_id);

-- HNSW cosine index for Slice 2 nearest-neighbor search (pace-bot convention).
-- Safe to create now; NULL embeddings are simply not indexed.
CREATE INDEX IF NOT EXISTS items_embedding_hnsw
  ON items USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS items_source_id_idx ON items (source_id);
CREATE INDEX IF NOT EXISTS items_published_at_idx ON items (published_at);

-- updated_at maintenance: Postgres has no column-level ON UPDATE, so a
-- BEFORE UPDATE trigger bumps updated_at on every row update.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sources_set_updated_at ON sources;
CREATE TRIGGER sources_set_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS items_set_updated_at ON items;
CREATE TRIGGER items_set_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
