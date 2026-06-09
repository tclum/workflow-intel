import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Per-run ingestion metrics — append-only CSV, header written once on creation
// (bus-finance's append_metrics `is_new` pattern). Column order is the contract.
// The token/cost columns are reserved for the LLM slices (2: embeddings,
// 3: triage, 4: synthesis) and stay 0 until then.
export const METRICS_COLUMNS = [
  "timestamp_utc",
  "run_id",
  "sources_total",
  "sources_ok",
  "sources_failed",
  "items_fetched",
  "items_inserted",
  "items_skipped",
  "duration_ms",
  "input_tokens",
  "output_tokens",
  "cost_usd",
] as const;

export type MetricColumn = (typeof METRICS_COLUMNS)[number];
export type MetricsRow = Record<MetricColumn, string | number>;

function csvField(value: string | number): string {
  const s = String(value);
  // Quote if the value contains a comma, quote, or newline; double internal quotes.
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function appendMetrics(path: string, row: MetricsRow): void {
  const isNew = !existsSync(path);
  mkdirSync(dirname(path), { recursive: true });

  const lines: string[] = [];
  if (isNew) {
    lines.push(METRICS_COLUMNS.join(","));
  }
  lines.push(METRICS_COLUMNS.map((c) => csvField(row[c])).join(","));
  appendFileSync(path, `${lines.join("\n")}\n`);
}
