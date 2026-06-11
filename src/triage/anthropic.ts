import {
  TOPIC_CATEGORIES,
  type TriageOutput,
  triageOutputSchema,
  VERDICTS,
} from "./rubric.js";

// Typed fetch client for the Anthropic Messages API (Slice 3 triage). Thin wrapper
// over the documented REST endpoint rather than the SDK — same rationale as the
// Voyage client (no added dependency; explicit control over the request + per-call
// error isolation). Structured output is forced via a single tool (`emit_triage`)
// with tool_choice pinned to it; the tool's input is validated through the Zod gate
// in rubric.ts before it can reach the DB. No live call is made in tests.

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TRIAGE_TOOL_NAME = "emit_triage";

// Triage output is small (scores + short strings); 1024 is ample headroom.
const TRIAGE_MAX_TOKENS = 1024;

const ordinalSchema = { type: "integer", minimum: 0, maximum: 3 } as const;

// JSON Schema for the forced tool. Mirrors triageOutputSchema in rubric.ts (the Zod
// schema is the authoritative validator; this shapes the model's tool call). Kept in
// sync by hand — both list the same fields.
const TRIAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    evidence_strength: ordinalSchema,
    source_credibility: ordinalSchema,
    durability: ordinalSchema,
    commoditization_risk: ordinalSchema,
    composition_specificity: ordinalSchema,
    applicability: ordinalSchema,
    commoditization_signal: { type: "string" },
    hype_markers: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: [...VERDICTS] },
    invest_flag: { type: "boolean" },
    category: { type: "string", enum: [...TOPIC_CATEGORIES] },
    rationale: { type: "string" },
    claim: { type: "string" },
    evidence: { type: "string" },
  },
  required: [
    "evidence_strength",
    "source_credibility",
    "durability",
    "commoditization_risk",
    "composition_specificity",
    "applicability",
    "commoditization_signal",
    "hype_markers",
    "verdict",
    "invest_flag",
    "category",
    "rationale",
    "claim",
    "evidence",
  ],
} as const;

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export interface TriageCallResult {
  output: TriageOutput;
  inputTokens: number;
  outputTokens: number;
}

// Score one item. Throws on a non-2xx response, a missing emit_triage tool block,
// or output that fails the Zod gate — so the caller can mark this item failed and
// let the idempotent re-run (triaged_at IS NULL) retry it. `signal` allows the
// caller to inject a fetch implementation in tests; defaults to global fetch.
export async function triageItem(args: {
  system: string;
  userPrompt: string;
  model: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<TriageCallResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const res = await doFetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": args.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: TRIAGE_MAX_TOKENS,
      system: args.system,
      messages: [{ role: "user", content: args.userPrompt }],
      tools: [
        {
          name: TRIAGE_TOOL_NAME,
          description:
            "Emit the anti-hype triage scores for one item. Call this exactly once.",
          input_schema: TRIAGE_TOOL_INPUT_SCHEMA,
        },
      ],
      // Force the model to call emit_triage so the response is structured JSON.
      tool_choice: { type: "tool", name: TRIAGE_TOOL_NAME },
    }),
    // Bound each request so a hung connection becomes a caught error (the caller
    // marks the item failed; the idempotent re-run retries it).
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Anthropic API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as AnthropicResponse;
  const toolBlock = (json.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === TRIAGE_TOOL_NAME,
  );
  if (!toolBlock) {
    throw new Error(
      `Anthropic response had no ${TRIAGE_TOOL_NAME} tool_use block (stop_reason=${json.stop_reason ?? "?"})`,
    );
  }

  // The Zod gate — the DB's only validation boundary. Throws on out-of-range
  // ordinals, a bad verdict/category enum, or a missing field.
  const output = triageOutputSchema.parse(toolBlock.input);

  return {
    output,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}
