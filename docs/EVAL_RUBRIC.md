# Anti-Hype Eval Rubric — workflow-intel

**Status:** Design spec for **Slice 3 (triage)** and **Slice 4 (synthesis)**. Not yet implemented — current build state is Slice 1.5 done, **Slice 2 (dedup) next**. Slice 4's clustering depends on Slice 2's embeddings.

**Provenance:** Rubric authored in a separate planning conversation; the "Reviewer assessment & open decisions" section at the bottom was added in review.

**Purpose:** Two jobs at once — gate out hype, and route real methods through a durability / commoditization / composition lens into action buckets. This is the **verdict layer**, kept orthogonal to the *topic* categorization Slice 3 also assigns (prompting / orchestration / context / token-efficiency).

---

## Scoring dimensions

All scores are **0–3 integer ordinals** with anchored levels (ordinals beat 0–100 for cheap-model consistency, and the anchors stop the model guessing what "2" means).

### A. Trust — is this worth believing at all? (the anti-hype gate)

- **evidence_strength (0–3)** — claim-to-proof ratio. `0` = bare assertion / single anecdote generalized to a universal claim; `1` = plausible, unverified; `2` = reproducible signal (before/after, ablation, real usage numbers); `3` = strong, quantified, reproducible. Big claim + no number → low score.
- **source_credibility (0–3, per-item — this is the value the DISCARD gate reads)** — `0` = SEO farm / engagement-bait; `1` = solo thread, no receipts; `2` = practitioner/eng blog with detail; `3` = lab / primary / peer-reviewed / first-party. **Initialized from the item's source `source_tier` baseline in `sources.yaml`** (per-source, set once, not re-derived per item), then adjusted per-item: the model may **downgrade only with a cited reason** and may not silently override the baseline. `source_tier` (per-source baseline) and `source_credibility` (per-item, gate-read) are **distinct terms and must not be used interchangeably** — load-bearing for the Slice 3 triage prompt. *(Finalized — was Reviewer note 4.)*
- **hype_markers (string[] — flag, not scored)** — superlatives without numbers ("10x", "game-changer", "secret", "nobody's talking about"), product-pitch framing, or claims that contradict how models work. Presence discounts the item.

### B. Leverage — if it's real, what should we DO? (the three-bucket core)

