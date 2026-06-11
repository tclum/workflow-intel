import { describe, expect, it } from "vitest";
import { triageItem } from "../src/triage/anthropic.js";
import {
  applyCommoditizationCap,
  buildTriageUserPrompt,
  composite,
  deriveInvestFlag,
  hasCitedCommoditizationSignal,
  type RoutingInput,
  routeVerdict,
  seedSourceCredibility,
  type TriageOutput,
  triageOutputSchema,
} from "../src/triage/rubric.js";

// A valid model-output object; tests clone and mutate it.
function validOutput(over: Partial<TriageOutput> = {}): TriageOutput {
  return {
    evidence_strength: 2,
    source_credibility: 2,
    durability: 2,
    commoditization_risk: 0,
    composition_specificity: 0,
    applicability: 2,
    commoditization_signal: "",
    hype_markers: [],
    verdict: "ADOPT-CHEAP",
    invest_flag: false,
    category: "orchestration",
    rationale: "reproducible before/after numbers",
    claim: "X improves Y",
    evidence: "benchmark table",
    ...over,
  };
}

// Routing scores with all-passing defaults (lands on ADOPT-CHEAP); override per case.
function routing(over: Partial<RoutingInput> = {}): RoutingInput {
  return {
    evidenceStrength: 3,
    sourceCredibility: 3,
    durability: 3,
    commoditizationRisk: 0,
    compositionSpecificity: 0,
    applicability: 3,
    hypeMarkers: [],
    ...over,
  };
}

describe("triageOutputSchema (the Zod gate)", () => {
  it("accepts a well-formed output", () => {
    expect(() => triageOutputSchema.parse(validOutput())).not.toThrow();
  });

  it("rejects an ordinal above 3", () => {
    expect(() =>
      triageOutputSchema.parse(validOutput({ evidence_strength: 4 })),
    ).toThrow();
  });

  it("rejects a negative ordinal", () => {
    expect(() =>
      triageOutputSchema.parse(validOutput({ durability: -1 })),
    ).toThrow();
  });

  it("rejects a non-integer ordinal", () => {
    expect(() =>
      triageOutputSchema.parse(validOutput({ applicability: 2.5 })),
    ).toThrow();
  });

  it("rejects an unknown verdict enum value", () => {
    expect(() =>
      triageOutputSchema.parse(validOutput({ verdict: "MAYBE" as never })),
    ).toThrow();
  });

  it("rejects an unknown category enum value", () => {
    expect(() =>
      triageOutputSchema.parse(validOutput({ category: "memes" as never })),
    ).toThrow();
  });

  it("rejects a missing field", () => {
    const obj = validOutput();
    delete (obj as Record<string, unknown>).rationale;
    expect(() => triageOutputSchema.parse(obj)).toThrow();
  });

  it("rejects hype_markers that is not a string array", () => {
    expect(() =>
      triageOutputSchema.parse(validOutput({ hype_markers: "10x" as never })),
    ).toThrow();
  });
});

describe("routeVerdict — per-bucket entry conditions", () => {
  it("DISCARD when evidence ≤ 1 AND source_credibility ≤ 1", () => {
    expect(
      routeVerdict(routing({ evidenceStrength: 1, sourceCredibility: 1 })),
    ).toBe("DISCARD");
  });

  it("DISCARD on hype only when evidence ≤ 1 AND source_credibility ≤ 1 (calibrated)", () => {
    expect(
      routeVerdict(
        routing({ evidenceStrength: 1, sourceCredibility: 1, hypeMarkers: ["10x"] }),
      ),
    ).toBe("DISCARD");
  });

  it("a CREDIBLE source with hype + low evidence is NOT discarded — ARCHIVE when applicability ≤ 1", () => {
    // The ~86 tier-3 calibration case: high source_credibility shields the hype clause,
    // so a credible-but-inapplicable announcement lands in ARCHIVE, not DISCARD.
    expect(
      routeVerdict(
        routing({
          evidenceStrength: 1,
          sourceCredibility: 3,
          hypeMarkers: ["10x"],
          applicability: 1,
        }),
      ),
    ).toBe("ARCHIVE");
  });

  it("a credible, applicable item with hype + low evidence survives the hype clause", () => {
    expect(
      routeVerdict(
        routing({
          evidenceStrength: 1,
          sourceCredibility: 3,
          hypeMarkers: ["10x"],
          applicability: 3,
        }),
      ),
    ).toBe("ADOPT-CHEAP");
  });

  it("does NOT discard on hype when evidence ≥ 2 (countervailing evidence present)", () => {
    expect(
      routeVerdict(
        routing({ evidenceStrength: 2, sourceCredibility: 3, hypeMarkers: ["10x"] }),
      ),
    ).toBe("ADOPT-CHEAP");
  });

  it("ARCHIVE when applicability ≤ 1", () => {
    expect(routeVerdict(routing({ applicability: 1 }))).toBe("ARCHIVE");
  });

  it("WAIT when durability ≤ 1", () => {
    expect(routeVerdict(routing({ durability: 1 }))).toBe("WAIT");
  });

  it("TRACK when commoditization_risk ≥ 2", () => {
    expect(routeVerdict(routing({ commoditizationRisk: 2 }))).toBe("TRACK");
  });

  it("INVEST when composition_specificity ≥ 2 AND evidence ≥ 2 (the floor)", () => {
    expect(
      routeVerdict(routing({ compositionSpecificity: 2, evidenceStrength: 2 })),
    ).toBe("INVEST");
  });

  it("comp ≥ 2 but ev ≤ 1 falls through to ADOPT-CHEAP, not INVEST (the floor keeps the ev=1 tail out of the human queue)", () => {
    // applicability ≥ 2 so it clears the ARCHIVE gate; sourceCredibility ≥ 2 so the
    // ev≤1 DISCARD clause does not fire. Pre-floor this routed INVEST.
    expect(
      routeVerdict(
        routing({
          compositionSpecificity: 2,
          evidenceStrength: 1,
          sourceCredibility: 3,
          applicability: 2,
        }),
      ),
    ).toBe("ADOPT-CHEAP");
  });

  it("ADOPT-CHEAP otherwise (real but generic)", () => {
    expect(routeVerdict(routing())).toBe("ADOPT-CHEAP");
  });
});

