# workflow-intel

Private-first **AI workflow & token-efficiency intelligence** pipeline.

The v0 spine:

```
curated sources → cheap LLM triage + categorize → pgvector semantic dedup → store
                → weekly synthesis run → updates WORKFLOW_STRATEGY.md
```

This repository currently implements **Slice 0 (store)** and **Slice 1
(ingestion)** only. Triage, embeddings/dedup, synthesis, and scheduling are
later slices, gated on open decisions (threshold calibration, the anti-hype eval
rubric, the ratified curated source list).

## Status by slice

| Slice | Scope | State |
|---|---|---|
| 0 | scaffold + store (pgvector schema, migrate runner) | ✅ built; **migration unapplied** |
| 1 | RSS ingestion (YAML source universe → fetch → normalize → insert) + metrics CSV | ✅ built; **offline-tested only** |
| 2 | semantic dedup (Voyage `voyage-3` embeddings, HNSW cosine) | ⛔ not started |
| 3 | cheap-model triage + categorization + anti-hype rubric | ⛔ not started |
| 4 | weekly synthesis → `WORKFLOW_STRATEGY.md` | ⛔ not started |
| 5 | scheduling | ⛔ not started |

## Architecture notes

- **TypeScript / Node / pnpm.** DB layer modeled on `pace-bot`: Drizzle ORM +
  `postgres-js` + pgvector. Anthropic wrapper / Zod-validated JSON / env-via-Zod
  patterns modeled on `flyer-bot`. Ingestion shape modeled on `bus-finance`
  (YAML source universe → fetch → store, metrics CSV) but re-implemented in TS
  with `rss-parser` (not Python `feedparser`).
- **Embeddings** are Voyage `voyage-3`, 1024-dim → `items.embedding VECTOR(1024)`.
  The column + HNSW `vector_cosine_ops` index exist now; they are populated in
  Slice 2. No embedding API is called yet.
- **Conventions** applied stylistically from forpono: `snake_case` plural tables,
  counts as integers, telemetry in its own columns, sequential numbered SQL
  migrations. This is a single-owner internal tool, so **RLS is intentionally
  not used** (not multi-tenant).
- **Sources are authored in `config/sources.yaml`** (the human-edited,
  PR-reviewable source-of-truth) and synced into a `sources` table that owns
  per-source fetch telemetry and the FK target for `items`. See
  `config/sources.yaml` — it is a **STUB** placeholder set, not the ratified list.

## Layout

```
config/sources.yaml          # STUB source universe (replace before real ingestion)
scripts/migrate.ts           # migration runner (pace-bot pattern) — NOT auto-run
src/config/env.ts            # Zod-validated env (flyer-bot pattern)
src/db/client.ts             # postgres-js + drizzle client
src/db/schema.ts             # Drizzle schema (parity with the SQL migration)
src/db/migrations/0001_init.sql  # hand-authored DDL — UNAPPLIED
src/ingest/sources.ts        # load + validate sources.yaml (Zod)
src/ingest/rss.ts            # rss-parser fetch + normalize
src/ingest/html.ts           # HTML/entity stripping (bus-finance _strip_html port)
src/ingest/run.ts            # one ingest run (sync sources → fetch → insert)
src/metrics/csv.ts           # metrics CSV append (bus-finance pattern)
tests/                       # offline tests (recorded RSS fixture; no network)
data/                        # runtime metrics CSV is written here (gitignored)
```

## Running (after review)

This build deliberately does **not** apply the migration, call any LLM/embedding
API, hit live feeds, or deploy. To take it further yourself:

```bash
pnpm install
pnpm typecheck
pnpm test                 # offline; uses tests/fixtures/sample-feed.xml

# Only after reviewing src/db/migrations/0001_init.sql and setting DATABASE_URL:
pnpm migrate              # applies 0001_init.sql

# Ingestion hits LIVE feeds — only run intentionally, after Slice 1 verification:
pnpm ingest
```
