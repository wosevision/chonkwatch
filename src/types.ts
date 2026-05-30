export type CatId = "jasper" | "enzo";

export const CATS: Record<CatId, { name: string; color: string }> = {
  jasper: { name: "Jasper", color: "#0ea5e9" },
  enzo: { name: "Enzo", color: "#f59e0b" },
};

export const CAT_IDS: readonly CatId[] = ["jasper", "enzo"] as const;

/** A weight reading parsed from a CSV row, before cat assignment. */
export interface RawWeightReading {
  timestamp: Date;
  weightKg: number;
  source: string;
}

/** A weight reading attributed to a specific cat. */
export interface WeightReading extends RawWeightReading {
  catId: CatId;
  /**
   * Stable key for per-reading overrides + outlier maps. Derived from
   * `(timestamp, weightKg)`. Two distinct readings sharing both fields would
   * collide, but the litter-box scale's resolution makes that vanishingly
   * unlikely.
   */
  key: string;
}

/** One cat's daily-aggregated weight summary. */
export interface DailyAggregate {
  date: string;
  catId: CatId;
  median: number;
  min: number;
  max: number;
  count: number;
}

export type ViewMode = "daily" | "raw";

export type DateRangeId = "all" | "1y" | "90d" | "30d";

export const DATE_RANGES: Record<
  DateRangeId,
  { label: string; days: number | null }
> = {
  all: { label: "All", days: null },
  "1y": { label: "1Y", days: 365 },
  "90d": { label: "90D", days: 90 },
  "30d": { label: "30D", days: 30 },
};

/** Default to "All" since most users will only have a few months of data. */
export const DEFAULT_DATE_RANGE: DateRangeId = "all";

/** Per-reading override decision. `ignore` removes a row from the dataset
 * (e.g. obvious dud weights from human/dog interference). */
export type Override = CatId | "ignore";

export type OverridesMap = Record<string, Override>;

/** Returns a stable string key for use as override / outlier map index. */
export function readingKey(
  r: Pick<RawWeightReading, "timestamp" | "weightKg">,
): string {
  return `${r.timestamp.toISOString()}:${r.weightKg.toFixed(2)}`;
}