describe("routeVerdict — first-match-wins precedence (the integrity guard)", () => {
  // Each case satisfies MULTIPLE bucket conditions; the EARLIER bucket must win.
  it("DISCARD beats every later bucket it also qualifies for", () => {
    // also qualifies for ARCHIVE, WAIT, TRACK (not INVEST — ev=0 is below the floor)
    expect(
      routeVerdict({
        evidenceStrength: 0,
        sourceCredibility: 0,
        durability: 0,
        commoditizationRisk: 3,
        compositionSpecificity: 3,
        applicability: 0,
        hypeMarkers: ["game-changer"],
      }),
    ).toBe("DISCARD");
  });

  it("ARCHIVE beats WAIT/TRACK/INVEST when applicability ≤ 1 and those also hold", () => {
    expect(
      routeVerdict(
        routing({
          applicability: 1,
          durability: 0, // would be WAIT
          commoditizationRisk: 3, // would be TRACK
          compositionSpecificity: 3, // would be INVEST (ev ≥ 2 clears the floor)
          evidenceStrength: 2,
        }),
      ),
    ).toBe("ARCHIVE");
  });

  it("WAIT beats TRACK/INVEST when durability ≤ 1 and those also hold", () => {
    expect(
      routeVerdict(
        routing({
          durability: 1,
          commoditizationRisk: 3, // would be TRACK
          compositionSpecificity: 3, // would be INVEST (ev ≥ 2 clears the floor)
          evidenceStrength: 2,
        }),
      ),
    ).toBe("WAIT");
  });

  it("TRACK beats INVEST when commoditization ≥ 2 and composition ≥ 2 both hold", () => {
    // ev ≥ 2 so INVEST is genuinely reachable (clears the floor); TRACK must still win.
    expect(
      routeVerdict(
        routing({
          commoditizationRisk: 2,
          compositionSpecificity: 3,
          evidenceStrength: 2,
        }),
      ),
    ).toBe("TRACK");
  });
});

describe("deriveInvestFlag — INVEST raises a flag, never auto-commits", () => {
  it("raises the flag only for the INVEST verdict", () => {
    expect(deriveInvestFlag("INVEST")).toBe(true);
    for (const v of ["DISCARD", "ARCHIVE", "WAIT", "TRACK", "ADOPT-CHEAP"] as const) {
      expect(deriveInvestFlag(v)).toBe(false);
    }
  });

  it("an INVEST item still receives the INVEST verdict bucket (flagged, not dropped)", () => {
    const verdict = routeVerdict(routing({ compositionSpecificity: 2 }));
    expect(verdict).toBe("INVEST");
    expect(deriveInvestFlag(verdict)).toBe(true);
  });
});

