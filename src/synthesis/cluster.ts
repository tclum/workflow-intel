import { composite } from "../triage/rubric.js";

// Pure clustering helpers for Slice 4 (synthesis). No env / DB / network imports,
// so this is unit-testable offline (the established convention: pure logic here,
// the DB self-join + the Opus call live in scripts/synthesis.ts). The clustering
// runs over the Slice 2 Voyage embeddings' pairwise cosine similarities; the
// exemplar pick reuses the EVAL_RUBRIC composite() ranking key — NOT re-derived.

// Topical-clustering threshold for Slice 4 synthesis. Calibrated 2026-06-11 against
// the live 29-item corpus: one multi-item cluster (the OpenAI "Codex case-study"
// family) reaches FULL capture at 0.75 with zero collateral merges — every other
// eligible item stays a singleton (p90 pairwise cosine sim was 0.68, max 0.874).
// Revisable when the corpus character changes (a new source mix can shift the
// distribution; re-run the calibration dry-run before moving it).
export const SYNTHESIS_CLUSTER_THRESHOLD = 0.75;

// --- Connected-components clustering -------------------------------------------

// One undirected pairwise similarity edge between two item ids. The caller supplies
// the FULL pairwise set (every unordered pair of the doc-eligible items); an edge is
// "kept" only when its similarity clears the threshold. Pairs below threshold still
// contribute their endpoints as nodes, so an item whose every pair is below threshold
// correctly falls out as a singleton cluster.
export interface SimilarityPair {
  a: string;
  b: string;
  similarity: number;
}

// Group ids into clusters by connected components over the graph whose edges are the
// pairs with similarity >= threshold (INCLUSIVE — a pair exactly at the threshold is
// joined). Topical clustering, deliberately looser than the near-verbatim dedup θ.
//
// Deterministic regardless of input order: members within a cluster are sorted
// lexicographically, and clusters are sorted by their (smallest) first member.
export function clusterByThreshold(
  pairs: SimilarityPair[],
  threshold: number,
): string[][] {
  // Node set = every endpoint that appears in any pair (above OR below threshold),
  // so below-threshold-only items survive as singletons.
  const parent = new Map<string, string>();
  const ensure = (id: string): void => {
    if (!parent.has(id)) parent.set(id, id);
  };

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression — does not affect output, only lookup cost.
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return;
    // Union by lexicographically smaller root for a stable, order-independent root.
    if (rx < ry) parent.set(ry, rx);
    else parent.set(rx, ry);
  };

  for (const p of pairs) {
    ensure(p.a);
    ensure(p.b);
  }
  for (const p of pairs) {
    if (p.similarity >= threshold) union(p.a, p.b);
  }

  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const g = groups.get(root);
    if (g) g.push(id);
    else groups.set(root, [id]);
  }

  const clusters = [...groups.values()].map((members) =>
    [...members].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  clusters.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return clusters;
}

// --- Exemplar selection --------------------------------------------------------

// The fields pickExemplar needs: the five composite() inputs plus the tie-break keys.
// publishedAt is epoch-ms (null = unknown, treated as oldest) so the module stays pure
// (the caller maps the DB timestamp → ms).
export interface ExemplarCandidate {
  id: string;
  evidenceStrength: number;
  durability: number;
  compositionSpecificity: number;
  applicability: number;
  commoditizationRisk: number;
  publishedAt: number | null;
}

// Pick the cluster's representative: argmax composite (EVAL_RUBRIC "Ranking within
// actionable buckets"), tie-broken by — in order — higher evidence_strength, newer
// published_at (null loses), then lexicographically smaller id (the final, total
// tiebreak that guarantees determinism). Throws on an empty cluster (programmer error).
export function pickExemplar<T extends ExemplarCandidate>(items: T[]): T {
  if (items.length === 0) {
    throw new Error("pickExemplar: empty cluster");
  }
  // -Infinity sorts a null publishedAt below any real timestamp.
  const pub = (t: T): number => (t.publishedAt ?? Number.NEGATIVE_INFINITY);

  return items.reduce((best, cand) => {
    const bc = composite(best);
    const cc = composite(cand);
    if (cc !== bc) return cc > bc ? cand : best;
    if (cand.evidenceStrength !== best.evidenceStrength) {
      return cand.evidenceStrength > best.evidenceStrength ? cand : best;
    }
    if (pub(cand) !== pub(best)) return pub(cand) > pub(best) ? cand : best;
    // Final total tiebreak: smaller id wins.
    return cand.id < best.id ? cand : best;
  });
}
