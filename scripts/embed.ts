import { eq, isNull } from "drizzle-orm";
import { env } from "../src/config/env.js";
import { db, sqlClient } from "../src/db/client.js";
import { items } from "../src/db/schema.js";
import {
  chunkBatches,
  EMBED_BATCH_SIZE,
  prepareEmbedText,
} from "../src/embed/text.js";
import { embedBatch } from "../src/embed/voyage.js";

// `pnpm embed` — embed items WHERE embedding IS NULL via Voyage, idempotently.
// Re-runs skip already-embedded rows (the NULL filter) and pick up anything a
// prior failed batch left behind. A failed batch is logged and skipped (non-
// fatal). NO merge / triage here (Slices 2b / 3).
//
// ⚠️  Hits the LIVE Voyage API (costs tokens). NOT run in the build — this is the
//     manual smoke. Requires VOYAGE_API_KEY + an applied migration with data.

async function main(): Promise<void> {
  const apiKey = env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error(
      "[embed] VOYAGE_API_KEY is not set — required for `pnpm embed`. Aborting.",
    );
    process.exit(1);
  }
  const model = env.VOYAGE_MODEL;

  // Idempotency: only rows without an embedding are candidates.
  const pending = await db
    .select({ id: items.id, title: items.title, summary: items.summary })
    .from(items)
    .where(isNull(items.embedding));

  // Drop rows with no usable text — embedding "" is meaningless (and may error).
  const prepared = pending
    .map((r) => ({ id: r.id, text: prepareEmbedText(r.title, r.summary) }))
    .filter((r) => r.text.length > 0);
  const skippedEmpty = pending.length - prepared.length;

  console.log(
    `[embed] model=${model} pending=${pending.length} ` +
      `embeddable=${prepared.length} skippedEmpty=${skippedEmpty} ` +
      `batchSize=${EMBED_BATCH_SIZE}`,
  );

  const batches = chunkBatches(prepared, EMBED_BATCH_SIZE);
  let embedded = 0;
  let failedBatches = 0;
  let totalTokens = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    try {
      const { vectors, totalTokens: t } = await embedBatch(
        batch.map((b) => b.text),
        model,
        apiKey,
      );
      totalTokens += t;
      // Persist each vector on its row. Mid-batch failures are safe: a re-run
      // re-embeds only rows still NULL.
      for (let j = 0; j < batch.length; j++) {
        await db
          .update(items)
          .set({ embedding: vectors[j]! })
          .where(eq(items.id, batch[j]!.id));
      }
      embedded += batch.length;
      console.log(
        `  ✓ batch ${i + 1}/${batches.length}: embedded ${batch.length} (total ${embedded})`,
      );
    } catch (err) {
      failedBatches += 1;
      console.error(
        `  ! batch ${i + 1}/${batches.length} failed (non-fatal): ${String(err)}`,
      );
    }
  }

  console.log(
    JSON.stringify(
      { pending: pending.length, embedded, skippedEmpty, failedBatches, totalTokens },
      null,
      2,
    ),
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