describe("applyCommoditizationCap — ≥2 requires a cited signal", () => {
  it("caps risk 2 → 1 when the signal field is empty", () => {
    expect(applyCommoditizationCap(2, "")).toEqual({ risk: 1, capped: true });
  });

  it("caps risk 3 → 1 when the signal field is vague (no concrete signal)", () => {
    expect(applyCommoditizationCap(3, "probably soon")).toEqual({
      risk: 1,
      capped: true,
    });
  });

  it("leaves risk 2 unchanged when a concrete signal is cited", () => {
    expect(
      applyCommoditizationCap(2, "OpenAI announced this in their dev day keynote"),
    ).toEqual({ risk: 2, capped: false });
  });

  it("never caps risk below 2 (0 and 1 pass through untouched)", () => {
    expect(applyCommoditizationCap(0, "")).toEqual({ risk: 0, capped: false });
    expect(applyCommoditizationCap(1, "")).toEqual({ risk: 1, capped: false });
  });
});

describe("hasCitedCommoditizationSignal — heuristic on the dedicated field", () => {
  it("accepts named vendors, ship-state verbs, version strings, and URLs", () => {
    expect(hasCitedCommoditizationSignal("GitHub Copilot shipped this")).toBe(true);
    expect(hasCitedCommoditizationSignal("now in public beta")).toBe(true);
    expect(hasCitedCommoditizationSignal("Cursor v0.42 release notes")).toBe(true);
    expect(hasCitedCommoditizationSignal("see https://vercel.com/changelog")).toBe(
      true,
    );
  });

  it("rejects empty, too-short, or vague fields", () => {
    expect(hasCitedCommoditizationSignal("")).toBe(false);
    expect(hasCitedCommoditizationSignal("soon")).toBe(false);
    expect(hasCitedCommoditizationSignal("maybe someday")).toBe(false);
  });
});

describe("seedSourceCredibility — baseline is a ceiling", () => {
  it("clamps an above-baseline model value down to the baseline", () => {
    expect(seedSourceCredibility(3, 2)).toBe(2);
  });

  it("allows a downgrade below the baseline (trusted per prompt)", () => {
    expect(seedSourceCredibility(1, 3)).toBe(1);
  });

  it("passes an at-baseline value through unchanged", () => {
    expect(seedSourceCredibility(2, 2)).toBe(2);
  });
});

describe("composite — Slice-4 ranking key", () => {
  it("= durability + composition + evidence + applicability − commoditization", () => {
    expect(
      composite({
        durability: 3,
        compositionSpecificity: 2,
        evidenceStrength: 3,
        applicability: 3,
        commoditizationRisk: 1,
      }),
    ).toBe(10);
  });
});

describe("buildTriageUserPrompt", () => {
  it("includes the source_tier baseline and the item text", () => {
    const prompt = buildTriageUserPrompt(
      { title: "T", summary: "S", rawContent: null },
      3,
    );
    expect(prompt).toContain("baseline (source_tier) for this item: 3");
    expect(prompt).toContain("T");
    expect(prompt).toContain("S");
  });
});

// --- API boundary, mocked (no live LLM call) -----------------------------------

function fakeFetch(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
): typeof fetch {
  const { ok = true, status = 200, statusText = "OK" } = init;
  return (async () =>
    ({
      ok,
      status,
      statusText,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response) as unknown as typeof fetch;
}

function toolUseResponse(input: unknown) {
  return {
    content: [{ type: "tool_use", name: "emit_triage", input }],
    usage: { input_tokens: 123, output_tokens: 45 },
    stop_reason: "tool_use",
  };
}

const callArgs = {
  system: "sys",
  userPrompt: "user",
  model: "claude-haiku-4-5",
  apiKey: "test-key",
};

describe("triageItem — API client (mocked boundary)", () => {
  it("parses a forced tool_use block and returns validated output + usage", async () => {
    const res = await triageItem({
      ...callArgs,
      fetchImpl: fakeFetch(toolUseResponse(validOutput({ verdict: "WAIT" }))),
    });
    expect(res.output.verdict).toBe("WAIT");
    expect(res.inputTokens).toBe(123);
    expect(res.outputTokens).toBe(45);
  });

  it("throws (Zod) when the tool input is out of range", async () => {
    await expect(
      triageItem({
        ...callArgs,
        fetchImpl: fakeFetch(toolUseResponse(validOutput({ durability: 9 }))),
      }),
    ).rejects.toThrow();
  });

  it("throws on a non-2xx response", async () => {
    await expect(
      triageItem({
        ...callArgs,
        fetchImpl: fakeFetch(
          { error: "rate limited" },
          { ok: false, status: 429, statusText: "Too Many Requests" },
        ),
      }),
    ).rejects.toThrow(/429/);
  });

  it("throws when no emit_triage tool block is present", async () => {
    await expect(
      triageItem({
        ...callArgs,
        fetchImpl: fakeFetch({
          content: [{ type: "text", text: "no tool call" }],
          stop_reason: "end_turn",
        }),
      }),
    ).rejects.toThrow(/emit_triage/);
  });
});
