import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFeedString, type NormalizedItem } from "../src/ingest/rss.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/sample-feed.xml", import.meta.url),
);

describe("parseFeedString (offline fixture — no network)", () => {
  let parsed: NormalizedItem[];

  beforeAll(async () => {
    parsed = await parseFeedString(readFileSync(fixturePath, "utf8"));
  });

  it("skips entries without a link/identifier", () => {
    // 3 items in the fixture; the third has no link and is dropped.
    expect(parsed).toHaveLength(2);
  });

  it("normalizes the first entry's core fields", () => {
    const first = parsed[0];
    expect(first?.externalId).toBe("post-0001");
    expect(first?.url).toBe("https://example.com/posts/scaling-laws");
    expect(first?.author).toBe("Ada Researcher");
  });

  it("strips HTML from title (tags + entities)", () => {
    expect(parsed[0]?.title).toBe("Scaling laws & efficiency");
  });

  it("produces a clean summary (no tags, no raw entities)", () => {
    const summary = parsed[0]?.summary ?? "";
    expect(summary).toContain("token-efficiency");
    expect(summary).not.toMatch(/<[^>]+>/);
    expect(summary).not.toContain("&#");
  });

  it("parses publishedAt into a Date", () => {
    const published = parsed[0]?.publishedAt;
    expect(published).toBeInstanceOf(Date);
    expect(published?.getUTCFullYear()).toBe(2025);
  });

  it("captures raw content when content:encoded is present", () => {
    const second = parsed[1];
    expect(second?.externalId).toBe("post-0002");
    expect(second?.rawContent ?? "").toContain("<strong>");
  });
});

describe("parseFeedString — object-valued author (blog.google regression)", () => {
  const objAuthorPath = fileURLToPath(
    new URL("./fixtures/sample-feed-atom-author.xml", import.meta.url),
  );

  it("coerces an object-valued author to its name without throwing", async () => {
    // Before the fix, rss-parser hands back author as { name: [...], email: [...] }
    // and `.trim()` threw "(…).trim is not a function". parseFeedString must now
    // resolve, and the author must be the coerced name string.
    const parsed = await parseFeedString(readFileSync(objAuthorPath, "utf8"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.author).toBe("The Keyword Team");
  });
});
