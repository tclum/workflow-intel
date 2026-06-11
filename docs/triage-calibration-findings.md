# Triage Calibration — Findings From The Slice 3 Cheap-Model Routing Arc

> **What this is.** Operational learning from calibrating the Slice 3 triage
> pipeline (2026-06-10/11, three live runs, ~$2 total in cheap-model tokens). It
> sits alongside `concurrent-tool-workflow-findings.md` as a discipline note —
> but where that doc is about *cross-process* safety, this one is about a
> *single*, recurring epistemic failure: ratifying claims about deterministic
> logic on abstract reasoning instead of tracing the code or reading the output.
>
> **Authoring vantage (important for honesty):** this is written by the
> **implementer process** (CC), the directed agent that built the routing changes
> and ran the triage passes. The recurring failure documented here originated
> with the **architectural reviewer** (browser-Claude), and the implementer was
> the actor positioned to catch it — so the account is not neutral. It is stated
> plainly because the lesson is *about the division of labor that caught the
> error*, and getting the roles wrong would invalidate it. The reviewer's
> direction was sound on judgment calls; the failures were specifically on
> objective claims about the routing mechanism.
>
> **Bottom line up front.** Three times in one short arc, a confident, correct-
> *sounding* claim about deterministic routing logic was wrong, and each was
> caught not by anyone's self-review but by a *different actor doing a concrete
> check* — reading the model's actual rationales, tracing the routing order, and
> premise-checking the schema. The mechanism that felt most self-evident
> (objective claims about a deterministic code path) was exactly the one that
> needed verification most. The process — distributed, concrete verification —
> *is* the introspection. No single actor's reasoning substitutes for it.

---

## 1. Provenance

- **Slice:** Slice 3 — cheap-model triage against `EVAL_RUBRIC.md` (code routes;
  the model only scores).
- **Dates:** 2026-06-10 / 2026-06-11.
- **Runs:** three full passes over 150 items, ~$2 total in cheap-model
  (`claude-haiku-4-5`) tokens.
- **Actors:** architectural reviewer (browser-Claude) specifying direction;
  implementer (CC) building, tracing, and running.

## 2. The recurring failure — abstract reasoning about a deterministic mechanism

All three instances share one shape: **a claim about load-bearing deterministic
logic, asserted (or ruled out) by reasoning about how the mechanism *should*
behave, that a concrete check then falsified.** All three originated with the
reviewer. All three were caught by the process, not by self-review.

### 2.1 The hype DISCARD clause "correct by design" — twice

The reviewer twice defended the hype-marker DISCARD clause's ignoring of
`source_credibility` as correct-by-design — the clause should kill hype
regardless of who published it. The defense was abstract: it reasoned about what
the clause was *for*, not about what it *did* to the corpus.

**The concrete check that settled it:** reading the model's own rationales on
run 1. The clause was quarantining **~86 credible-source items to DISCARD that
the model itself had argued for ARCHIVE** — routine first-party launch
vocabulary on low-evidence items, from sources the rubric trusts. The fix the
reviewer had explicitly ruled out — gating the clause on `source_credibility ≤
1` — was the correct one. Reading output beat reasoning about the rule, twice
over the same rule.

### 2.2 `applicability ≥ 2` as an INVEST condition — a tautology

The reviewer specced `applicability ≥ 2` as an INVEST entry condition. Sounds
reasonable in isolation: invest only in applicable items.

**The concrete check:** the implementer traced the routing order *before*
building. `routeVerdict()` is first-match-wins, and the `applicability ≤ 1 →
ARCHIVE` branch sits **upstream** of the INVEST branch. Any item still live at
the INVEST test has *already* cleared `applicability ≥ 2`. The condition was a
tautology and the test the reviewer requested was **unwritable** — it could not
distinguish pass from fail because no reaching input could fail it. Tracing the
order, not reasoning about the predicate, exposed it.

### 2.3 Queries against a `model_verdict` column that didn't exist

