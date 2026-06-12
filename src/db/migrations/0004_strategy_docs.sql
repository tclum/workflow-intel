-- 0004_strategy_docs.sql — synthesis output persisted for the web UI + history.
-- ⚠️ HARD GATE: review before apply. Idempotent. Ref negbzvymefkgmvhmzkao only.
CREATE TABLE IF NOT EXISTS strategy_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL,
  synthesis_model text NOT NULL,
  markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_docs_generated_at_idx ON strategy_docs (generated_at DESC);