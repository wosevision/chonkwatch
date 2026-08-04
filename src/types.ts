/**
 * A cat's stable identifier. Opaque at runtime — the seeded cats use readable
 * slugs (`jasper`, `enzo`) for legibility, while cats added through the UI get
 * generated ids. It's never derived from the name, so renaming a cat can't
 * orphan the per-reading overrides or vendor mapping that point at it.
 */
export type CatId = string;

/**
 * One tracked cat. This is user-managed data (see `cats.ts` and the manage-cats
 * dialog), persisted server-side rather than hardcoded.
 *
 * Dates are `YYYY-MM-DD` strings rather than `Date` objects so the record
 * survives a JSON round-trip and maps directly onto `<input type="date">`.
 * Use `startBoundary` / `endBoundary` in `cats.ts` to get comparable instants.
 */
export interface Cat {
  id: CatId;
  name: string;
  /** Any CSS color; the chart, swatch, and range band all derive from it. */
  color: string;
  /**
   * Rough everyday weight in kg. Drives classification: a reading goes to
   * whichever tracked cat's typical weight is closest. Doesn't need to be
   * exact, only closer to this cat than to any other.
   */
  typicalWeightKg: number;
  /**
   * First day this cat was in the household, if known. Readings before it
   * aren't attributed to them, which is what stops a newly added cat from
   * retroactively claiming an existing cat's history.
   */
  startedAt?: string;
  /**
   * Last day this cat was tracked. Set this when a cat passes away — their
   * history stays intact and only later readings are excluded. This is the
   * supported alternative to deleting a cat.
   */
  endedAt?: string;
  /**
   * `pet_id` from the vendor bulk export, when known. Readings carrying it are
   * attributed exactly, bypassing the weight heuristic entirely.
   */
  vendorPetId?: string;
  /** Display only; never used for classification. */
  birthday?: string;
  notes?: string;
}

/**
 * The persisted cat document. Versioned so a future shape change can migrate
 * rather than guess.
 */
export interface CatStore {
  version: 1;
  cats: Cat[];
  /**
   * `readingKey`s excluded from the dataset because the cat they belonged to
   * was deleted. Readings live in immutable CSVs, so "delete this cat's
   * readings" can only be expressed as a key-level exclusion list. Lives
   * beside the cats (rather than in `localStorage` with the per-reading
   * overrides) so every device agrees on which readings exist.
   */
  droppedReadingKeys: string[];
}

/** A weight reading parsed from a CSV row, before cat assignment.
 *
 * Most parsers leave `catId` undefined and lean on the weight heuristic in
 * `classify.ts`. The vendor bulk export (see `vendor-parse.ts`) carries a
 * per-row `pet_id`, so it pre-assigns `catId` for any cat with a matching
 * `vendorPetId` and `classifyAll` honors it instead of the heuristic.
 * User-set overrides still win over both. */
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

/** Per-reading override decision: a `CatId`, or `ignore` to remove the row
 * from the dataset (e.g. obvious dud weights from human/dog interference).
 * An override naming a cat that no longer exists is treated as absent. */
export type Override = CatId | "ignore";

export type OverridesMap = Record<string, Override>;

/** Returns a stable string key for use as override / outlier map index. */
export function readingKey(
  r: Pick<RawWeightReading, "timestamp" | "weightKg">,
): string {
  return `${r.timestamp.toISOString()}:${r.weightKg.toFixed(2)}`;
}
