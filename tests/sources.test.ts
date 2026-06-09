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

  it("rejects an enabled source with an invalid url", () => {
    expect(() =>
      parseSourcesYaml(`
version: 1
sources:
  - slug: bad
    name: Bad
    url: "not a url"
    enabled: true
`),
    ).toThrow(/invalid url/);
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
});

describe("config/sources.yaml (the committed stub)", () => {
  const path = fileURLToPath(
    new URL("../config/sources.yaml", import.meta.url),
  );

  it("is valid and loads", () => {
    const file = loadSourcesFile(path);
    expect(file.version).toBeGreaterThan(0);
    expect(file.sources.length).toBeGreaterThan(0);
  });

  it("keeps every enabled stub source on a real, parseable url", () => {
    const file = loadSourcesFile(path);
    for (const s of enabledSources(file)) {
      expect(s.url.length).toBeGreaterThan(0);
      expect(() => new URL(s.url)).not.toThrow();
    }
  });
});
