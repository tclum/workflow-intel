import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { env } from "../src/config/env.js";
import { db, sqlClient } from "../src/db/client.js";
import { strategyDocs } from "../src/db/schema.js";
import {
  clusterByThreshold,
  type SimilarityPair,
  SYNTHESIS_CLUSTER_THRESHOLD,
} from "../src/synthesis/cluster.js";
import {
  buildSynthesisSystemPrompt,
  buildSynthesisUserPrompt,
  planSections,
  renderDoc,
  type SynthesisItem,
} from "../src/synthesis/doc.js";
import { synthesizeNarrative } from "../src/synthesis/anthropic.js";

// `pnpm synthesis` — cluster the doc-eligible items via the Slice 2 embeddings, keep
// the highest-composite exemplar per cluster (INVEST items always surfaced), ask
// Opus for the connective narrative, assemble WORKFLOW_STRATEGY.md deterministically,
// and overwrite it at the repo root. The code SELECTS, CLUSTERS, and ORDERS; the
// model writes prose only (it cannot add, remove, or reorder items). On any Opus
// failure NOTHING is written and the process exits non-zero (no partial doc).
//
// ⚠️  Hits the LIVE Anthropic (Opus) API — costs tokens. NOT run in the build; this
//     is the manual smoke. Requires ANTHROPIC_API_KEY + an applied, triaged DB.

interface ItemRow {
  id: string;
  title: string | null;
  source: string;
  signal_verdict: string;
  model_verdict: string | null;
  evidence_strength: number;
  source_credibility: number;
  durability: number;
  commoditization_risk: number;
  composition_specificity: number;
  applicability: number;
  claim: string | null;
  evidence: string | null;
  rationale: string | null;
  published_at: Date | null;
}

function toItem(r: ItemRow): SynthesisItem {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    verdict: r.signal_verdict,
    modelVerdict: r.model_verdict,
    evidenceStrength: r.evidence_strength,
    sourceCredibility: r.source_credibility,
    durability: r.durability,
    commoditizationRisk: r.commoditization_risk,
    compositionSpecificity: r.composition_specificity,
    applicability: r.applicability,
    claim: r.claim,
    evidence: r.evidence,
    rationale: r.rationale,
    publishedAt: r.published_at ? new Date(r.published_at).getTime() : null,
  };
}

async function main(): Promise<void> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[synthesis] ANTHROPIC_API_KEY is not set — required for `pnpm synthesis`. Aborting.",
    );
    process.exit(1);
  }
  const model = env.ANTHROPIC_SYNTHESIS_MODEL;

  // Doc-eligible set: triaged, not quarantined/archived, and embedded (clustering
  // needs the vector). Exactly the predicate the phase-3 calibration used.
  const rows = (await sqlClient`
    SELECT i.id, i.title, s.slug AS source, i.signal_verdict, i.model_verdict,
           i.evidence_strength, i.source_credibility, i.durability,
           i.commoditization_risk, i.composition_specificity, i.applicability,
           i.claim, i.evidence, i.rationale, i.published_at
    FROM items i JOIN sources s ON s.id = i.source_id
    WHERE i.triaged_at IS NOT NULL
      AND i.signal_verdict NOT IN ('DISCARD','ARCHIVE')
      AND i.embedding IS NOT NULL
    ORDER BY i.id
  `) as unknown as ItemRow[];

  const items = rows.map(toItem);

  // Full pairwise cosine similarity (1 − distance) in one self-join. a.id < b.id
  // yields each unordered pair once. Brute force is trivial at this scale.
  const pairRows = (await sqlClient`
    SELECT a.id AS a, b.id AS b, (1 - (a.embedding <=> b.embedding))::float8 AS sim
    FROM items a JOIN items b ON a.id < b.id
    WHERE a.triaged_at IS NOT NULL AND a.signal_verdict NOT IN ('DISCARD','ARCHIVE') AND a.embedding IS NOT NULL
      AND b.triaged_at IS NOT NULL AND b.signal_verdict NOT IN ('DISCARD','ARCHIVE') AND b.embedding IS NOT NULL
  `) as unknown as { a: string; b: string; sim: number }[];

  const pairs: SimilarityPair[] = pairRows.map((p) => ({
    a: p.a,
    b: p.b,
    similarity: p.sim,
  }));

  const clusters = clusterByThreshold(pairs, SYNTHESIS_CLUSTER_THRESHOLD);
  const plan = planSections(items, clusters);

  const exemplars = clusters.length;
  const collapsed = items.length - clusters.length;
  const sectionCounts = Object.fromEntries(
    plan.map((sp) => [sp.section, sp.entries.length]),
  );

  console.log(
    `[synthesis] model=${model} θ=${SYNTHESIS_CLUSTER_THRESHOLD} eligible=${items.length} clusters=${clusters.length}`,
  );

  // One Opus call for the narrative blocks. If it throws, the catch below exits
  // non-zero and NOTHING is written — render + write happen only on success.
  const { narrative, inputTokens, outputTokens } = await synthesizeNarrative({
    system: buildSynthesisSystemPrompt(),
    userPrompt: buildSynthesisUserPrompt(plan),
    model,
    apiKey,
  });

  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();
  const doc = renderDoc(plan, narrative, {
    generatedAt: generatedAtIso,
    synthesisModel: model,
    threshold: SYNTHESIS_CLUSTER_THRESHOLD,
    eligibleCount: items.length,
    clusterCount: clusters.length,
  });

  const outPath = fileURLToPath(new URL("../WORKFLOW_STRATEGY.md", import.meta.url));
  writeFileSync(outPath, doc, "utf8");
  await db.insert(strategyDocs).values({
    generatedAt,
    synthesisModel: model,
    markdown: doc,
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: generatedAtIso,
        eligible: items.length,
        clusters: clusters.length,
        exemplars,
        collapsed,
        sections: sectionCounts,
        inputTokens,
        outputTokens,
        wrote: outPath,
        persisted: "strategy_docs",
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
