import { CAT_IDS, type CatId, type WeightReading } from "./types.ts";

/** Robust z-score threshold for "this looks bad" — chosen empirically; tune
 * if too many or too few points are flagged in practice. */
export const OUTLIER_THRESHOLD = 3.0;

/** Constant that makes MAD comparable to a normal distribution's standard
 * deviation (approximate; see https://en.wikipedia.org/wiki/Median_absolute_deviation). */
const MAD_TO_SD = 1.4826;

/**
 * Compute a per-cat MAD-based outlier flag for each reading. MAD (median
 * absolute deviation) is preferred over mean+sd because the data already
 * contains plenty of "kind of bad" readings — the mean would be pulled
 * around by them while MAD ignores them.
 *
 * Returns a `Set<readingKey>` of flagged readings.
 */
export function detectOutliers(readings: WeightReading[]): Set<string> {
  const flagged = new Set<string>();
  for (const catId of CAT_IDS) {
    const forCat = readings.filter((r) => r.catId === catId);
    if (forCat.length < 4) continue; // not enough signal to call outliers
    const weights = forCat.map((r) => r.weightKg);
    const med = median(weights);
    const deviations = weights.map((w) => Math.abs(w - med));
    const mad = median(deviations);
    if (mad === 0) continue; // every reading equal — outliers undefined
    const sdLike = mad * MAD_TO_SD;
    for (const r of forCat) {
      if (Math.abs(r.weightKg - med) / sdLike > OUTLIER_THRESHOLD) {
        flagged.add(r.key);
      }
    }
  }
  return flagged;
}

/** A non-mutating median over an unsorted input array. */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Convenience: split a cat's readings into normal vs outlier subsets. */
export function partitionByOutlier(
  readings: WeightReading[],
  flagged: Set<string>,
  catId: CatId,
): { normal: WeightReading[]; outliers: WeightReading[] } {
  const normal: WeightReading[] = [];
  const outliers: WeightReading[] = [];
  for (const r of readings) {
    if (r.catId !== catId) continue;
    if (flagged.has(r.key)) outliers.push(r);
    else normal.push(r);
  }
  return { normal, outliers };
}
