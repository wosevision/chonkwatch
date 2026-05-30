import type { CatId, DailyAggregate, WeightReading } from "./types.ts";

/**
 * Group readings by local-day and cat, returning median/min/max/count per
 * group. Median is preferred over mean because the scale catches mid-deposit
 * weights that pull averages around; medians are robust to those.
 */
export function aggregateDailyMedian(
  readings: WeightReading[],
): DailyAggregate[] {
  const buckets = new Map<string, WeightReading[]>();
  for (const r of readings) {
    const key = `${localIsoDate(r.timestamp)}|${r.catId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(r);
  }

  const out: DailyAggregate[] = [];
  for (const [key, group] of buckets) {
    const [date, catId] = key.split("|") as [string, CatId];
    const weights = group.map((g) => g.weightKg).sort((a, b) => a - b);
    out.push({
      date,
      catId,
      median: median(weights),
      min: weights[0],
      max: weights[weights.length - 1],
      count: weights.length,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * Trailing rolling median across a sequence of values. Operates on
 * data-point indices rather than calendar days, so a sparse week will still
 * yield a meaningful smoother (at the cost of representing a longer stretch
 * of wall-clock time).
 *
 * The first `windowSize - 1` outputs are computed against shorter windows so
 * the smoother still has values at the edges instead of being all-`null`.
 */
export function rollingMedian(values: number[], windowSize: number): number[] {
  if (windowSize <= 1) return values.slice();
  const out: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = values.slice(start, i + 1).sort((a, b) => a - b);
    out[i] = median(slice);
  }
  return out;
}

/** YYYY-MM-DD in the user's local timezone (matches how the CSV is read). */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
