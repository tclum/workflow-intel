-- =============================================================================
-- 0003_model_verdict.sql
-- Persist the model's self-reported (advisory) verdict alongside the routed
-- signal_verdict, so model-vs-router disagreement is queryable per-row instead
-- of existing only as an aggregate counter in the triage run's console output.
-- The router remains authoritative; this column is observability only.
--
-- ⚠️  HARD GATE: review line-by-line before apply. Apply via session pooler
--     (aws-1-us-west-1.pooler.supabase.com:5432) against ref negbzvymefkgmvhmzkao.
--     NOT auto-run by any build step. Idempotent (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS model_verdict text;