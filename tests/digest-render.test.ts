import { describe, expect, it } from "vitest";
import { renderWorkflowDigest } from "../src/digest/render.js";

const markdown = `# Workflow Intelligence — Strategy

## Executive summary

Timothy should keep investing in verification gates and treat vendor orchestration announcements as cheap adoption work.

## Build / integrate now

Body omitted.`;

describe("renderWorkflowDigest", () => {
  it("builds the weekly subject, compact HTML, text fallback, and INVEST queue", () => {
    const rendered = renderWorkflowDigest({
      generatedAt: "2026-06-11T23:00:00.000Z",
      synthesisModel: "claude-opus-4-8",
      strategyMarkdown: markdown,
      sectionCounts: {
        INVEST: 2,
        "ADOPT-CHEAP": 5,
        TRACK: 3,
        WAIT: 1,
      },
      investQueue: [
        {
          title: "Agent diff gate <unsafe>",
          source: "lab-notes",
          routedVerdict: "INVEST",
          modelVerdict: "ADOPT-CHEAP",
        },
      ],
    });

    expect(rendered.subject).toBe("Workflow Intel — week of 2026-06-11");
    expect(rendered.html).toContain('role="presentation" width="600"');
    expect(rendered.html).not.toContain("<style>");
    expect(rendered.html).not.toContain("class=");
    expect(rendered.html).not.toContain("<ul>");
    expect(rendered.html).toContain("Timothy should keep investing");
    expect(rendered.html).toContain("Workflow Intel");
    expect(rendered.html).toContain("2026-06-11");
    expect(rendered.html).toContain("INVEST");
    expect(rendered.html).toContain("ADOPT-CHEAP");
    expect(rendered.html).toContain("Track");
    expect(rendered.html).toContain("Wait");
    expect(rendered.html).toContain(">2</div>");
    expect(rendered.html).toContain("routed INVEST");
    expect(rendered.html).toContain("model ADOPT-CHEAP");
    expect(rendered.html).toContain("review mismatch");
    expect(rendered.html).toContain("Open the full strategy →");
    expect(rendered.html).toContain("https://intel.forpono.com");
    expect(rendered.html).toContain("generated-at: 2026-06-11T23:00:00.000Z");
    expect(rendered.html).toContain("synthesis model: claude-opus-4-8");
    expect(rendered.html).toContain(
      "automated weekly digest — reply to tclum@hawaii.edu",
    );
    expect(rendered.html).toContain("Agent diff gate &lt;unsafe&gt;");
    expect(rendered.html).not.toContain("Agent diff gate <unsafe>");
    expect(rendered.text).toContain("Section counts");
    expect(rendered.text).toContain("- INVEST: 2");
    expect(rendered.text).toContain("Open the full strategy: https://intel.forpono.com");
    expect(rendered.text).toContain("Synthesis model: claude-opus-4-8");
  });

  it("renders an empty INVEST queue without dropping the section", () => {
    const rendered = renderWorkflowDigest({
      generatedAt: new Date("2026-06-12T10:00:00.000Z"),
      synthesisModel: "claude-opus-4-8",
      strategyMarkdown: "## Executive summary\n\nShort version.",
      sectionCounts: {
        INVEST: 0,
        "ADOPT-CHEAP": 1,
        TRACK: 0,
        WAIT: 0,
      },
      investQueue: [],
    });

    expect(rendered.html).toContain("No INVEST candidates are currently queued.");
    expect(rendered.text).toContain("INVEST queue\n- None");
  });

  it("caps the INVEST queue at six rows with an overflow note", () => {
    const rendered = renderWorkflowDigest({
      generatedAt: "2026-06-12T10:00:00.000Z",
      synthesisModel: "claude-opus-4-8",
      strategyMarkdown: markdown,
      sectionCounts: {
        INVEST: 7,
        "ADOPT-CHEAP": 0,
        TRACK: 0,
        WAIT: 0,
      },
      investQueue: Array.from({ length: 7 }, (_, i) => ({
        title: `Candidate ${i + 1}`,
        source: "lab-notes",
        routedVerdict: "INVEST",
        modelVerdict: i === 0 ? "INVEST" : "ADOPT-CHEAP",
      })),
    });

    expect(rendered.html).toContain("Candidate 1");
    expect(rendered.html).toContain("Candidate 6");
    expect(rendered.html).not.toContain("Candidate 7");
    expect(rendered.html).toContain("and 1 more");
    expect(rendered.text).toContain("- and 1 more");
  });

  it("throws on an invalid generatedAt value", () => {
    expect(() =>
      renderWorkflowDigest({
        generatedAt: "not-a-date",
        synthesisModel: "claude-opus-4-8",
        strategyMarkdown: markdown,
        sectionCounts: {
          INVEST: 0,
          "ADOPT-CHEAP": 0,
          TRACK: 0,
          WAIT: 0,
        },
        investQueue: [],
      }),
    ).toThrow(/invalid generatedAt/);
  });
});
