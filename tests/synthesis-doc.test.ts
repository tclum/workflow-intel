import { describe, expect, it } from "vitest";
import {
  buildSynthesisUserPrompt,
  type DocMeta,
  planSections,
  renderDoc,
  SECTION_HEADINGS,
  SECTION_ORDER,
  type SynthesisItem,
  type SynthesisNarrative,
} from "../src/synthesis/doc.js";

// A baseline eligible item (composite = 2+0+2+2-0 = 6); tests clone and mutate.
function item(over: Partial<SynthesisItem> = {}): SynthesisItem {
  return {
    id: "x",
    title: "Title",
    source: "src",
    verdict: "ADOPT-CHEAP",
    modelVerdict: "ADOPT-CHEAP",
    evidenceStrength: 2,
    sourceCredibility: 2,
    durability: 2,
    commoditizationRisk: 0,
    compositionSpecificity: 0,
    applicability: 2,
    claim: "claim",
    evidence: "evidence",
    rationale: "rationale",
    publishedAt: 1000,
    ...over,
  };
}

const meta: DocMeta = {
  generatedAt: "2026-06-11T00:00:00.000Z",
  synthesisModel: "claude-opus-4-8",
  threshold: 0.75,
  eligibleCount: 5,
  clusterCount: 4,
};

const narrative: SynthesisNarrative = {
  executive_summary: "Executive summary prose.",
  section_narratives: { INVEST: "invest narrative", "ADOPT-CHEAP": "adopt narrative" },
};

