import { describe, expect, it } from "vitest";
import { synthesizeNarrative } from "../src/synthesis/anthropic.js";

// Build a fetch stub returning a JSON Response with the given status + body.
function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const call = (fetchImpl: typeof fetch) =>
  synthesizeNarrative({
    system: "sys",
    userPrompt: "user",
    model: "claude-opus-4-8",
    apiKey: "k",
    fetchImpl,
  });

describe("synthesizeNarrative", () => {
  it("parses a well-formed emit_synthesis tool call and returns usage", async () => {
    const res = await call(
      mockFetch(200, {
        content: [
          {
            type: "tool_use",
            name: "emit_synthesis",
            input: {
              executive_summary: "the summary",
              section_narratives: { INVEST: "inv", WAIT: "wait" },
            },
          },
        ],
        usage: { input_tokens: 11, output_tokens: 22 },
      }),
    );
    expect(res.narrative.executive_summary).toBe("the summary");
    expect(res.narrative.section_narratives.INVEST).toBe("inv");
    expect(res.inputTokens).toBe(11);
    expect(res.outputTokens).toBe(22);
  });

  it("throws when there is no emit_synthesis tool block", async () => {
    await expect(
      call(
        mockFetch(200, {
          content: [{ type: "text", text: "no tool here" }],
          stop_reason: "end_turn",
        }),
      ),
    ).rejects.toThrow(/no emit_synthesis tool_use block/);
  });

  it("throws when the tool input fails the Zod gate (missing executive_summary)", async () => {
    await expect(
      call(
        mockFetch(200, {
          content: [
            {
              type: "tool_use",
              name: "emit_synthesis",
              input: { section_narratives: { INVEST: "inv" } },
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("throws on a non-2xx response with the status in the message", async () => {
    await expect(
      call(mockFetch(500, { error: "boom" })),
    ).rejects.toThrow(/Anthropic API 500/);
  });
});
