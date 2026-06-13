import { env } from "../src/config/env.js";
import { sqlClient } from "../src/db/client.js";
import {
  DIGEST_SECTION_ORDER,
  renderWorkflowDigest,
  type DigestSection,
  type InvestQueueItem,
  type SectionCounts,
} from "../src/digest/render.js";
import {
  isDigestEnabled,
  resolveDigestRecipients,
} from "../src/digest/config.js";
import { sendEmail } from "../src/digest/resend.js";

// `pnpm email-digest` — read the latest persisted strategy doc, build the weekly
// HTML digest from DB counts, and send it via Resend.
//
// ⚠️  LIVE API: sends email through Resend and reads the live workflow-intel DB.
//     Do not run until the send gate is greenlit.

interface StrategyDocRow {
  generated_at: Date;
  synthesis_model: string;
  markdown: string;
}

interface CountRow {
  verdict: DigestSection;
  count: number;
}

interface InvestRow {
  title: string | null;
  source: string;
  signal_verdict: string;
  model_verdict: string | null;
}

function parseToOverride(argv: readonly string[]): string | null {
  let override: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--to-override") {
      const value = argv[i + 1];
      if (!value) throw new Error("--to-override requires an email address");
      override = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--to-override=")) {
      override = arg.slice("--to-override=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (override && override.includes(",")) {
    throw new Error("--to-override accepts exactly one recipient");
  }
  return override;
}

function emptySectionCounts(): SectionCounts {
  return Object.fromEntries(
    DIGEST_SECTION_ORDER.map((section) => [section, 0]),
  ) as SectionCounts;
}

async function loadLatestStrategyDoc(): Promise<StrategyDocRow> {
  const rows = (await sqlClient`
    SELECT generated_at, synthesis_model, markdown
    FROM strategy_docs
    ORDER BY generated_at DESC
    LIMIT 1
  `) as unknown as StrategyDocRow[];
  const latest = rows[0];
  if (!latest) {
    throw new Error("No strategy_docs rows found; run pnpm synthesis first.");
  }
  return latest;
}

async function loadSectionCounts(): Promise<SectionCounts> {
  const rows = (await sqlClient`
    SELECT signal_verdict AS verdict, count(*)::int AS count
    FROM items
    WHERE triaged_at IS NOT NULL
      AND signal_verdict IN ('INVEST', 'ADOPT-CHEAP', 'TRACK', 'WAIT')
    GROUP BY signal_verdict
  `) as unknown as CountRow[];

  const counts = emptySectionCounts();
  for (const row of rows) {
    if ((DIGEST_SECTION_ORDER as readonly string[]).includes(row.verdict)) {
      counts[row.verdict] = row.count;
    }
  }
  return counts;
}

async function loadInvestQueue(): Promise<InvestQueueItem[]> {
  const rows = (await sqlClient`
    SELECT i.title, s.slug AS source, i.signal_verdict, i.model_verdict
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.triaged_at IS NOT NULL
      AND i.signal_verdict = 'INVEST'
    ORDER BY i.published_at DESC NULLS LAST, i.id
  `) as unknown as InvestRow[];

  return rows.map((row) => ({
    title: row.title,
    source: row.source,
    routedVerdict: row.signal_verdict,
    modelVerdict: row.model_verdict,
  }));
}

async function main(): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      "[email-digest] RESEND_API_KEY is not set — required for `pnpm email-digest`. Aborting before any send.",
    );
    process.exit(1);
  }

  if (!(await isDigestEnabled())) {
    console.log("[email-digest] digest disabled, skipping");
    process.exit(0);
  }

  const toOverride = parseToOverride(process.argv);
  const to = toOverride ? [toOverride] : await resolveDigestRecipients();
  if (to.length === 0) {
    throw new Error("No digest recipients configured.");
  }

  const [latest, sectionCounts, investQueue] = await Promise.all([
    loadLatestStrategyDoc(),
    loadSectionCounts(),
    loadInvestQueue(),
  ]);

  const digest = renderWorkflowDigest({
    generatedAt: latest.generated_at,
    synthesisModel: latest.synthesis_model,
    strategyMarkdown: latest.markdown,
    sectionCounts,
    investQueue,
  });

  console.warn(
    `[email-digest] LIVE API: sending Resend email to ${to.join(", ")} from ${env.DIGEST_FROM}`,
  );
  const result = await sendEmail({
    apiKey,
    from: env.DIGEST_FROM,
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  console.log(
    JSON.stringify(
      {
        sent: true,
        id: result.id,
        subject: digest.subject,
        recipients: to,
        synthesisModel: latest.synthesis_model,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end();
  });
