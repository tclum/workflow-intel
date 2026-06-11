import { describe, expect, it } from "vitest";
import {
  clusterByThreshold,
  type ExemplarCandidate,
  pickExemplar,
  type SimilarityPair,
} from "../src/synthesis/cluster.js";

// A candidate with all-zero scores; tests clone and mutate it.
function cand(over: Partial<ExemplarCandidate> = {}): ExemplarCandidate {
  return {
    id: "x",
    evidenceStrength: 0,
    durability: 0,
    compositionSpecificity: 0,
    applicability: 0,
    commoditizationRisk: 0,
    publishedAt: null,
    ...over,
  };
}

describe("clusterByThreshold", () => {
  it("returns each node as its own singleton when every pair is below threshold", () => {
    const pairs: SimilarityPair[] = [
      { a: "a", b: "b", similarity: 0.5 },
      { a: "a", b: "c", similarity: 0.4 },
      { a: "b", b: "c", similarity: 0.3 },
    ];
    expect(clusterByThreshold(pairs, 0.8)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups all members of a transitive chain (A~B, B~C, A≁C) into one component", () => {
    const pairs: SimilarityPair[] = [
      { a: "a", b: "b", similarity: 0.9 },
      { a: "b", b: "c", similarity: 0.9 },
      { a: "a", b: "c", similarity: 0.5 }, // below threshold, but transitivity links them
    ];
    expect(clusterByThreshold(pairs, 0.8)).toEqual([["a", "b", "c"]]);
  });

  it("uses an INCLUSIVE threshold: a pair exactly at θ is joined", () => {
    const pairs: SimilarityPair[] = [{ a: "a", b: "b", similarity: 0.8 }];
    expect(clusterByThreshold(pairs, 0.8)).toEqual([["a", "b"]]);
  });

  it("does NOT join a pair just below θ", () => {
    const pairs: SimilarityPair[] = [{ a: "a", b: "b", similarity: 0.79 }];
    expect(clusterByThreshold(pairs, 0.8)).toEqual([["a"], ["b"]]);
  });

  it("separates a mix into the right components", () => {
    const pairs: SimilarityPair[] = [
      { a: "a", b: "b", similarity: 0.95 }, // a-b together
      { a: "c", b: "d", similarity: 0.9 }, // c-d together
      { a: "a", b: "c", similarity: 0.2 }, // keeps the two pairs apart
      { a: "e", b: "a", similarity: 0.1 }, // e is a singleton
    ];
    expect(clusterByThreshold(pairs, 0.85)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("is order-independent: shuffled pair order yields identical output", () => {
    const pairs: SimilarityPair[] = [
      { a: "a", b: "b", similarity: 0.9 },
      { a: "b", b: "c", similarity: 0.88 },
      { a: "d", b: "e", similarity: 0.92 },
      { a: "a", b: "d", similarity: 0.3 },
    ];
    const reversed = [...pairs].reverse();
    const swapped = pairs.map((p) => ({ a: p.b, b: p.a, similarity: p.similarity }));
    const expected = [["a", "b", "c"], ["d", "e"]];
    expect(clusterByThreshold(pairs, 0.85)).toEqual(expected);
    expect(clusterByThreshold(reversed, 0.85)).toEqual(expected);
    expect(clusterByThreshold(swapped, 0.85)).toEqual(expected);
  });

  it("returns [] for no pairs", () => {
    expect(clusterByThreshold([], 0.8)).toEqual([]);
  });
});

describe("pickExemplar", () => {
  it("picks the highest composite", () => {
    const lo = cand({ id: "lo", durability: 1 }); // composite 1
    const hi = cand({ id: "hi", durability: 3, applicability: 3 }); // composite 6
    expect(pickExemplar([lo, hi]).id).toBe("hi");
  });

  it("tie-breaks equal composite by higher evidence_strength", () => {
    // both composite 8
    const a = cand({ id: "a", durability: 2, compositionSpecificity: 2, evidenceStrength: 3, applicability: 1 });
    const b = cand({ id: "b", durability: 2, compositionSpecificity: 2, evidenceStrength: 2, applicability: 2 });
    expect(pickExemplar([b, a]).id).toBe("a");
  });

  it("tie-breaks equal composite+evidence by newer published_at", () => {
    // both composite 8, both evidence 2
    const older = cand({ id: "old", durability: 2, compositionSpecificity: 2, evidenceStrength: 2, applicability: 2, publishedAt: 1000 });
    const newer = cand({ id: "new", durability: 3, compositionSpecificity: 1, evidenceStrength: 2, applicability: 2, publishedAt: 2000 });
    expect(pickExemplar([older, newer]).id).toBe("new");
  });

  it("treats a null published_at as oldest in the recency tiebreak", () => {
    const dated = cand({ id: "dated", evidenceStrength: 2, publishedAt: 1000 });
    const undatedItem = cand({ id: "undated", evidenceStrength: 2, publishedAt: null });
    expect(pickExemplar([undatedItem, dated]).id).toBe("dated");
  });

  it("falls back to the lexicographically smaller id when all else ties", () => {
    const bbb = cand({ id: "bbb", evidenceStrength: 2, publishedAt: 5 });
    const aaa = cand({ id: "aaa", evidenceStrength: 2, publishedAt: 5 });
    expect(pickExemplar([bbb, aaa]).id).toBe("aaa");
  });

  it("is order-independent for the full tiebreak chain", () => {
    const a = cand({ id: "a", durability: 2, compositionSpecificity: 2, evidenceStrength: 3, applicability: 1, publishedAt: 100 });
    const b = cand({ id: "b", durability: 2, compositionSpecificity: 2, evidenceStrength: 3, applicability: 1, publishedAt: 100 });
    expect(pickExemplar([a, b]).id).toBe("a");
    expect(pickExemplar([b, a]).id).toBe("a");
  });

  it("throws on an empty cluster", () => {
    expect(() => pickExemplar([])).toThrow();
  });
});
