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
  synthesisModel: string;
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
  INVEST: "INVEST",
  "ADOPT-CHEAP": "ADOPT-CHEAP",
  TRACK: "Track",
  WAIT: "Wait",
};

const VERDICT_COLORS: Record<DigestSection, { border: string; bg: string; fg: string }> = {
  INVEST: { border: "#c98219", bg: "#fff4dc", fg: "#7a4a08" },
  "ADOPT-CHEAP": { border: "#2f8a57", bg: "#eaf6ee", fg: "#1f673f" },
  TRACK: { border: "#3f7fbf", bg: "#eaf3fb", fg: "#245b8f" },
  WAIT: { border: "#687386", bg: "#eef1f4", fg: "#465163" },
};

const PAGE_BG = "#f7f2e8";
const CARD_BG = "#fffaf0";
const INK = "#1f241f";
const MUTED = "#67645d";
const RULE = "#ded3bd";
const BUTTON = "#20241f";

function toDate(input: string | Date): Date {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`renderWorkflowDigest: invalid generatedAt ${String(input)}`);
  }
  return d;
}

function dateOnly(input: string | Date): string {
  return toDate(input).toISOString().slice(0, 10);
}

function isoDateTime(input: string | Date): string {
  return toDate(input).toISOString();
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

function verdictBadge(section: DigestSection | string, label?: string): string {
  const colors =
    section in VERDICT_COLORS
      ? VERDICT_COLORS[section as DigestSection]
      : { border: "#8b8172", bg: "#f1ece3", fg: "#514b43" };
  return `<span style="display:inline-block;border-left:3px solid ${colors.border};background:${colors.bg};color:${colors.fg};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 7px;">${escapeHtml(label ?? section)}</span>`;
}

function renderCountStrip(counts: SectionCounts): string {
  return DIGEST_SECTION_ORDER.map(
    (section) => `<td width="25%" style="padding:0 4px 0 0;vertical-align:top;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid ${RULE};">
        <tr>
          <td style="padding:10px 8px 8px;text-align:left;">
            ${verdictBadge(section, SECTION_LABELS[section])}
            <div style="font-family:Georgia,serif;font-size:24px;line-height:28px;color:${INK};font-weight:400;margin-top:8px;">${counts[section]}</div>
          </td>
        </tr>
      </table>
    </td>`,
  ).join("");
}

function renderVerdictPair(item: InvestQueueItem): string {
  const routed = verdictBadge(item.routedVerdict, `routed ${item.routedVerdict}`);
  const model = verdictBadge(item.modelVerdict ?? "—", `model ${item.modelVerdict ?? "—"}`);
  const mismatch =
    item.modelVerdict && item.modelVerdict !== item.routedVerdict
      ? `<span style="display:inline-block;margin-left:6px;border-left:3px solid ${VERDICT_COLORS.INVEST.border};background:${VERDICT_COLORS.INVEST.bg};color:${VERDICT_COLORS.INVEST.fg};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 7px;">review mismatch</span>`
      : "";
  return `${routed} <span style="color:${MUTED};font-family:Arial,Helvetica,sans-serif;font-size:12px;">vs</span> ${model}${mismatch}`;
}

function renderInvestRows(items: readonly InvestQueueItem[], appUrl: string): string {
  const visible = items.slice(0, 6);
  if (visible.length === 0) {
    return `<tr>
      <td colspan="3" style="padding:14px 12px;border-left:3px solid ${VERDICT_COLORS.INVEST.border};border-bottom:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:${MUTED};">No INVEST candidates are currently queued.</td>
    </tr>`;
  }
  const rows = visible
    .map((item) => {
      const title = escapeHtml(item.title ?? "(no title)");
      return `<tr>
        <td style="padding:13px 10px 13px 12px;border-left:3px solid ${VERDICT_COLORS.INVEST.border};border-bottom:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${INK};vertical-align:top;">
          <a href="${escapeHtml(appUrl)}" style="color:${INK};text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;font-weight:700;">${title}</a>
        </td>
        <td style="padding:13px 10px;border-bottom:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${MUTED};vertical-align:top;">${escapeHtml(item.source)}</td>
        <td style="padding:13px 12px 13px 10px;border-bottom:1px solid ${RULE};vertical-align:top;">${renderVerdictPair(item)}</td>
      </tr>`;
    })
    .join("");
  const extra = items.length - visible.length;
  if (extra <= 0) return rows;
  return `${rows}<tr>
    <td colspan="3" style="padding:12px;border-left:3px solid ${VERDICT_COLORS.INVEST.border};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${MUTED};">and ${extra} more</td>
  </tr>`;
}

function renderTextDigest(args: {
  subject: string;
  generatedAt: string;
  synthesisModel: string;
  summary: string;
  sectionCounts: SectionCounts;
  investQueue: readonly InvestQueueItem[];
  appUrl: string;
}): string {
  const countLines = DIGEST_SECTION_ORDER.map(
    (section) => `- ${SECTION_LABELS[section]}: ${args.sectionCounts[section]}`,
  ).join("\n");
  const visibleInvest = args.investQueue.slice(0, 6);
  const investLines =
    visibleInvest.length === 0
      ? "- None"
      : visibleInvest
          .map(
            (item) =>
              `- ${item.title ?? "(no title)"} [${item.source}] — routed ${item.routedVerdict} vs model ${item.modelVerdict ?? "—"}`,
          )
          .join("\n");
  const more =
    args.investQueue.length > visibleInvest.length
      ? `\n- and ${args.investQueue.length - visibleInvest.length} more`
      : "";
  return `${args.subject}

Executive summary
${markdownToPlainText(args.summary)}

Section counts
${countLines}

INVEST queue
${investLines}${more}

Open the full strategy: ${args.appUrl}

Generated: ${args.generatedAt}
Synthesis model: ${args.synthesisModel}
Automated weekly digest — reply to tclum@hawaii.edu
`;
}

export function renderWorkflowDigest(input: DigestRenderInput): RenderedDigest {
  const week = dateOnly(input.generatedAt);
  const generatedAt = isoDateTime(input.generatedAt);
  const subject = `Workflow Intel — week of ${week}`;
  const appUrl = input.appUrl ?? DIGEST_APP_URL;
  const summary = extractExecutiveSummary(input.strategyMarkdown);

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${PAGE_BG};color:${INK};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:${PAGE_BG};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;background:${CARD_BG};">
            <tr>
              <td style="padding:22px 22px 14px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="font-family:Georgia,serif;font-size:24px;line-height:28px;color:${INK};font-weight:400;">Workflow Intel</td>
                    <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:${MUTED};">${escapeHtml(week)}</td>
                  </tr>
                  <tr><td colspan="2" style="padding-top:14px;border-bottom:1px solid ${RULE};font-size:1px;line-height:1px;">&nbsp;</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 22px 18px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:${INK};">${renderSummaryHtml(summary)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 18px 22px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>${renderCountStrip(input.sectionCounts)}</tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 22px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;">INVEST queue</td>
            </tr>
            <tr>
              <td style="padding:0 22px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid ${RULE};">
                  <tr>
                    <th align="left" style="padding:9px 10px 9px 12px;border-bottom:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:15px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">Title</th>
                    <th align="left" style="padding:9px 10px;border-bottom:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:15px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">Source</th>
                    <th align="left" style="padding:9px 12px 9px 10px;border-bottom:1px solid ${RULE};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:15px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">Verdict</th>
                  </tr>
                  ${renderInvestRows(input.investQueue, appUrl)}
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 22px 24px;">
                <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:${BUTTON};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:700;text-decoration:none;border-radius:999px;padding:12px 18px;">Open the full strategy →</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 22px 22px;border-top:1px solid ${RULE};font-family:'Courier New',Courier,monospace;font-size:11px;line-height:17px;color:${MUTED};">
                generated-at: ${escapeHtml(generatedAt)}<br>
                synthesis model: ${escapeHtml(input.synthesisModel)}<br>
                automated weekly digest — reply to tclum@hawaii.edu
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    html,
    text: renderTextDigest({
      subject,
      generatedAt,
      synthesisModel: input.synthesisModel,
      summary,
      sectionCounts: input.sectionCounts,
      investQueue: input.investQueue,
      appUrl,
    }),
  };
}
