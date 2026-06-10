import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// Source universe loaded from config/sources.yaml. YAML is the human-authored,
// PR-reviewable source-of-truth (bus-finance pattern); src/ingest/run.ts syncs
// it into the `sources` table. Kept free of env/DB imports so it is unit-testable.

export const sourceSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case (a-z, 0-9, -)"),
  name: z.string().min(1),
  url: z.string().default(""),
  // rss/atom: url is an HTTP(S) feed endpoint. email: url is an IMAP folder path
  // (e.g. "workflow-intel/Anthropic") — the folder IS the source (Slice 1.5).
  kind: z.enum(["rss", "atom", "email"]).default("rss"),
  category: z.string().optional(),
  // Per-source BASELINE credibility (0–3): 3 = lab/primary/first-party,
  // 2 = curated practitioner/publication/newsletter, 1 = solo thread, 0 = SEO
  // farm. This is the baseline ONLY — it is not the value the DISCARD gate reads.
  // Slice 3 triage seeds each item's per-item `source_credibility` from this and
  // may downgrade it with a cited reason; the gate reads that per-item score.
  // Default 2 (curated third-party) for any source that omits it.
  source_tier: z.number().int().min(0).max(3).default(2),
  enabled: z.boolean().default(true),
});

export type SourceConfig = z.infer<typeof sourceSchema>;

export const sourcesFileSchema = z.object({
  version: z.number().int().positive(),
  sources: z.array(sourceSchema),
});

export type SourcesFile = z.infer<typeof sourcesFileSchema>;

export function parseSourcesYaml(raw: string): SourcesFile {
  const file = sourcesFileSchema.parse(parseYaml(raw));

  const slugs = new Set<string>();
  for (const s of file.sources) {
    if (slugs.has(s.slug)) {
      throw new Error(`duplicate source slug: ${s.slug}`);
    }
    slugs.add(s.slug);

    // ENABLED sources must have a non-empty url. DISABLED sources may carry an
    // empty / TODO url (aspirational, not yet verified) — they are never polled.
    if (s.enabled) {
      if (!s.url) {
        throw new Error(`enabled source "${s.slug}" has no url`);
      }
      // Validation is kind-aware: rss/atom urls are HTTP(S) feed endpoints, so
      // they must parse as URLs. email urls are IMAP folder paths (e.g.
      // "workflow-intel/Anthropic"), not URLs — a non-empty path is enough.
      if (s.kind !== "email") {
        try {
          new URL(s.url);
        } catch {
          throw new Error(
            `enabled source "${s.slug}" has invalid url: ${s.url}`,
          );
        }
      }
    }
  }
  return file;
}

export function loadSourcesFile(path: string): SourcesFile {
  return parseSourcesYaml(readFileSync(path, "utf8"));
}

export function enabledSources(file: SourcesFile): SourceConfig[] {
  return file.sources.filter((s) => s.enabled);
}
