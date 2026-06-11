import { eq, isNull } from "drizzle-orm";
import { env } from "../src/config/env.js";
import { db, sqlClient } from "../src/db/client.js";
import { items, sources } from "../src/db/schema.js";
import { triageItem } from "../src/triage/anthropic.js";
import {
  applyCommoditizationCap,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  deriveInvestFlag,
  prepareTriageText,
  routeVerdict,
  seedSourceCredibility,
} from "../src/triage/rubric.js";

// `pnpm triage` — score items WHERE triaged_at IS NULL against EVAL_RUBRIC.md via the
// cheap model, idempotently. Re-runs skip already-triaged rows (the NULL filter) so
// no tokens are re-spent and no scores are overwritten. The model SCORES; this script
// ROUTES the verdict in code (routeVerdict), caps commoditization_risk when no signal
// is cited, seeds source_credibility from the source's source_tier baseline, and
// writes triage_model + triaged_at provenance on every scored row.
//
// ⚠️  Hits the LIVE Anthropic API (costs tokens). NOT run in the build — this is the
//     manual smoke. Requires ANTHROPIC_API_KEY + an applied migration with data.

async function main(): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[triage] ANTHROPIC_API_KEY is not set — required for `pnpm triage`. Aborting.",
    );
    process.exit(1);
  }
  const model = env.ANTHROPIC_TRIAGE_MODEL;
  const system = buildTriageSystemPrompt();

  // Idempotency: only untriaged rows are candidates. Join sources for the per-source
  // source_tier baseline that seeds each item's source_credibility.
  const pending = await db
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      rawContent: items.rawContent,
      sourceTier: sources.sourceTier,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(isNull(items.triagedAt));

  console.log(`[triage] model=${model} pending=${pending.length}`);

  let triaged = 0;
  let failed = 0;
  let skippedEmpty = 0;
  let capped = 0;
  let routerDisagreements = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const row of pending) {
    // Drop rows with no usable text — nothing to score.
    if (prepareTriageText(row.title, row.summary, row.rawContent).length === 0) {
      skippedEmpty += 1;
      continue;
    }

    try {
      const { output, inputTokens: it, outputTokens: ot } = await triageItem({
        system,
        userPrompt: buildTriageUserPrompt(row, row.sourceTier),
        model,
        apiKey,
      });
      inputTokens += it;
      outputTokens += ot;

      // Backstops enforced in code, not just the prompt.
      const cap = applyCommoditizationCap(
        output.commoditization_risk,
        output.commoditization_signal,
      );
      if (cap.capped) {
        capped += 1;
        console.warn(
          `  ⚑ commoditization capped ${output.commoditization_risk}→1 (no cited signal) for item ${row.id} — review`,
        );
      }
      const sourceCredibility = seedSourceCredibility(
        output.source_credibility,
        row.sourceTier,
      );

      // The code routes; the model only scores. Route from the FINAL scores.
      const verdict = routeVerdict({
        evidenceStrength: output.evidence_strength,
        sourceCredibility,
        durability: output.durability,
        commoditizationRisk: cap.risk,
        compositionSpecificity: output.composition_specificity,
        applicability: output.applicability,
        hypeMarkers: output.hype_markers,
      });
      if (output.verdict !== verdict) {
        routerDisagreements += 1;
      }
      const investFlag = deriveInvestFlag(verdict);

      await db
        .update(items)
        .set({
          category: output.category,
          signalVerdict: verdict,
          triageModel: model,
          triagedAt: new Date(),
          evidenceStrength: output.evidence_strength,
          sourceCredibility,
          durability: output.durability,
          commoditizationRisk: cap.risk,
          compositionSpecificity: output.composition_specificity,
          applicability: output.applicability,
          investFlag,
          hypeMarkers: output.hype_markers,
          rationale: output.rationale,
          claim: output.claim,
          evidence: output.evidence,
        })
        .where(eq(items.id, row.id));

      triaged += 1;
      console.log(
        `  ✓ ${row.id}: ${verdict}${investFlag ? " (INVEST candidate — needs review)" : ""}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`  ! ${row.id} failed (non-fatal): ${String(err)}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        pending: pending.length,
        triaged,
        failed,
        skippedEmpty,
        commoditizationCapped: capped,
        routerDisagreements,
        inputTokens,
        outputTokens,
      },
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
