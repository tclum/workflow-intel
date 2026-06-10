import { describe, expect, it } from "vitest";
import {
  filterRecentItems,
  RECENCY_WINDOW_DAYS,
} from "../src/ingest/recency.js";

// Fixed reference clock so the test is deterministic (no real `new Date()`).
const NOW = new Date("2026-06-09T00:00:00.000Z");
// cutoff = NOW − 30 days = 2026-05-10T00:00:00.000Z
const CUTOFF = new Date("2026-05-10T00:00:00.000Z");

function item(publishedAt: Date | null): { externalId: string; publishedAt: Date | null } {
  return { externalId: "x", publishedAt };
}

describe("filterRecentItems", () => {
  it("keeps an item published inside the window", () => {
    const { kept, droppedOld } = filterRecentItems(
      [item(new Date("2026-06-01T00:00:00.000Z"))],
      RECENCY_WINDOW_DAYS,
      NOW,
    );
    expect(kept).toHaveLength(1);
    expect(droppedOld).toBe(0);
  });

  it("drops an item older than the window", () => {
    const { kept, droppedOld } = filterRecentItems(
      [item(new Date("2026-04-01T00:00:00.000Z"))],
      RECENCY_WINDOW_DAYS,
      NOW,
    );
    expect(kept).toHaveLength(0);
    expect(droppedOld).toBe(1);
  });

  it("keeps an item with a null publishedAt (cannot prove it is old)", () => {
    const { kept, droppedOld } = filterRecentItems(
      [item(null)],
      RECENCY_WINDOW_DAYS,
      NOW,
    );
    expect(kept).toHaveLength(1);
    expect(droppedOld).toBe(0);
  });

  it("keeps an item exactly on the cutoff (boundary is inclusive: >= cutoff)", () => {
    const { kept, droppedOld } = filterRecentItems(
      [item(CUTOFF)],
      RECENCY_WINDOW_DAYS,
      NOW,
    );
    expect(kept).toHaveLength(1);
    expect(droppedOld).toBe(0);

    // One millisecond older than the cutoff is dropped.
    const justOld = filterRecentItems(
      [item(new Date(CUTOFF.getTime() - 1))],
      RECENCY_WINDOW_DAYS,
      NOW,
    );
    expect(justOld.kept).toHaveLength(0);
    expect(justOld.droppedOld).toBe(1);
  });

  it("partitions a mixed batch and preserves the fetched = kept + droppedOld invariant", () => {
    const batch = [
      item(new Date("2026-06-08T00:00:00.000Z")), // in window
      item(new Date("2026-01-01T00:00:00.000Z")), // old
      item(null), // undated → kept
      item(CUTOFF), // boundary → kept
      item(new Date("2025-12-31T00:00:00.000Z")), // old
    ];
    const { kept, droppedOld } = filterRecentItems(
      batch,
      RECENCY_WINDOW_DAYS,
      NOW,
    );
    expect(kept).toHaveLength(3);
    expect(droppedOld).toBe(2);
    expect(kept.length + droppedOld).toBe(batch.length);
  });

  it("pins the ingestion policy window at 30 days", () => {
    expect(RECENCY_WINDOW_DAYS).toBe(30);
  });
});
