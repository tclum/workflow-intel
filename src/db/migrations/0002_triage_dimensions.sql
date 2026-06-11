-- =============================================================================
-- 0002_triage_dimensions.sql
-- Slice 3 triage: per-dimension rubric scores on items + source_tier baseline
-- on sources. Supersedes the pre-provisioned 3-scalar triage design from 0001
-- (signal_score / triage_notes) with the finalized EVAL_RUBRIC dimension set.
--
-- ⚠️  HARD GATE: review line-by-line before apply. Apply via session pooler
--     (aws-1-us-west-1.pooler.supabase.com:5432) against ref negbzvymefkgmvhmzkao.
--     NOT auto-run by any build step. Idempotent (IF NOT EXISTS / IF EXISTS).
-- =============================================================================

-- --- sources: per-source credibility BASELINE -------------------------------
-- Baseline ONLY. Slice 3 seeds each item's per-item source_credibility from
-- this; the DISCARD gate reads the per-item value, never this column directly.
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS source_tier smallint NOT NULL DEFAULT 2;

-- --- items: finalized rubric dimensions -------------------------------------
-- Six scored ordinals (0–3). No CHECK constraint: validation lives in the Zod
-- gate the cheap model's JSON passes through before insert (house style — this
-- schema has no DB-level domain checks; the Zod boundary is the single guard).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS evidence_strength       smallint,
  ADD COLUMN IF NOT EXISTS source_credibility      smallint,
  ADD COLUMN IF NOT EXISTS durability              smallint,
  ADD COLUMN IF NOT EXISTS commoditization_risk    smallint,
  ADD COLUMN IF NOT EXISTS composition_specificity smallint,
  ADD COLUMN IF NOT EXISTS applicability           smallint;

-- INVEST is a human-review candidate, not auto-committed: the model raises the
-- flag, Timothy adjudicates. Boolean flag, not a score.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS invest_flag boolean;

-- hype_markers: flagged, not scored. Array of marker strings.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS hype_markers text[];

-- Rationale + extracted snippets (supersedes triage_notes).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS rationale text,
  ADD COLUMN IF NOT EXISTS claim     text,
  ADD COLUMN IF NOT EXISTS evidence  text;

-- --- supersede the pre-0001 3-scalar triage stubs ---------------------------
-- signal_verdict is RETAINED and repurposed as the verdict-bucket column
-- (DISCARD / ARCHIVE / WAIT / TRACK / INVEST / ADOPT-CHEAP) — already perfectly
-- named, NULL across all 150 rows. triage_model / triaged_at are RETAINED
-- (provenance pair, established convention).
--
-- signal_score (single int) is meaningless beside six ordinals; triage_notes
-- is a worse-named rationale. Both NULL across all 150 rows — zero-risk drop.
ALTER TABLE items
  DROP COLUMN IF EXISTS signal_score,
  DROP COLUMN IF EXISTS triage_notes;