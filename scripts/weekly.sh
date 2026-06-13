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

  # Recipients resolve via the same resolveDigestRecipients() the digest uses
  # (DB list, env fallback) — see scripts/failure-notice.ts. Single source of
  # truth; no hardcoded recipient copy here.
  pnpm failure-notice "$failed_step" "$exit_status"
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
