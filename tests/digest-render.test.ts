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
    expect(rendered.html).toContain("Timothy should keep investing");
    expect(rendered.html).toContain("<td>2</td>");
    expect(rendered.html).toContain("routed INVEST vs model ADOPT-CHEAP");
    expect(rendered.html).toContain("https://intel.forpono.com");
    expect(rendered.html).toContain("Agent diff gate &lt;unsafe&gt;");
    expect(rendered.html).not.toContain("Agent diff gate <unsafe>");
    expect(rendered.text).toContain("Section counts");
    expect(rendered.text).toContain("- Invest queue: 2");
  });

  it("renders an empty INVEST queue without dropping the section", () => {
    const rendered = renderWorkflowDigest({
      generatedAt: new Date("2026-06-12T10:00:00.000Z"),
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

  it("throws on an invalid generatedAt value", () => {
    expect(() =>
      renderWorkflowDigest({
        generatedAt: "not-a-date",
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
