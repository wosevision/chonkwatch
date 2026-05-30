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