The reviewer requested disagreement queries against a `model_verdict` column —
**and had personally documented, in a prior code review, that this column did
not exist** (the model's self-verdict was validated then discarded; only the
routed `signal_verdict` was persisted).

**The concrete check:** the implementer premise-checked the schema before
writing the query, against current state rather than the request's assumption.
The column was absent; the query was impossible as written. The signal the
reviewer wanted was instead *recovered from the rationale prose* on the INVEST
rows — and the durable fix (persist `model_verdict` for real) became its own
gated changeset. This is the corollary in action: **a prior finding is a claim,
and it must be verified against the current state, not recalled from memory** —
even when the finding was one's own.

## 3. The principle

**The process is the introspection.** None of these were caught by an actor
reviewing their own reasoning harder. Each was caught by a *different* concrete
act of verification:

- reading the model's actual rationales (§2.1),
- tracing the routing order (§2.2),
- premise-checking the schema (§2.3).

The through-line: **objective claims feel self-certifying precisely because
they're objective.** "The clause discards hype regardless of source" /
"applicability gates INVEST" / "query the model_verdict column" all *sound*
like statements of fact, and that very quality suppresses the impulse to check
them. But a claim being objective is what makes it *checkable*, not what makes
it *true* — and the load-bearing ones are exactly where an unchecked-but-wrong
claim does the most damage. **Distributed verification catches what no single
actor's self-review does**, because the failure is not a reasoning error the
reasoner can introspect away; it's the absence of contact with the artifact.

This is the basis for **RULE 7** in the cross-project `CLAUDE.md`: trace or read
output for deterministic claims; never ratify on abstract reasoning, regardless
of source — including the reviewer's, and including one's own prior findings.

## 4. Calibration outcomes (for reference)

| State | Shape |
| --- | --- |
| **Run 1 (degenerate)** | ~72% DISCARD, **3 dead buckets** (never routed), 8 Zod rejects. The hype clause + low-evidence first-party corpus collapsed the distribution. |
| **Post-calibration (healthy)** | **6 live buckets**; tier-3 DISCARDs **86 → 0** (the `cred ≤ 1` gate from §2.1); Zod rejects **8 → 1**. |
| **INVEST evidence floor** | Added `evidence_strength ≥ 2` to the INVEST branch; evicted the `ev ≤ 1` tail whose own rationales self-described ARCHIVE/TRACK/WAIT. INVEST queue 7 → 5. |
| **`model_verdict` persisted** | The §2.3 fix: advisory model self-verdict now stored, so model-vs-router disagreement is queryable per-row (80 disagreements on the final run, reproducing the in-run counter exactly). |

**Final state, by design:**

- The **INVEST queue is 100% router-originated** — on the final run the model
  self-verdicted INVEST on *zero* of the 5 surviving INVEST rows (3 ADOPT-CHEAP,
  1 ARCHIVE, 1 TRACK). This is **intended**: the router exists to surface what
  the cheap model *under-calls*. Model concurrence is deliberately **not**
  required for INVEST.
- **Further threshold tuning is deferred** until adjudication data accumulates
  real true positives. The future calibration set is `model_verdict` + human
  dispositions on the surfaced INVEST queue — i.e., calibrate against decisions,
  not against the cheap model's self-agreement, which would just relax the
  router toward the model it's meant to backstop.

## 5. What to carry forward

- **Trace deterministic logic before asserting about it** (RULE 7). Routing
  order, gate predicates, and threshold effects are all traceable or
  observable; none should be ratified on "it should behave like X."
- **Premise-check requests against current state**, especially queries naming
  specific columns/flags/files — and most especially when a prior finding (even
  your own) is the source of the premise.
- **Read the model's output, not just its scores.** The decisive evidence in
  §2.1 and in the INVEST-floor decision was in the *rationale prose*, which
  routing ordinals alone did not reveal.
- **Calibrate the router against human dispositions, not model self-agreement.**
  The router's value is precisely where it diverges from the cheap model.
