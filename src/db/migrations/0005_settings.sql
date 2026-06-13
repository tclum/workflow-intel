-- 0005_settings.sql — DB-backed digest config: recipient list + pause toggle.
-- ⚠️ HARD GATE: review before apply. Idempotent. Ref negbzvymefkgmvhmzkao only.

-- Per-email recipient rows: add/remove via INSERT/DELETE (not array-mutate or
-- JSON read-modify-write), with room for per-recipient fields (label, enabled,
-- added_by) later without restructuring. Resolves to the string[] the send path
-- expects via the email column.
CREATE TABLE IF NOT EXISTS digest_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Typed singleton config row. id is pinned true by the PK + CHECK so at most one
-- row can ever exist; future scalar settings (count definitions, synthesis-model
-- overrides) get their own typed columns here rather than a key/value blob.
CREATE TABLE IF NOT EXISTS settings (
  id boolean PRIMARY KEY DEFAULT true,
  digest_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_singleton CHECK (id)
);

-- Guarantee the singleton row exists so reads always return a row (idempotent).
INSERT INTO settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Seed today's recipient list so DB-backed sends preserve current behavior the
-- moment the send path flips to reading this table. Idempotent. Strike this
-- block to instead populate recipients via the settings UI.
INSERT INTO digest_recipients (email) VALUES
  ('tclum@hawaii.edu'),
  ('huijeff@hawaii.edu')
ON CONFLICT (email) DO NOTHING;