- **durability (0–3)** — model half-life. `0` = workaround for a current model limitation the next release likely erases (prompt gymnastics to force format/behavior); `2` = survives model upgrades; `3` = structural practice independent of capability (eval loops, verification gates, ownership boundaries).
- **commoditization_risk (0–3)** — will the tooling ship this as a built-in? `0` = no vendor would productize it for you; `2` = plausibly on a roadmap; `3` = obviously about to be a feature (don't build infra around it). **A score ≥ 2 requires a concrete cited signal in the rationale — a named tool, vendor, pricing move, beta, or release. Absent a citable signal, cap at 1.** A cheap model free-guesses vendor roadmaps; tying the most-speculative dimension to evidence is the main mis-routing guard. *(Finalized — was Reviewer note 2.)*
- **composition_specificity (0–3)** — where the value lives. `0` = fully generic, the value is in the method itself and anyone gets it by reading it; `3` = the value is in how it's composed into a specific stack (the monorepo, the CC+Codex split, the conventions) and compounds there.

### C. Fit — relevant to this project specifically

- **applicability (0–3)** — fit to the actual stack and goals: TS/Node monorepos, the multi-agent workflow, and especially token/cost-efficiency (the project's namesake). `0` = irrelevant to the setup; `3` = directly applicable, doubly so if it cuts token spend.
- **recency (modifier, not additive)** — very new + unproven raises hype caution; `>~6–12 months` old may be obsolete. Down-rank if a newer model/feature already supersedes it. *(See Reviewer note 5.)*

---

## Verdict routing (first match wins)

1. **DISCARD** — if `evidence_strength ≤ 1` AND `source_credibility ≤ 1` (or `hype_markers` present with no countervailing evidence). **Quarantined** — never reaches synthesis, but retained for audit.
2. **ARCHIVE** — else if `applicability ≤ 1`. General-interest, not surfaced in the strategy doc.
3. **WAIT (capability)** — else if `durability ≤ 1`. A gap the model will close; note it, don't build around it, revisit next model release.
4. **TRACK / ADOPT-CHEAP** — else if `commoditization_risk ≥ 2`. Use it lightly now, watch for the product version, don't build infrastructure you'll throw away. (If `composition_specificity ≥ 2`, build thin/adapter-style so the eventual product slots under your composition.)
5. **INVEST (human-review candidate — not auto-committed)** — else if `composition_specificity ≥ 2` (you reach here only if durable + low-commoditization). Its two gates are the two dimensions a cheap model judges worst, and INVEST is the only verdict that spends real build effort — so the router never auto-commits it. It **flags** the item as an INVEST candidate; **Timothy adjudicates** before anything reaches the top of `WORKFLOW_STRATEGY.md`. Every other bucket (DISCARD / ARCHIVE / WAIT / TRACK / ADOPT-CHEAP) auto-routes. *(Finalized — was Reviewer note 1.)*
6. **ADOPT-CHEAP** — otherwise. Real but generic; just do it, no durable edge.

## Ranking within actionable buckets (Slice 4 ordering)

`composite = durability + composition_specificity + evidence_strength + applicability − commoditization_risk`. Higher sorts earlier.

---

## How it plugs into the pipeline

- **Slice 3 (triage):** the cheap model emits Zod-validated JSON per item — the eight scores, `hype_markers[]`, the derived verdict bucket, a one-line rationale, and extracted claim + evidence snippets. `source_credibility` is seeded from the item's source `source_tier` (downgradable only with a cited reason); `commoditization_risk ≥ 2` requires a cited signal or is capped at 1. Stored on the `items` row in dedicated columns (telemetry-in-columns convention) so re-ranking never re-calls the model. *(See Reviewer note 6.)*
- **Slice 4 (synthesis):** cluster via the Slice 2 embeddings → keep the highest-composite exemplar per cluster → write `WORKFLOW_STRATEGY.md` grouped by verdict bucket. The doc has **four** sections, in this order: **Build / integrate now (INVEST — flagged for Timothy's confirmation, not auto-committed)** → **Adopt now, cheaply (ADOPT-CHEAP)** → **Watch for the product (TRACK)** → **Wait for the model (WAIT)**. DISCARD/ARCHIVE are the only buckets excluded, by a `WHERE` filter. The bucket is the section structure of the doc. *(Resolves the §52/routing-#6 inconsistency found in the Slice 4 recon: the prior wording enumerated only three sections and silently dropped ADOPT-CHEAP — routing rule #6's first-class actionable bucket and, in the live corpus, the largest doc-eligible one. The old TRACK heading "Adopt cheaply, watch for the product" also collided with ADOPT-CHEAP's own meaning; TRACK is now "Watch for the product" and ADOPT-CHEAP is "Adopt now, cheaply.")*

## Calibration

Hand-label ~15–25 items spanning known-durable (eval-driven dev, verification gates), known-commoditizable (a bespoke orchestration the platforms are racing to ship), and known-hype ("this one prompt 10x's your agent"). Include known-good historical examples, not only the current corpus. Tune the anchors and gate thresholds until the router's buckets match the labels. Re-run on each model release — durability and commoditization scores move when a new model or feature ships, so an item scored WAIT last quarter can be moot now.

## Self-reference principle

Apply the rubric to workflow-intel's own parts. Its triage model, its dedup approach, and the rubric itself are all methods subject to the same verdict — the synthesis should be willing to emit "this pipeline component is about to be a feature; stop maintaining it."

---

## Reviewer assessment & open decisions

*Added in review. The original invited pushback on two load-bearing decisions (DISCARD hard-drop vs. quarantine; the `commoditization_risk ≥ 2` cutoff); this section answers both and adds refinements. Core verdict: **adopt** — these are tightening, not rejection. Notes 1, 2, and 4 were **finalized during Slice 3 triage scoping (2026-06-10) and folded into the rubric body above**; they remain here for the rationale.*

1. ✅ **FINALIZED (in body — verdict routing #5, synthesis).** *INVEST rests on the two softest cheap-model dimensions.* Both gates for INVEST — `commoditization_risk` (roadmap prediction) and `composition_specificity` (fit to a specific stack) — are precisely what a cheap model judges worst, and INVEST is the most consequential verdict (it spends real build effort). INVEST is therefore a **human-review candidate**: the router flags it, Timothy adjudicates, synthesis surfaces it for confirmation rather than auto-committing. Auto-routing is fine for the lower-stakes buckets (DISCARD / ARCHIVE / WAIT / TRACK / ADOPT-CHEAP).

2. ✅ **FINALIZED (in body — `commoditization_risk` dimension).** *`commoditization_risk ≥ 2` must cite a concrete signal* (the flagged load-bearing cutoff). A cheap model free-guesses at vendor roadmaps. A high score requires an explicit cited signal — a named tool, vendor, pricing move, beta, or release — in the rationale; absent that, cap at 1. This ties the most-speculative dimension to evidence and is the main mis-routing guard, more so than the exact numeric cutoff.

3. **DISCARD = quarantine** (agreed with the original). Keep DISCARDs in the DB with the verdict set, excluded from synthesis by a `WHERE` filter — never hard-delete. You want to periodically audit that the gate isn't eating signal (false negatives), and quarantine is also the cheaper implementation (no deletion path; the scores already live on the row).

4. ✅ **FINALIZED (in body — `source_credibility` dimension; `source_tier` now in `sources.yaml` + validated in `src/ingest/sources.ts`).** *Move the `source_credibility` baseline into `sources.yaml`.* A per-source `source_tier` (first-party = 3, curated third-party = 2) is the baseline; the per-item `source_credibility` is seeded from it and the model adjusts per-item — downgrade only with a cited reason. The two terms are kept distinct (baseline vs. gate-read per-item value) so the Slice 3 prompt can't conflate them. Tiering scheme: first-party lab/release-notes = 3, all curated third-party = 2; nothing at 0–1, so the gate floor is reachable only by a cited per-item downgrade.

5. **`recency` may be redundant as a separate dimension.** The 30-day ingestion window (now live) already excludes the ">6–12 months obsolete" case upstream, and the "brand-new + unproven" case overlaps `evidence_strength` + `hype_markers`. Consider folding recency into those rather than carrying it separately.

6. **Slice 3 implementation notes.** The reserved `signal_score` / `signal_verdict` columns don't cover eight dimensions + `hype_markers` + rationale + claim/evidence snippets — Slice 3 adds dedicated columns (a migration, gated and reviewed as usual). Inject a short stack/goals preamble into the triage prompt so `applicability` and `composition_specificity` have the context they need.

**Sequencing:** this is the Slice 3–4 spec. **Slice 2 (dedup) is the next build** — Slice 4's clustering depends on its embeddings. Notes 1, 2, and 4 are now finalized (folded into the body; `source_tier` data + validation landed early to seed the baseline); notes 3, 5, and 6 remain decisions to settle before Slice 3.
