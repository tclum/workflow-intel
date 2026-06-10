import { describe, expect, it } from "vitest";
import { similarityFromCosineDistance } from "../src/dedup/similarity.js";

describe("similarityFromCosineDistance", () => {
  it("maps distance 0 (identical vectors) to similarity 1", () => {
    expect(similarityFromCosineDistance(0)).toBe(1);
  });

  it("maps distance 1 (orthogonal) to similarity 0", () => {
    expect(similarityFromCosineDistance(1)).toBe(0);
  });

  it("maps distance 2 (opposite) to similarity -1", () => {
    expect(similarityFromCosineDistance(2)).toBe(-1);
  });

  it("is the exact complement for intermediate distances", () => {
    expect(similarityFromCosineDistance(0.25)).toBe(0.75);
    expect(similarityFromCosineDistance(0.1)).toBeCloseTo(0.9, 10);
    expect(similarityFromCosineDistance(0.5)).toBe(0.5);
  });

  it("preserves ordering (smaller distance ⇒ larger similarity)", () => {
    const near = similarityFromCosineDistance(0.05);
    const far = similarityFromCosineDistance(0.8);
    expect(near).toBeGreaterThan(far);
  });
});
