export type CatId = "jasper" | "enzo";

/**
 * `endedAt`, when set, closes a cat's history: no reading after it can belong
 * to them. It's the single source of truth for both the classification guard
 * in `classify.ts` and the "ended" presentation of the stats card.
 */
export const CATS: Record<
  CatId,
  { name: string; color: string; endedAt?: Date }
> = {
  jasper: {
    name: "Jasper",
    color: "#0ea5e9",
    /**
     * Jasper passed away in June 2026. No export pins down the day — the data
     * jumps straight from 2026-06-01 (the vendor export's cutoff) to
     * 2026-07-07 — so this sits at the end of June: late enough that his real
     * final readings still classify normally, early enough to guard every
     * reading we actually have. Tighten it if a June export ever lands.
     */
    endedAt: new Date(2026, 5, 30, 23, 59, 59, 999),
  },
  enzo: { name: "Enzo", color: "#f59e0b" },
};

export const CAT_IDS: readonly CatId[] = ["jasper", "enzo"] as const;

/** A weight reading parsed from a CSV row, before cat assignment.
 *
 * Most parsers leave `catId` undefined and lean on `classify.ts`'s threshold
 * heuristic. The vendor bulk export (see `vendor-parse.ts`) carries a per-row
 * `pet_id`, so it pre-assigns `catId` and `classifyAll` honors it instead of
 * the threshold. User-set overrides still win over both. */
export interface RawWeightReading {
  timestamp: Date;
  weightKg: number;
  source: string;
  catId?: CatId;
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
