// Typed fetch client for the Voyage embeddings API. We deliberately use a thin
// wrapper over the documented REST endpoint rather than the young first-party
// `voyageai` SDK (0.x): it adds no dependency (Node 20+ has global fetch), gives
// explicit control over batching + per-batch error isolation, and lets us
// hard-assert the 1024-dim contract that the items.embedding VECTOR(1024) column
// (with its HNSW vector_cosine_ops index) is locked to. No live call is made in
// tests; this runs only under `pnpm embed`.

const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

// items.embedding is VECTOR(1024) — the schema is LOCKED to 1024. voyage-3 emits
// 1024 natively. We assert every returned vector's length so a misconfigured
// VOYAGE_MODEL (e.g. a 512- or 2048-dim model) fails loudly instead of silently
// corrupting the column / breaking the cosine index.
export const EMBED_DIMENSIONS = 1024;

interface VoyageEmbedding {
  object?: string;
  embedding: number[];
  index: number;
}

interface VoyageResponse {
  object?: string;
  data?: VoyageEmbedding[];
  model?: string;
  usage?: { total_tokens?: number };
}

export interface EmbedBatchResult {
  vectors: number[][];
  totalTokens: number;
}

// Embed a batch of texts. Returns one 1024-dim vector per input, in input order
// (results are re-sorted by the response `index` defensively). Throws on a
// non-2xx response, a count mismatch, or any vector whose dimension != 1024 — so
// the caller can mark the batch failed and let the idempotent re-run retry it.
export async function embedBatch(
  texts: string[],
  model: string,
  apiKey: string,
): Promise<EmbedBatchResult> {
  const res = await fetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model,
      // Stored corpus → "document" (vs "query"); recommended for retrieval/dedup.
      input_type: "document",
    }),
    // Bound each request so a hung connection becomes a caught error (the caller
    // marks the batch failed and the idempotent re-run retries it) rather than
    // hanging the whole embed run.
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Voyage API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as VoyageResponse;
  const data = json.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(
      `Voyage returned ${data.length} embeddings for ${texts.length} inputs`,
    );
  }

  // `index` is the 0-based position of the input; sort by it rather than trust
  // array order, then validate the dimension contract per vector.
  const sorted = [...data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => {
    if (!Array.isArray(d.embedding) || d.embedding.length !== EMBED_DIMENSIONS) {
      throw new Error(
        `Voyage embedding dim ${d.embedding?.length ?? "?"} != ${EMBED_DIMENSIONS} ` +
          `(schema locked to 1024 — check VOYAGE_MODEL="${model}")`,
      );
    }
    return d.embedding;
  });

  return { vectors, totalTokens: json.usage?.total_tokens ?? 0 };
}
