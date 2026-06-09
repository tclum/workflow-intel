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
  kind: z.enum(["rss", "atom"]).default("rss"),
  category: z.string().optional(),
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

    // ENABLED sources must have a real, parseable URL. DISABLED sources may
    // carry an empty / TODO URL (aspirational, not yet verified) — they are
    // simply never polled.
    if (s.enabled) {
      if (!s.url) {
        throw new Error(`enabled source "${s.slug}" has no url`);
      }
      try {
        new URL(s.url);
      } catch {
        throw new Error(`enabled source "${s.slug}" has invalid url: ${s.url}`);
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
