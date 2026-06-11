import { z } from "zod";
import { composite } from "../triage/rubric.js";
import { type ExemplarCandidate, pickExemplar } from "./cluster.js";

// Pure doc-assembly for Slice 4 synthesis. No env / DB / network imports, so the
// whole WORKFLOW_STRATEGY.md skeleton is deterministic and unit-testable offline
// (the convention: pure assembly here, the Opus call in anthropic.ts, the DB wiring
// + file write in scripts/synthesis.ts). The model writes ONLY connective prose
// (executive_summary + per-section narratives); item selection, ordering, and the
// INVEST exemption are decided here in code, never by the model.

// --- Section model -------------------------------------------------------------

// The four ACTIONABLE verdict buckets, in doc order (EVAL_RUBRIC §52 as amended in
// the Slice 4 recon). DISCARD/ARCHIVE never reach synthesis (filtered upstream).
export const SECTION_ORDER = [
  "INVEST",
  "ADOPT-CHEAP",
  "TRACK",
  "WAIT",
] as const;
export type DocSection = (typeof SECTION_ORDER)[number];

export const SECTION_HEADINGS: Record<DocSection, string> = {
  INVEST:
    "Build / integrate now (INVEST — flagged for Timothy's confirmation, not auto-committed)",
  "ADOPT-CHEAP": "Adopt now, cheaply (ADOPT-CHEAP)",
  TRACK: "Watch for the product (TRACK)",
  WAIT: "Wait for the model (WAIT)",
};

// One eligible item carrying everything the doc renders. Extends ExemplarCandidate
// so pickExemplar/composite apply directly (the five composite inputs + the
// tie-break keys live on the base).
export interface SynthesisItem extends ExemplarCandidate {
  title: string | null;
  source: string; // source slug
  verdict: string; // routed signal_verdict (must be one of SECTION_ORDER here)
  modelVerdict: string | null; // advisory model self-verdict (INVEST adjudication input)
  sourceCredibility: number;
  claim: string | null;
  evidence: string | null;
  rationale: string | null;
}

// A rendered entry: one exemplar plus the cluster members it absorbed. Collapsed
// members are LISTED under the exemplar, never silently dropped.
export interface DocEntry {
  exemplar: SynthesisItem;
  collapsed: SynthesisItem[];
}

export interface SectionPlan {
  section: DocSection;
  entries: DocEntry[];
}

function isSection(v: string): v is DocSection {
  return (SECTION_ORDER as readonly string[]).includes(v);
}

