import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/db/client.js";
import { items } from "../src/db/schema.js";
import { similarityFromCosineDistance } from "../src/dedup/similarity.js";

// `pnpm dedup` — calibration-first nearest-neighbor TELEMETRY. For each item with
// an embedding, find its nearest OTHER embedded item by cosine distance (pgvector
// `<=>`, served by the items_embedding_hnsw vector_cosine_ops index) and store
// nearest_neighbor_id + similarity_score (= 1 − distance) + deduped_at. Self is
// excluded; an item with no other embedded item to compare leaves its telemetry
// NULL.
//
// Deliberately does NOT set merge_decision and does NOT merge/delete anything —
// the merge threshold θ is calibrated later FROM this telemetry, not pre-committed
// here. Re-runnable: recomputes the telemetry on every run, no API/token cost.
//
// ⚠️  Hits the LIVE DB. NOT run in the build — this is the manual smoke. Requires
//     an applied migration with embedded rows (run `pnpm embed` first).

interface NeighborRow {
  item_id: string;
  neighbor_id: string;
  distance: number;
}

async function main(): Promise<void> {
  // One pass: each embedded item joined to its single nearest OTHER embedded item.
  // JOIN LATERAL means items with no neighbor are simply absent from the result
  // (their telemetry stays NULL). The inner ORDER BY ... LIMIT 1 over `<=>` is
  // what the HNSW vector_cosine_ops index accelerates. `o.id <> t.id` excludes
  // self (which would otherwise be the distance-0 nearest).
  const rows = await sqlClient<NeighborRow[]>`
    SELECT t.id AS item_id, nn.id AS neighbor_id, nn.dist AS distance
    FROM items t
    JOIN LATERAL (
      SELECT o.id, (t.embedding <=> o.embedding) AS dist
      FROM items o
      WHERE o.embedding IS NOT NULL
        AND o.id <> t.id
      ORDER BY t.embedding <=> o.embedding
      LIMIT 1
    ) nn ON true
    WHERE t.embedding IS NOT NULL
  `;

  const now = new Date();
  let written = 0;
  for (const r of rows) {
    await db
      .update(items)
      .set({
        nearestNeighborId: r.neighbor_id,
        similarityScore: similarityFromCosineDistance(r.distance),
        dedupedAt: now,
      })
      .where(eq(items.id, r.item_id));
    written += 1;
  }

  console.log(
    JSON.stringify({ itemsWithNeighbor: rows.length, telemetryWritten: written }, null, 2),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // postgres-js holds the pool open; close it so the process can exit.
    await sqlClient.end();
  });
