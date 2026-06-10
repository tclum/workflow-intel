import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  enabledSources,
  loadSourcesFile,
  parseSourcesYaml,
} from "../src/ingest/sources.js";

const VALID = `
version: 1
sources:
  - slug: arxiv-cs-ai
    name: "arXiv cs.AI"
    url: "http://export.arxiv.org/rss/cs.AI"
    kind: rss
    category: research
    enabled: true
  - slug: parked-source
    name: "Parked source"
    url: ""
    enabled: false
`;

describe("parseSourcesYaml", () => {
  it("parses a valid file and applies defaults", () => {
    const file = parseSourcesYaml(VALID);
    expect(file.version).toBe(1);
    expect(file.sources).toHaveLength(2);
    const parked = file.sources[1];
    expect(parked?.kind).toBe("rss"); // default applied
  });

  it("filters to enabled sources only", () => {
    const file = parseSourcesYaml(VALID);
    const enabled = enabledSources(file);
    expect(enabled.map((s) => s.slug)).toEqual(["arxiv-cs-ai"]);
  });

  it("allows a disabled source to have an empty/TODO url", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: parked
    name: Parked
    url: ""
    enabled: false
`),
    ).not.toThrow();
  });

  it("rejects an enabled source with no url", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: bad
    name: Bad
    url: ""
    enabled: true
`),
    ).toThrow(/no url/);
  });

  it("rejects an enabled rss source with an invalid url", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: bad
    name: Bad
    url: "not a url"
    kind: rss
    enabled: true
`),
    ).toThrow(/invalid url/);
  });

  it("accepts an enabled email source with a folder-path url (kind-aware)", () => {
    const file = parseSourcesYaml(`
version: 1
sources:
  - slug: anthropic
    name: "Anthropic (newsletter)"
    url: "workflow-intel/Anthropic"
    kind: email
    enabled: true
`);
    const s = file.sources[0];
    expect(s?.kind).toBe("email");
    // The folder path is NOT a parseable URL — the kind-aware rule must not
    // apply the http-URL check to it.
    expect(s?.url).toBe("workflow-intel/Anthropic");
    expect(() => new URL(s?.url ?? "")).toThrow();
  });

  it("still rejects an enabled email source with an empty url", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: bad-email
    name: Bad
    url: ""
    kind: email
    enabled: true
`),
    ).toThrow(/no url/);
  });

  it("rejects duplicate slugs", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: dup
    name: One
    url: "https://example.com/a"
  - slug: dup
    name: Two
    url: "https://example.com/b"
`),
    ).toThrow(/duplicate source slug/);
  });

  it("rejects a non-kebab-case slug", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: "Not Kebab"
    name: Bad
    url: "https://example.com"
`),
    ).toThrow();
  });

  it("defaults source_tier to 2 (curated third-party baseline) when omitted", () => {
    const file = parseSourcesYaml(`
version: 1
sources:
  - slug: no-tier
    name: No tier
    url: "https://example.com"
`);
    expect(file.sources[0]?.source_tier).toBe(2);
  });

  it("parses an explicit source_tier", () => {
    const file = parseSourcesYaml(`
version: 1
sources:
  - slug: first-party
    name: First party
    url: "https://example.com"
    source_tier: 3
`);
    expect(file.sources[0]?.source_tier).toBe(3);
  });

  it("rejects a source_tier outside 0–3", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: bad-tier
    name: Bad tier
    url: "https://example.com"
    source_tier: 4
`),
    ).toThrow();
  });

  it("rejects a non-integer source_tier", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: frac-tier
    name: Fractional tier
    url: "https://example.com"
    source_tier: 2.5
`),
    ).toThrow();
  });
});

describe("config/sources.yaml (the committed curated set)", () => {
  const path = fileURLToPath(
    new URL("../config/sources.yaml", import.meta.url),
  );

  it("is valid and loads", () => {
    const file = loadSourcesFile(path);
    expect(file.version).toBeGreaterThan(0);
    expect(file.sources.length).toBeGreaterThan(0);
  });

  it("dropped the arXiv firehoses from the Slice 0 stub", () => {
    const file = loadSourcesFile(path);
    const slugs = file.sources.map((s) => s.slug);
    expect(slugs).not.toContain("arxiv-cs-ai");
    expect(slugs).not.toContain("arxiv-cs-lg");
  });

  it("enables the ratified curated rss/atom feeds", () => {
    const file = loadSourcesFile(path);
    const feeds = enabledSources(file)
      .filter((s) => s.kind !== "email")
      .map((s) => s.slug)
      .sort();
    expect(feeds).toEqual([
      "ahead-of-ai",
      "claude-code-releases",
      "google-ai-blog",
      "huggingface-blog",
      "last-week-in-ai",
      "openai-news",
      "simon-willison",
      "the-gradient",
    ]);
  });

  it("keeps every enabled source on a non-empty url, parseable for rss/atom", () => {
    const file = loadSourcesFile(path);
    for (const s of enabledSources(file)) {
      expect(s.url.length).toBeGreaterThan(0);
      // rss/atom urls must parse as HTTP(S); email urls are IMAP folder paths
      // (the folder IS the source) and are intentionally not URLs.
      if (s.kind !== "email") {
        expect(() => new URL(s.url)).not.toThrow();
      }
    }
  });

  it("exposes the three email-newsletter sources on folder-path urls", () => {
    const file = loadSourcesFile(path);
    const email = enabledSources(file).filter((s) => s.kind === "email");
    expect(email.map((s) => s.slug).sort()).toEqual([
      "anthropic",
      "import-ai",
      "the-batch",
    ]);
  });

  it("tiers every first-party source at 3 and every curated source at 2", () => {
    const file = loadSourcesFile(path);
    const tierBySlug = new Map(file.sources.map((s) => [s.slug, s.source_tier]));
    // first-party vendor/lab/release-notes → 3
    for (const slug of [
      "openai-news",
      "google-ai-blog",
      "huggingface-blog",
      "claude-code-releases",
      "anthropic",
    ]) {
      expect(tierBySlug.get(slug)).toBe(3);
    }
    // curated third-party newsletters/publications/eng blogs → 2
    for (const slug of [
      "ahead-of-ai",
      "the-gradient",
      "last-week-in-ai",
      "simon-willison",
      "import-ai",
      "the-batch",
    ]) {
      expect(tierBySlug.get(slug)).toBe(2);
    }
  });

  it("keeps every source's baseline tier within 0–3, none at the gate floor", () => {
    const file = loadSourcesFile(path);
    for (const s of file.sources) {
      expect(s.source_tier).toBeGreaterThanOrEqual(2);
      expect(s.source_tier).toBeLessThanOrEqual(3);
    }
  });
});
