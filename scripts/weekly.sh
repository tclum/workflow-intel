#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FAILED_STEP="startup"

run_step() {
  local step="$1"
  FAILED_STEP="$step"
  echo "[weekly] running pnpm $step"
  pnpm "$step" || return $?
}

send_failure_notice() {
  local failed_step="$1"
  local exit_status="$2"

  node --input-type=module - "$failed_step" "$exit_status" <<'NODE'
import { config } from "dotenv";

config();

const failedStep = process.argv[2] ?? "unknown";
const exitStatus = process.argv[3] ?? "unknown";
const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.error("[weekly] RESEND_API_KEY is not set; skipping failure notice.");
  process.exit(0);
}

const from = process.env.DIGEST_FROM || "intel@forpono.com";
const to = (process.env.DIGEST_RECIPIENTS || "tclum@hawaii.edu,huijeff@hawaii.edu")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

if (to.length === 0) {
  console.error("[weekly] DIGEST_RECIPIENTS is empty; skipping failure notice.");
  process.exit(0);
}

const subject = `Workflow Intel weekly failed at ${failedStep}`;
const text = `The workflow-intel weekly run failed.

Step: ${failedStep}
Exit status: ${exitStatus}
Host time: ${new Date().toISOString()}

Open the local logs for the launchd job, then rerun from ~/Desktop/Developer/workflow-intel after fixing the failing step.`;

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    from,
    to,
    subject,
    text,
    html: `<p>The workflow-intel weekly run failed.</p><ul><li>Step: ${failedStep}</li><li>Exit status: ${exitStatus}</li><li>Host time: ${new Date().toISOString()}</li></ul><p>Open the local logs for the launchd job, then rerun from <code>~/Desktop/Developer/workflow-intel</code> after fixing the failing step.</p>`,
  }),
  signal: AbortSignal.timeout(60_000),
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  throw new Error(`Resend failure notice failed: ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
}

const json = await response.json().catch(() => ({}));
console.log(JSON.stringify({ failureNoticeSent: true, id: json.id ?? null }, null, 2));
NODE
}

run_pipeline() {
  run_step ingest || return $?
  run_step embed || return $?
  run_step dedup || return $?
  run_step triage || return $?
  run_step synthesis || return $?
  run_step email-digest || return $?
}

if run_pipeline; then
  echo "[weekly] complete"
else
  status=$?
  echo "[weekly] failed at pnpm $FAILED_STEP with exit status $status" >&2
  send_failure_notice "$FAILED_STEP" "$status" || true
  exit "$status"
fi
