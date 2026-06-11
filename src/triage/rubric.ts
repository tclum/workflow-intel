import { z } from "zod";

// Pure triage logic for Slice 3 — the EVAL_RUBRIC.md scoring contract expressed as
// code: the Zod output gate, the closed enums, verdict routing, the commoditization
// cap, source-credibility baseline seeding, and prompt building. No env / DB /
// network imports, so it is unit-testable offline (the Voyage pattern: pure helpers
// here, the API client in anthropic.ts, the DB wiring in scripts/triage.ts).
//
// The model SCORES; the code ROUTES. routeVerdict() — not the model's self-reported
// verdict — is the single integrity guard for the unconstrained signal_verdict
// column (the DB has no CHECK by design).

// --- Closed enums --------------------------------------------------------------

// Verdict buckets, in routing precedence order (first match wins). Order here is
// documentation only; routeVerdict() encodes the precedence explicitly.
export const VERDICTS = [
  "DISCARD",
  "ARCHIVE",
  "WAIT",
  "TRACK",
  "INVEST",
  "ADOPT-CHEAP",
] as const;
export type Verdict = (typeof VERDICTS)[number];
export const verdictSchema = z.enum(VERDICTS);

// Topic categorization, orthogonal to the verdict (EVAL_RUBRIC.md "Purpose"). The
// rubric enumerates four topic axes; "other" is a deliberate escape hatch so the
// closed enum never forces a wrong label onto an off-axis item.
export const TOPIC_CATEGORIES = [
  "prompting",
  "orchestration",
  "context",
  "token-efficiency",
  "other",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export const topicCategorySchema = z.enum(TOPIC_CATEGORIES);

// --- The cheap model's output contract (the DB's only validation boundary) ------

// 0–3 integer ordinal. Rejects out-of-range / non-integer / non-number before any
// value can reach the unconstrained smallint columns.
const ordinal = z.number().int().min(0).max(3);

export const triageOutputSchema = z.object({
  // Six scored rubric ordinals. source_credibility is the model's per-item value,
  // seeded from the source_tier baseline (see seedSourceCredibility).
  evidence_strength: ordinal,
  source_credibility: ordinal,
  durability: ordinal,
  commoditization_risk: ordinal,
  composition_specificity: ordinal,
  applicability: ordinal,
  // Dedicated field the commoditization cap keys off (adjustment a): the concrete
  // cited signal — a named tool/vendor/pricing move/beta/release. Empty string if
  // none. The cap heuristic runs on THIS field's contents, never on the prose.
  commoditization_signal: z.string(),
  // hype_markers: flagged, not scored.
  hype_markers: z.array(z.string()),
  // The model's self-reported verdict + flag. VALIDATED (must be a legal enum) but
  // NOT trusted for routing — the code re-derives both via routeVerdict(). Kept so
  // model-vs-router disagreement can be logged for calibration.
  verdict: verdictSchema,
  invest_flag: z.boolean(),
  category: topicCategorySchema,
  rationale: z.string(),
  claim: z.string(),
  evidence: z.string(),
});
export type TriageOutput = z.infer<typeof triageOutputSchema>;

// --- Commoditization cap (adjustment a) ----------------------------------------

// Patterns that count as a concrete commoditization signal, matched against the
// dedicated commoditization_signal field (not the rationale prose). Conservative:
// the field must name something checkable — a vendor/tool, a ship-state verb, a
// version string, or a URL. Absent any match we cap defensively and log.
const SIGNAL_VERBS =
  /\b(beta|general availability|\bga\b|roadmap|announc|launch|releas|ship|shipp|preview|early access|waitlist|pricing|priced|deprecat|rolling out|now available|built[- ]?in|first[- ]?party)\b/i;
const VERSION_STRING = /\bv?\d+\.\d+/;
const URL = /https?:\/\//i;
const NAMED_VENDORS =
  /\b(openai|anthropic|google|microsoft|github|copilot|cursor|vercel|amazon|aws|azure|gcp|meta|mistral|cohere|hugging\s?face|claude|chatgpt|gpt-\d|gemini|llama|langchain|llamaindex|notion|linear|slack|figma|supabase|next\.?js)\b/i;

const SIGNAL_PATTERNS = [SIGNAL_VERBS, VERSION_STRING, URL, NAMED_VENDORS];

// True only when the dedicated field plausibly cites a concrete signal. A near-empty
// or vague field returns false → the cap fires.
export function hasCitedCommoditizationSignal(signal: string): boolean {
  const s = signal.trim();
  if (s.length < 8) return false; // too short to be a real cited signal
  return SIGNAL_PATTERNS.some((p) => p.test(s));
}

export interface CommoditizationCap {
  risk: number;
  capped: boolean;
}

// Backstop for the rubric's "commoditization_risk ≥ 2 requires a cited signal else
// cap at 1" rule. Enforced in code, not just the prompt. Caller logs `capped`.
export function applyCommoditizationCap(
  risk: number,
  signal: string,
): CommoditizationCap {
  if (risk >= 2 && !hasCitedCommoditizationSignal(signal)) {
    return { risk: 1, capped: true };
  }
  return { risk, capped: false };
}

// --- Source-credibility baseline seeding ---------------------------------------

// Per-item source_credibility is seeded from the source's source_tier baseline. The
// baseline is a CEILING: the model may downgrade (only with a cited reason — trusted
// per the prompt instruction), but may not silently exceed the source's tier, so an
// above-baseline value is clamped back down. EVAL_RUBRIC.md: "may not silently
// override the baseline."
export function seedSourceCredibility(
  modelValue: number,
  baseline: number,
): number {
  return Math.min(modelValue, baseline);
}

// --- Verdict routing (first match wins) — the integrity guard -------------------

export interface RoutingInput {
  evidenceStrength: number;
  sourceCredibility: number;
  durability: number;
  commoditizationRisk: number;
  compositionSpecificity: number;
  applicability: number;
  hypeMarkers: string[];
}

// EVAL_RUBRIC.md "Verdict routing (first match wins)". Operates on the FINAL scores
// (after the commoditization cap and source-credibility seeding). "hype_markers
// present with no countervailing evidence" is operationalized as: any hype marker
// present AND evidence_strength ≤ 1 (low evidence = no countervailing evidence).
export function routeVerdict(s: RoutingInput): Verdict {
  if (
    (s.evidenceStrength <= 1 && s.sourceCredibility <= 1) ||
    (s.hypeMarkers.length > 0 && s.evidenceStrength <= 1)
  ) {
    return "DISCARD";
  }
  if (s.applicability <= 1) return "ARCHIVE";
  if (s.durability <= 1) return "WAIT";
  if (s.commoditizationRisk >= 2) return "TRACK";
  if (s.compositionSpecificity >= 2) return "INVEST";
  return "ADOPT-CHEAP";
}

// INVEST is a human-review candidate: the router raises the flag, it is never
// auto-committed. Derived from the routed verdict, not the model's self-report.
export function deriveInvestFlag(verdict: Verdict): boolean {
  return verdict === "INVEST";
}

// Slice-4 ranking key (EVAL_RUBRIC.md "Ranking within actionable buckets").
export function composite(s: {
  durability: number;
  compositionSpecificity: number;
  evidenceStrength: number;
  applicability: number;
  commoditizationRisk: number;
}): number {
  return (
    s.durability +
    s.compositionSpecificity +
    s.evidenceStrength +
    s.applicability -
    s.commoditizationRisk
  );
}

// --- Prompt building (pure) ----------------------------------------------------

// Stack/goals preamble (Slice 3 §c + Reviewer note 6) so `applicability` and
// `composition_specificity` have the context they need.
export const STACK_PREAMBLE = `Context for scoring:
Timothy is a solo founder running an agentic development workflow built on Claude Code (CC) + Codex, over a Next.js 15 / Supabase / Vercel TypeScript monorepo. "Applicability" means applicable to THAT specific workflow and stack — not generically interesting AI news. An item scores high on applicability ONLY if it changes how this specific operation builds or ships (e.g. cuts token spend, improves the CC/Codex loop, fits the TS/Supabase/Vercel stack). Generically interesting AI news that doesn't change how this operation works is low applicability.`;

// Maximum characters of item text sent to the triage model. Bounds per-item cost;
// well within Haiku's 200K context. Pure helper, mirrors prepareEmbedText.
export const TRIAGE_TEXT_CAP = 6000;

export function prepareTriageText(
  title: string | null | undefined,
  summary: string | null | undefined,
  rawContent: string | null | undefined,
  cap: number = TRIAGE_TEXT_CAP,
): string {
  const text = [title, summary, rawContent]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
  return text.length > cap ? text.slice(0, cap) : text;
}

export function buildTriageSystemPrompt(): string {
  return `You are a strict anti-hype triage scorer for an AI-workflow intelligence pipeline. Score one item against the rubric and emit your scores via the emit_triage tool ONLY. Be skeptical: a big claim with no number scores low.

${STACK_PREAMBLE}

Score these six 0–3 ordinals (anchored levels):
- evidence_strength: 0=bare assertion/anecdote generalized; 1=plausible, unverified; 2=reproducible signal (before/after, ablation, real numbers); 3=strong, quantified, reproducible.
- source_credibility: per-item credibility. You are GIVEN a baseline tier for this item's source. Start from the baseline. You may ONLY adjust it DOWNWARD, and only when you can state a concrete reason in your rationale (e.g. this specific post is an unsupported claim from an otherwise-credible source). Never score above the baseline.
- durability: 0=workaround for a current model limitation the next release likely erases; 2=survives model upgrades; 3=structural practice independent of capability.
- commoditization_risk: 0=no vendor would productize it; 2=plausibly on a roadmap; 3=obviously about to be a feature. A score of 2 or 3 REQUIRES a concrete cited signal — a named tool/vendor, pricing move, beta, or release — placed in the commoditization_signal field. If you cannot cite such a signal, score at most 1 and leave commoditization_signal empty.
- composition_specificity: 0=fully generic, value is in the method itself; 3=value is in how it composes into a specific stack (the monorepo, the CC+Codex split, the conventions) and compounds there.
- applicability: 0=irrelevant to the setup; 3=directly applicable, doubly so if it cuts token spend. (See the stack context above.)

Also emit:
- commoditization_signal: the concrete cited signal for commoditization_risk≥2, else "".
- hype_markers: array of superlative/hype phrases present ("10x", "game-changer", "secret", "nobody's talking about", product-pitch framing, claims contradicting how models work). Empty if none.
- verdict: your best guess of the bucket (the pipeline re-derives this in code; your value is advisory).
- invest_flag: advisory boolean.
- category: one of prompting | orchestration | context | token-efficiency | other. Use "other" ONLY when none of the first four genuinely fit — do not default to it; pick the closest real axis when one applies.
- rationale: one line justifying the scores (include any source_credibility downgrade reason).
- claim: the item's core claim, extracted.
- evidence: the strongest evidence the item offers for that claim (or "" if none).`;
}

export function buildTriageUserPrompt(
  item: { title?: string | null; summary?: string | null; rawContent?: string | null },
  sourceTierBaseline: number,
): string {
  const body = prepareTriageText(item.title, item.summary, item.rawContent);
  return `source_credibility baseline (source_tier) for this item: ${sourceTierBaseline} (you may only adjust downward, with a cited reason).

ITEM:
${body}`;
}
