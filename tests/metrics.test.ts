import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  METRICS_COLUMNS,
  appendMetrics,
  type MetricsRow,
} from "../src/metrics/csv.js";

const dirs: string[] = [];
function tmpCsv(): string {
  const dir = mkdtempSync(join(tmpdir(), "wf-intel-metrics-"));
  dirs.push(dir);
  return join(dir, "ingest_metrics.csv");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
  const base: MetricsRow = {
    timestamp_utc: "2026-06-09T00:00:00.000Z",
    run_id: "ingest-test",
    sources_total: 3,
    sources_ok: 3,
    sources_failed: 0,
    items_fetched: 10,
    items_inserted: 8,
    items_skipped: 2,
    duration_ms: 123,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };
  return { ...base, ...overrides };
}

describe("appendMetrics", () => {
  it("writes the header once on creation, then a data row", () => {
    const path = tmpCsv();
    appendMetrics(path, row());
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(METRICS_COLUMNS.join(","));
    expect(lines[1]).toContain("ingest-test");
  });

  it("appends subsequent rows without repeating the header", () => {
    const path = tmpCsv();
    appendMetrics(path, row({ run_id: "run-a" }));
    appendMetrics(path, row({ run_id: "run-b" }));
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3); // 1 header + 2 rows
    expect(lines[0]).toBe(METRICS_COLUMNS.join(","));
    expect(lines[1]).toContain("run-a");
    expect(lines[2]).toContain("run-b");
  });

  it("emits values in the declared column order", () => {
    const path = tmpCsv();
    appendMetrics(path, row());
    const dataLine = readFileSync(path, "utf8").trimEnd().split("\n")[1] ?? "";
    // duration_ms is the 9th column (index 8).
    expect(dataLine.split(",")[8]).toBe("123");
  });

  it("reserves the token/cost columns for later LLM slices", () => {
    expect(METRICS_COLUMNS).toContain("input_tokens");
    expect(METRICS_COLUMNS).toContain("output_tokens");
    expect(METRICS_COLUMNS).toContain("cost_usd");
  });
});
