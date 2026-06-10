// Pure conversion for the dedup-telemetry step (Slice 2b). pgvector's `<=>`
// operator returns cosine DISTANCE in [0, 2]; we store cosine SIMILARITY (its
// complement) so larger = more alike, which reads more naturally when the merge
// threshold θ is calibrated later FROM this telemetry. No env / DB / network
// imports → offline-testable.
export function similarityFromCosineDistance(distance: number): number {
  return 1 - distance;
}
