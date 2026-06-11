import {
  SECTION_ORDER,
  type SynthesisNarrative,
  synthesisNarrativeSchema,
} from "./doc.js";

// Typed fetch client for the Anthropic Messages API (Slice 4 synthesis). Mirrors
// src/triage/anthropic.ts exactly in shape — raw fetch over the documented REST
// endpoint (no SDK), structured output forced via a single tool (`emit_synthesis`)
// with tool_choice pinned to it, the tool input validated through the Zod gate in
// doc.ts before it can be used, a bounded timeout, and usage returned. No live call
// is made in tests. The model writes ONLY connective prose; it cannot add, remove,
// or reorder items (enforced by the tool schema — it has no item fields).

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const SYNTHESIS_TOOL_NAME = "emit_synthesis";

// Narrative prose for one doc: an executive summary plus up to four short section
// narratives. 4096 is ample headroom and bounds cost.
const SYNTHESIS_MAX_TOKENS = 4096;

const stringField = { type: "string" } as const;

// JSON Schema for the forced tool. Mirrors synthesisNarrativeSchema in doc.ts (the
// Zod schema is the authoritative validator; this shapes the model's tool call).
// Kept in sync by hand. section_narratives keys are exactly the verdict names; all
// optional (a key only for a non-empty section).
const SYNTHESIS_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    executive_summary: stringField,
    section_narratives: {
      type: "object",
      properties: Object.fromEntries(
        SECTION_ORDER.map((s) => [s, stringField]),
      ),
      additionalProperties: false,
    },
  },
  required: ["executive_summary", "section_narratives"],
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

export interface SynthesisCallResult {
  narrative: SynthesisNarrative;
  inputTokens: number;
  outputTokens: number;
}

// Generate the narrative blocks for one strategy doc. Throws on a non-2xx response,
// a missing emit_synthesis tool block, or output that fails the Zod gate — so the
// caller (scripts/synthesis.ts) writes NOTHING and exits non-zero (no partial doc).
// `fetchImpl` allows injecting a fetch in tests; defaults to global fetch.
export async function synthesizeNarrative(args: {
  system: string;
  userPrompt: string;
  model: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<SynthesisCallResult> {
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
      max_tokens: SYNTHESIS_MAX_TOKENS,
      system: args.system,
      messages: [{ role: "user", content: args.userPrompt }],
      tools: [
        {
          name: SYNTHESIS_TOOL_NAME,
          description:
            "Emit the executive summary and per-section narratives for the strategy doc. Call this exactly once.",
          input_schema: SYNTHESIS_TOOL_INPUT_SCHEMA,
        },
      ],
      // Force the model to call emit_synthesis so the response is structured JSON.
      tool_choice: { type: "tool", name: SYNTHESIS_TOOL_NAME },
    }),
    // Bound the request so a hung connection becomes a caught error.
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Anthropic API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as AnthropicResponse;
  const toolBlock = (json.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === SYNTHESIS_TOOL_NAME,
  );
  if (!toolBlock) {
    throw new Error(
      `Anthropic response had no ${SYNTHESIS_TOOL_NAME} tool_use block (stop_reason=${json.stop_reason ?? "?"})`,
    );
  }

  // The Zod gate — throws on a missing executive_summary or a non-string narrative.
  const narrative = synthesisNarrativeSchema.parse(toolBlock.input);

  return {
    narrative,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}
