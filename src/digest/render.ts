export const DIGEST_APP_URL = "https://intel.forpono.com";

export const DIGEST_SECTION_ORDER = [
  "INVEST",
  "ADOPT-CHEAP",
  "TRACK",
  "WAIT",
] as const;

export type DigestSection = (typeof DIGEST_SECTION_ORDER)[number];

export type SectionCounts = Record<DigestSection, number>;

export interface InvestQueueItem {
  title: string | null;
  source: string;
  routedVerdict: string;
  modelVerdict: string | null;
}

export interface DigestRenderInput {
  generatedAt: string | Date;
  strategyMarkdown: string;
  sectionCounts: SectionCounts;
  investQueue: readonly InvestQueueItem[];
  appUrl?: string;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

const SECTION_LABELS: Record<DigestSection, string> = {
  INVEST: "Invest queue",
  "ADOPT-CHEAP": "Adopt cheaply",
  TRACK: "Track",
  WAIT: "Wait",
};

function dateOnly(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`renderWorkflowDigest: invalid generatedAt ${String(input)}`);
  }
  return d.toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractExecutiveSummary(markdown: string): string {
  const match = markdown.match(
    /## Executive summary\s*\n+([\s\S]*?)(?=\n## |\s*$)/,
  );
  const summary = match?.[1]?.trim() ?? "";
  return summary.length > 0 ? summary : "_No executive summary found._";
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .trim();
}

function renderSummaryHtml(summaryMarkdown: string): string {
  return escapeHtml(markdownToPlainText(summaryMarkdown)).replaceAll("\n\n", "<br><br>");
}

function renderCounts(counts: SectionCounts): string {
  return DIGEST_SECTION_ORDER.map(
    (section) =>
      `<tr><th scope="row">${escapeHtml(SECTION_LABELS[section])}</th><td>${counts[section]}</td></tr>`,
  ).join("");
}

function renderInvestQueue(items: readonly InvestQueueItem[]): string {
  if (items.length === 0) {
    return `<p class="muted">No INVEST candidates are currently queued.</p>`;
  }
  return `<ul>${items
    .map((item) => {
      const model = item.modelVerdict ?? "—";
      return `<li><strong>${escapeHtml(item.title ?? "(no title)")}</strong><span>${escapeHtml(item.source)} · routed ${escapeHtml(item.routedVerdict)} vs model ${escapeHtml(model)}</span></li>`;
    })
    .join("")}</ul>`;
}

function renderTextDigest(args: {
  subject: string;
  summary: string;
  sectionCounts: SectionCounts;
  investQueue: readonly InvestQueueItem[];
  appUrl: string;
}): string {
  const countLines = DIGEST_SECTION_ORDER.map(
    (section) => `- ${SECTION_LABELS[section]}: ${args.sectionCounts[section]}`,
  ).join("\n");
  const investLines =
    args.investQueue.length === 0
      ? "- None"
      : args.investQueue
          .map(
            (item) =>
              `- ${item.title ?? "(no title)"} [${item.source}] — routed ${item.routedVerdict} vs model ${item.modelVerdict ?? "—"}`,
          )
          .join("\n");
  return `${args.subject}

Executive summary
${markdownToPlainText(args.summary)}

Section counts
${countLines}

INVEST queue
${investLines}

Open Workflow Intel: ${args.appUrl}
`;
}

export function renderWorkflowDigest(input: DigestRenderInput): RenderedDigest {
  const week = dateOnly(input.generatedAt);
  const subject = `Workflow Intel — week of ${week}`;
  const appUrl = input.appUrl ?? DIGEST_APP_URL;
  const summary = extractExecutiveSummary(input.strategyMarkdown);

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
    <style>
      body { margin: 0; background: #f7f5ef; color: #1d2520; font-family: Arial, sans-serif; }
      main { max-width: 680px; margin: 0 auto; padding: 28px 20px 36px; }
      h1 { margin: 0 0 18px; font-size: 24px; line-height: 1.2; }
      h2 { margin: 28px 0 10px; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; }
      p { line-height: 1.55; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e4dfd3; text-align: left; }
      td { text-align: right; font-weight: 700; }
      ul { margin: 0; padding: 0; list-style: none; }
      li { padding: 12px 0; border-bottom: 1px solid #e4dfd3; }
      li strong { display: block; }
      li span, .muted { color: #59645d; font-size: 14px; }
      a.cta { display: inline-block; margin-top: 22px; padding: 12px 16px; border-radius: 999px; background: #1d2520; color: #fff; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(subject)}</h1>
      <h2>Executive summary</h2>
      <p>${renderSummaryHtml(summary)}</p>
      <h2>Section counts</h2>
      <table>${renderCounts(input.sectionCounts)}</table>
      <h2>INVEST queue</h2>
      ${renderInvestQueue(input.investQueue)}
      <a class="cta" href="${escapeHtml(appUrl)}">Open Workflow Intel</a>
    </main>
  </body>
</html>`;

  return {
    subject,
    html,
    text: renderTextDigest({
      subject,
      summary,
      sectionCounts: input.sectionCounts,
      investQueue: input.investQueue,
      appUrl,
    }),
  };
}
