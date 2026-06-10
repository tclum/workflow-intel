import { describe, expect, it } from "vitest";
import {
  chunkBatches,
  EMBED_BATCH_SIZE,
  EMBED_TEXT_CAP,
  prepareEmbedText,
} from "../src/embed/text.js";

describe("prepareEmbedText", () => {
  it("joins title and summary with a newline", () => {
    expect(prepareEmbedText("Title", "Summary")).toBe("Title\nSummary");
  });

  it("uses only the summary when title is null (no leading newline)", () => {
    expect(prepareEmbedText(null, "Summary")).toBe("Summary");
  });

  it("uses only the title when summary is null (no trailing newline)", () => {
    expect(prepareEmbedText("Title", null)).toBe("Title");
  });

  it("returns empty string when both are null/empty/whitespace", () => {
    expect(prepareEmbedText(null, null)).toBe("");
    expect(prepareEmbedText("  ", "")).toBe("");
    expect(prepareEmbedText(undefined, undefined)).toBe("");
  });

  it("trims each part before joining", () => {
    expect(prepareEmbedText("  Title  ", "  Summary  ")).toBe("Title\nSummary");
  });

  it("truncates to the default cap", () => {
    const long = "a".repeat(EMBED_TEXT_CAP + 500);
    expect(prepareEmbedText(long, null)).toHaveLength(EMBED_TEXT_CAP);
  });

  it("truncates the joined (title + newline + summary) text to a custom cap", () => {
    // "abcde\nfghij" (len 11) sliced to 7 → "abcde\nf"
    const out = prepareEmbedText("abcde", "fghij", 7);
    expect(out).toBe("abcde\nf");
    expect(out).toHaveLength(7);
  });

  it("does not pad or alter text under the cap", () => {
    expect(prepareEmbedText("short", "text", 1000)).toBe("short\ntext");
  });
});

describe("chunkBatches", () => {
  it("splits an evenly divisible list", () => {
    expect(chunkBatches([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("keeps a short final chunk", () => {
    expect(chunkBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size exceeds length", () => {
    expect(chunkBatches([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunkBatches([], 3)).toEqual([]);
  });

  it("throws on a non-positive or non-integer size", () => {
    expect(() => chunkBatches([1], 0)).toThrow();
    expect(() => chunkBatches([1], -2)).toThrow();
    expect(() => chunkBatches([1], 1.5)).toThrow();
  });
});

describe("embed constants", () => {
  it("keeps the batch size within Voyage's 1000-per-request list limit", () => {
    expect(EMBED_BATCH_SIZE).toBeGreaterThan(0);
    expect(EMBED_BATCH_SIZE).toBeLessThanOrEqual(1000);
  });
});
