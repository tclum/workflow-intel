import { env } from "../src/config/env.js";
import { resolveDigestRecipients } from "../src/digest/config.js";
import { sendEmail } from "../src/digest/resend.js";

// `pnpm failure-notice <step> <exit-status>` — sent by weekly.sh when a pipeline
// step fails. Recipients come from the SAME resolveDigestRecipients() the digest
// uses (DB list, env fallback), so there is no hardcoded recipient copy here. If
// the failure IS the DB being down, the env fallback still delivers the notice.

async function main(): Promise<void> {
  const failedStep = process.argv[2] ?? "unknown";
  const exitStatus = process.argv[3] ?? "unknown";

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[weekly] RESEND_API_KEY is not set; skipping failure notice.");
    return;
  }

  const to = await resolveDigestRecipients();
  if (to.length === 0) {
    console.error("[weekly] no digest recipients resolved; skipping failure notice.");
    return;
  }

  const hostTime = new Date().toISOString();
  const subject = `Workflow Intel weekly failed at ${failedStep}`;
  const text = `The workflow-intel weekly run failed.

Step: ${failedStep}
Exit status: ${exitStatus}
Host time: ${hostTime}

Open the local logs for the launchd job, then rerun from ~/Desktop/Developer/workflow-intel after fixing the failing step.`;
  const html = `<p>The workflow-intel weekly run failed.</p><ul><li>Step: ${failedStep}</li><li>Exit status: ${exitStatus}</li><li>Host time: ${hostTime}</li></ul><p>Open the local logs for the launchd job, then rerun from <code>~/Desktop/Developer/workflow-intel</code> after fixing the failing step.</p>`;

  const result = await sendEmail({
    apiKey,
    from: env.DIGEST_FROM,
    to,
    subject,
    html,
    text,
  });
  console.log(
    JSON.stringify({ failureNoticeSent: true, id: result.id }, null, 2),
  );
}

main().catch((err) => {
  // Never throw out of the failure notice — weekly.sh already exits with the
  // real failing step's status; this is best-effort delivery.
  console.error("[weekly] failure notice itself failed:", err);
});
