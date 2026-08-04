import { isTrackedAt } from "./cats.ts";
import {
  readingKey,
  type Cat,
  type CatId,
  type OverridesMap,
  type RawWeightReading,
  type WeightReading,
} from "./types.ts";

/**
 * Assign each reading to a cat.
 *
 * The litter box weighs whoever is standing on it but doesn't say who that was,
 * so identity is inferred from weight. Each cat carries a `typicalWeightKg` and
 * a reading goes to whichever cat's typical weight is closest — the
 * generalization of the fixed 5.0 kg threshold this used to use, which only
 * worked for exactly two cats.
 *
 * Candidates are limited to cats actually being tracked at the reading's
 * timestamp (`startedAt`/`endedAt`). That's what keeps a newly adopted cat from
 * retroactively claiming an existing cat's history, and what stops a cat who has
 * passed away from reappearing when the surviving cat's weight drifts into the
 * range that used to be theirs.
 */

/** Nearest-weight assignment among the cats tracked at `when`.
 *
 * Returns null only when `cats` is empty. If no cat was being tracked at that
 * moment — a gap in the registry's coverage — the search widens to every cat
 * rather than discarding the reading, since silently dropping real data is
 * worse than attributing it imperfectly. */
export function catForWeight(
  cats: Cat[],
  weightKg: number,
  when: Date,
): CatId | null {
  if (cats.length === 0) return null;
  const tracked = cats.filter((c) => isTrackedAt(c, when));
  return nearest(tracked.length > 0 ? tracked : cats, weightKg);
}

function nearest(candidates: Cat[], weightKg: number): CatId {
  let best = candidates[0];
  let bestDelta = Math.abs(best.typicalWeightKg - weightKg);
  for (const cat of candidates.slice(1)) {
    const delta = Math.abs(cat.typicalWeightKg - weightKg);
    // Ties break on id so the result is stable across reloads rather than
    // depending on registry order.
    if (delta < bestDelta || (delta === bestDelta && cat.id < best.id)) {
      best = cat;
      bestDelta = delta;
    }
  }
  return best.id;
}

/**
 * Classify a batch of raw readings. Resolution order, highest priority first:
 *   1. The dropped-reading set (readings orphaned by deleting a cat) — skipped.
 *   2. User-set override for this reading key (`ignore` drops the row). An
 *      override naming a cat that no longer exists is ignored.
 *   3. Pre-assigned `catId` on the raw reading (the vendor-export path, which
 *      knows the cat from `pet_id`), as long as that cat still exists.
 *   4. Nearest typical weight among the cats tracked at that timestamp.
 *
 * Readings that can't be attributed to anyone — which only happens when the
 * registry is empty — are dropped.
 */
export function classifyAll(
  readings: RawWeightReading[],
  cats: Cat[],
  overrides: OverridesMap = {},
  dropped: ReadonlySet<string> = new Set(),
): WeightReading[] {
  const ids = new Set(cats.map((c) => c.id));
  const out: WeightReading[] = [];
  for (const r of readings) {
    const key = readingKey(r);
    if (dropped.has(key)) continue;

    const override = overrides[key];
    if (override === "ignore") continue;
    if (override && ids.has(override)) {
      out.push({ ...r, catId: override, key });
      continue;
    }

    if (r.catId && ids.has(r.catId)) {
      out.push({ ...r, catId: r.catId, key });
      continue;
    }

    const catId = catForWeight(cats, r.weightKg, r.timestamp);
    if (catId) out.push({ ...r, catId, key });
  }
  return out;
}