describe("planSections", () => {
  it("places each cluster's topic in its exemplar's section", () => {
    const inv = item({ id: "a", verdict: "INVEST" });
    const adopt = item({ id: "b", verdict: "ADOPT-CHEAP" });
    const track = item({ id: "c", verdict: "TRACK" });
    const wait = item({ id: "d", verdict: "WAIT" });
    const plan = planSections(
      [inv, adopt, track, wait],
      [["a"], ["b"], ["c"], ["d"]],
    );
    expect(plan.map((p) => p.section)).toEqual([...SECTION_ORDER]);
    expect(plan.map((p) => p.entries.length)).toEqual([1, 1, 1, 1]);
    expect(plan[0]!.entries[0]!.exemplar.id).toBe("a");
  });

  it("INVEST exemption: an INVEST item collapsed inside a non-INVEST cluster still appears in INVEST", () => {
    // win (ADOPT-CHEAP, composite 7) beats inv (INVEST, composite 6) for exemplar.
    const win = item({ id: "win", verdict: "ADOPT-CHEAP", applicability: 3 });
    const inv = item({ id: "inv", verdict: "INVEST" });
    const plan = planSections([win, inv], [["win", "inv"]]);

    const adoptSection = plan.find((p) => p.section === "ADOPT-CHEAP")!;
    const investSection = plan.find((p) => p.section === "INVEST")!;

    // win is the ADOPT-CHEAP exemplar with inv listed as a collapsed member...
    expect(adoptSection.entries).toHaveLength(1);
    expect(adoptSection.entries[0]!.exemplar.id).toBe("win");
    expect(adoptSection.entries[0]!.collapsed.map((m) => m.id)).toEqual(["inv"]);
    // ...AND inv ALSO appears as a standalone INVEST entry (queue never thinned).
    expect(investSection.entries).toHaveLength(1);
    expect(investSection.entries[0]!.exemplar.id).toBe("inv");
    expect(investSection.entries[0]!.collapsed).toEqual([]);
  });

  it("does NOT double-list an INVEST item that is already its cluster's exemplar", () => {
    const inv = item({ id: "inv", verdict: "INVEST", applicability: 3 }); // composite 7, wins
    const other = item({ id: "oth", verdict: "WAIT" }); // composite 6
    const plan = planSections([inv, other], [["inv", "oth"]]);
    const investSection = plan.find((p) => p.section === "INVEST")!;
    expect(investSection.entries).toHaveLength(1);
    expect(investSection.entries[0]!.collapsed.map((m) => m.id)).toEqual(["oth"]);
  });

  it("sorts collapsed members by composite desc", () => {
    const ex = item({ id: "ex", durability: 3, compositionSpecificity: 3, applicability: 3 }); // composite 11 — exemplar
    const m1 = item({ id: "m1", applicability: 2 }); // composite 6
    const m2 = item({ id: "m2", durability: 3, applicability: 3 }); // composite 8
    const plan = planSections([ex, m1, m2], [["ex", "m1", "m2"]]);
    const entry = plan.find((p) => p.section === "ADOPT-CHEAP")!.entries[0]!;
    expect(entry.exemplar.id).toBe("ex");
    // m2 (composite 8) before m1 (composite 6)
    expect(entry.collapsed.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("renders a section with no items as an empty entry list", () => {
    const plan = planSections([item({ id: "a", verdict: "WAIT" })], [["a"]]);
    expect(plan.find((p) => p.section === "INVEST")!.entries).toEqual([]);
  });

  it("treats an item missing from the cluster list as its own singleton", () => {
    const a = item({ id: "a", verdict: "WAIT" });
    const b = item({ id: "b", verdict: "TRACK" });
    const plan = planSections([a, b], [["a"]]); // b absent
    expect(plan.find((p) => p.section === "TRACK")!.entries.map((e) => e.exemplar.id)).toEqual(["b"]);
  });
});

describe("buildSynthesisUserPrompt", () => {
  it("includes both verdicts on an INVEST line but not on a non-INVEST line", () => {
    const inv = item({ id: "a", verdict: "INVEST", modelVerdict: "ADOPT-CHEAP" });
    const adopt = item({ id: "b", verdict: "ADOPT-CHEAP", modelVerdict: "ADOPT-CHEAP" });
    const plan = planSections([inv, adopt], [["a"], ["b"]]);
    const prompt = buildSynthesisUserPrompt(plan);
    const lines = prompt.split("\n");
    const invLine = lines.find((l) => l.includes("[src]") && l.includes("claim") && l.includes("routed: INVEST"));
    expect(invLine).toBeDefined();
    expect(invLine).toContain("model self-verdict: ADOPT-CHEAP");
    // The non-INVEST entry line carries neither the routed/model annotation...
    const adoptLine = lines.find(
      (l) => l.startsWith("- ") && !l.includes("routed: INVEST"),
    );
    expect(adoptLine).toBeDefined();
    expect(adoptLine).not.toContain("model self-verdict");
  });
});

describe("renderDoc", () => {
  function basePlan() {
    const a = item({ id: "a", verdict: "INVEST", modelVerdict: "ADOPT-CHEAP", applicability: 3 });
    const b = item({ id: "b", verdict: "ADOPT-CHEAP", applicability: 3 }); // composite 7
    const c = item({ id: "c", verdict: "ADOPT-CHEAP", applicability: 2 }); // composite 6
    return planSections([a, b, c], [["a"], ["b"], ["c"]]);
  }

  it("emits the four sections in canonical order", () => {
    const md = renderDoc(basePlan(), narrative, meta);
    const idx = SECTION_ORDER.map((s) => md.indexOf(SECTION_HEADINGS[s]));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
  });

  it("sorts entries within a section by composite desc", () => {
    const md = renderDoc(basePlan(), narrative, meta);
    // b (composite 7) must appear before c (composite 6) in ADOPT-CHEAP.
    expect(md.indexOf("composite=7")).toBeLessThan(md.indexOf("composite=6"));
  });

  it("frames INVEST entries with model verdict and the not-auto-committed note", () => {
    const md = renderDoc(basePlan(), narrative, meta);
    expect(md).toContain("Routed verdict:** INVEST");
    expect(md).toContain("Model verdict:** ADOPT-CHEAP");
    expect(md).toContain("flagged for confirmation, not auto-committed");
  });

  it("lists collapsed members under their exemplar", () => {
    const win = item({ id: "win", verdict: "ADOPT-CHEAP", applicability: 3 });
    const lost = item({ id: "lost", title: "Collapsed One", verdict: "WAIT" });
    const plan = planSections([win, lost], [["win", "lost"]]);
    const md = renderDoc(plan, narrative, meta);
    expect(md).toContain("Collapsed into this entry (1):");
    expect(md).toContain('"Collapsed One" — src · WAIT');
  });

  it("renders an empty section as 'None this period.'", () => {
    const plan = planSections([item({ id: "a", verdict: "WAIT" })], [["a"]]);
    const md = renderDoc(plan, narrative, meta);
    // TRACK is empty here.
    const trackPos = md.indexOf(SECTION_HEADINGS.TRACK);
    expect(md.slice(trackPos, trackPos + 200)).toContain("_None this period._");
  });

  it("includes the provenance header fields", () => {
    const md = renderDoc(basePlan(), narrative, meta);
    expect(md).toContain("Generated: 2026-06-11T00:00:00.000Z");
    expect(md).toContain("Synthesis model: claude-opus-4-8");
    expect(md).toContain("Cluster θ: 0.75");
    expect(md).toContain("Eligible items: 5");
    expect(md).toContain("Clusters: 4");
    expect(md).toContain("Collapsed: 1");
  });

  it("is deterministic regardless of input item/cluster order", () => {
    const a = item({ id: "a", verdict: "INVEST", applicability: 3 });
    const b = item({ id: "b", verdict: "ADOPT-CHEAP", applicability: 3 });
    const c = item({ id: "c", verdict: "ADOPT-CHEAP", applicability: 2 });
    const d = item({ id: "d", verdict: "WAIT" });
    const md1 = renderDoc(
      planSections([a, b, c, d], [["a"], ["b", "c"], ["d"]]),
      narrative,
      meta,
    );
    const md2 = renderDoc(
      planSections([d, c, b, a], [["d"], ["c", "b"]]), // a absent → singleton; order flipped
      narrative,
      meta,
    );
    expect(md1).toBe(md2);
  });
});