// Sort key for entries within a section and for collapsed members: composite desc,
// then id asc (total order → deterministic).
function byCompositeDescThenId(a: SynthesisItem, b: SynthesisItem): number {
  const d = composite(b) - composite(a);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Build the four-section plan from the eligible items and the clusters.
//
// - clusters partition the eligible set (clusterByThreshold covers every item; any
//   item somehow absent from the cluster list is treated as its own singleton, so
//   coverage is guaranteed even in the degenerate 0-pairs case).
// - Each cluster collapses to its highest-composite exemplar (pickExemplar); the
//   topic lands in the EXEMPLAR's section (global, verdict-agnostic clustering —
//   split verdicts across near-identical items are scoring noise, and the
//   exemplar's verdict is the topic's best action estimate).
// - INVEST exemption: every INVEST item appears in the INVEST section even if it
//   lost the exemplar pick inside a non-INVEST cluster. It may then appear BOTH as
//   an INVEST entry and as a collapsed member elsewhere — intended: automation
//   never thins the human-review queue.
export function planSections(
  items: SynthesisItem[],
  clusters: string[][],
): SectionPlan[] {
  const byId = new Map(items.map((i) => [i.id, i]));

  const clustered = new Set<string>(clusters.flat());
  const effective: string[][] = [...clusters];
  for (const it of items) {
    if (!clustered.has(it.id)) effective.push([it.id]);
  }

  const bySection = new Map<DocSection, DocEntry[]>(
    SECTION_ORDER.map((s) => [s, []]),
  );
  const exemplarIds = new Set<string>();

  for (const cluster of effective) {
    const members = cluster.map((id) => {
      const it = byId.get(id);
      if (!it) throw new Error(`planSections: unknown item id in cluster: ${id}`);
      return it;
    });
    const exemplar = pickExemplar(members);
    exemplarIds.add(exemplar.id);
    if (!isSection(exemplar.verdict)) {
      throw new Error(
        `planSections: exemplar ${exemplar.id} has non-actionable verdict ${exemplar.verdict}`,
      );
    }
    const collapsed = members
      .filter((m) => m.id !== exemplar.id)
      .sort(byCompositeDescThenId);
    bySection.get(exemplar.verdict)!.push({ exemplar, collapsed });
  }

  // INVEST exemption: surface every INVEST item that was collapsed away.
  for (const it of items) {
    if (it.verdict === "INVEST" && !exemplarIds.has(it.id)) {
      bySection.get("INVEST")!.push({ exemplar: it, collapsed: [] });
    }
  }

  return SECTION_ORDER.map((section) => ({
    section,
    entries: bySection
      .get(section)!
      .slice()
      .sort((a, b) => byCompositeDescThenId(a.exemplar, b.exemplar)),
  }));
}

// --- The model's narrative contract (Zod gate, shared with anthropic.ts) ---------

// Per-section connective prose, keyed by verdict. Every key optional — the model
// includes one only for a non-empty section.
export const sectionNarrativesSchema = z.object({
  INVEST: z.string().optional(),
  "ADOPT-CHEAP": z.string().optional(),
  TRACK: z.string().optional(),
  WAIT: z.string().optional(),
});

export const synthesisNarrativeSchema = z.object({
  executive_summary: z.string(),
  section_narratives: sectionNarrativesSchema,
});
export type SynthesisNarrative = z.infer<typeof synthesisNarrativeSchema>;

// --- Prompt building (pure) ----------------------------------------------------

const STACK_CONTEXT = `Timothy is a solo founder running an agentic development workflow built on Claude Code (CC) + Codex, over a Next.js 15 / Supabase / Vercel TypeScript monorepo. The strategy doc tells him where to spend effort: what to build now, what to adopt cheaply, what to merely watch, and what to wait on.`;

export function buildSynthesisSystemPrompt(): string {
  return `You are the synthesis writer for an anti-hype AI-workflow intelligence pipeline.

${STACK_CONTEXT}

You will receive a deterministic strategy skeleton already grouped into four action sections, with the items, their claims, evidence, and rationales pre-selected and pre-ordered. Your ONLY job is to write connective prose and emit it via the emit_synthesis tool ONLY:
- executive_summary: a short, plain overview of what this period's intelligence means for the workflow — the throughline across sections.
- section_narratives: one short narrative per NON-EMPTY section, keyed EXACTLY by verdict name (INVEST | ADOPT-CHEAP | TRACK | WAIT). Omit the key for any empty section.

HARD CONSTRAINTS:
- You MUST NOT add, remove, reorder, or re-rank items. The skeleton is authoritative; it already lists every item. Do not restate the item list — write the prose that frames it.
- Anti-hype voice, consistent with the rubric: skeptical and concrete. No superlatives without numbers, no product-pitch framing, no "game-changer" language. If the evidence is thin, say so.

Section meanings:
- INVEST: build / integrate now — but these are HUMAN-REVIEW CANDIDATES flagged for Timothy's confirmation, NOT auto-committed. Frame them as proposals to adjudicate, and note where the router and the cheap model's self-verdict disagree (that disagreement is the adjudication signal).
- ADOPT-CHEAP: real but generic — adopt now, cheaply, no durable edge; don't build infrastructure around it.
- TRACK: watch for the product — the vendors are likely to ship this; use lightly, don't over-invest.
- WAIT: wait for the model — a gap the next model release will likely close.`;
}

export function buildSynthesisUserPrompt(plan: SectionPlan[]): string {
  const lines: string[] = [];
  lines.push(
    "Deterministic strategy skeleton (authoritative — do not change membership or order). Write the executive_summary and one narrative per non-empty section.",
  );
  for (const sp of plan) {
    lines.push("");
    lines.push(
      `## SECTION ${sp.section} — ${sp.entries.length} item${sp.entries.length === 1 ? "" : "s"}`,
    );
    if (sp.entries.length === 0) {
      lines.push("(empty — no narrative needed)");
      continue;
    }
    for (const e of sp.entries) {
      const x = e.exemplar;
      // For INVEST, surface BOTH verdicts: the system prompt asks the model to note
      // router/model disagreement in the narrative, so the data must be in the prompt
      // — otherwise the instruction invites the model to fabricate a self-verdict.
      const investSuffix =
        x.verdict === "INVEST"
          ? ` | routed: INVEST, model self-verdict: ${x.modelVerdict ?? "—"}`
          : "";
      lines.push(
        `- "${x.title ?? "(no title)"}" [${x.source}] — claim: ${x.claim ?? ""} | evidence: ${x.evidence ?? ""} | rationale: ${x.rationale ?? ""}${investSuffix}`,
      );
    }
  }
  return lines.join("\n");
}

// --- Markdown rendering (pure, deterministic) ----------------------------------

export interface DocMeta {
  generatedAt: string; // ISO 8601 — supplied by the caller (deterministic input)
  synthesisModel: string;
  threshold: number;
  eligibleCount: number;
  clusterCount: number;
}

function fmtDate(ms: number | null): string {
  return ms == null ? "unknown" : new Date(ms).toISOString().slice(0, 10);
}

function scoreLine(it: SynthesisItem): string {
  return `composite=${composite(it)} · ev=${it.evidenceStrength} cred=${it.sourceCredibility} dur=${it.durability} commod=${it.commoditizationRisk} comp=${it.compositionSpecificity} appl=${it.applicability}`;
}

function renderEntry(entry: DocEntry, section: DocSection): string[] {
  const x = entry.exemplar;
  const out: string[] = [];
  out.push(`### ${x.title ?? "(no title)"}`);
  out.push(`- **Source:** ${x.source} · **Published:** ${fmtDate(x.publishedAt)}`);
  if (section === "INVEST") {
    out.push(
      `- **Routed verdict:** INVEST · **Model verdict:** ${x.modelVerdict ?? "—"} — flagged for confirmation, not auto-committed`,
    );
  } else {
    out.push(`- **Verdict:** ${x.verdict}`);
  }
  out.push(`- **Scores:** ${scoreLine(x)}`);
  out.push(`- **Claim:** ${x.claim ?? "—"}`);
  out.push(`- **Evidence:** ${x.evidence ?? "—"}`);
  out.push(`- **Rationale:** ${x.rationale ?? "—"}`);
  if (entry.collapsed.length > 0) {
    out.push(`- **Collapsed into this entry (${entry.collapsed.length}):**`);
    for (const m of entry.collapsed) {
      out.push(`  - "${m.title ?? "(no title)"}" — ${m.source} · ${m.verdict}`);
    }
  }
  return out;
}

// Assemble the full WORKFLOW_STRATEGY.md. Deterministic given (plan, narrative, meta).
export function renderDoc(
  plan: SectionPlan[],
  narrative: SynthesisNarrative,
  meta: DocMeta,
): string {
  const exemplars = meta.clusterCount;
  const collapsed = meta.eligibleCount - meta.clusterCount;
  const out: string[] = [];

  out.push("<!-- GENERATED by `pnpm synthesis` — do not edit by hand. -->");
  out.push("# Workflow Intelligence — Strategy");
  out.push("");
  out.push(
    `> Generated: ${meta.generatedAt} · Synthesis model: ${meta.synthesisModel} · Cluster θ: ${meta.threshold}`,
  );
  out.push(
    `> Eligible items: ${meta.eligibleCount} · Clusters: ${meta.clusterCount} · Exemplars: ${exemplars} · Collapsed: ${collapsed}`,
  );
  out.push("");
  out.push("## Executive summary");
  out.push("");
  out.push(narrative.executive_summary.trim().length > 0 ? narrative.executive_summary.trim() : "_None this period._");

  for (const sp of plan) {
    out.push("");
    out.push(`## ${SECTION_HEADINGS[sp.section]}`);
    out.push("");
    if (sp.entries.length === 0) {
      out.push("_None this period._");
      continue;
    }
    const narr = narrative.section_narratives[sp.section];
    if (narr && narr.trim().length > 0) {
      out.push(narr.trim());
      out.push("");
    }
    sp.entries.forEach((entry, i) => {
      if (i > 0) out.push("");
      out.push(...renderEntry(entry, sp.section));
    });
  }

  out.push("");
  return out.join("\n");
}
