// Recency bound for ingestion. Without it, a first poll of a feed that exposes
// its full archive (openai-news dumped 996 items, huggingface-blog 797) backfills
// years of history. We keep only items published within the last N days.
//
// The window is a module-level CONSTANT, deliberately NOT an env var: empty-value
// env coercion is a footgun (cf. the VOYAGE_* issue) and a single number is
// tunable by one edit here. Pure + `now`-injectable, so it is offline-testable.

export const RECENCY_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RecencyFilterResult<T> {
  kept: T[];
  droppedOld: number;
}

// Partition items by recency. An item is KEPT when its publishedAt is null (we
// cannot prove it is old — undated entries pass) OR is at/after the cutoff
// (now − windowDays). Items strictly older than the cutoff are dropped. The
// boundary is inclusive: publishedAt === cutoff is kept.
export function filterRecentItems<T extends { publishedAt: Date | null }>(
  items: T[],
  windowDays: number,
  now: Date = new Date(),
): RecencyFilterResult<T> {
  const cutoff = now.getTime() - windowDays * MS_PER_DAY;
  const kept: T[] = [];
  let droppedOld = 0;
  for (const item of items) {
    if (item.publishedAt === null || item.publishedAt.getTime() >= cutoff) {
      kept.push(item);
    } else {
      droppedOld += 1;
    }
  }
  return { kept, droppedOld };
}
