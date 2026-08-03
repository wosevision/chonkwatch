import {
  CATS,
  readingKey,
  type CatId,
  type OverridesMap,
  type RawWeightReading,
  type WeightReading,
} from "./types.ts";

/**
 * Threshold (kg) separating Enzo (lighter) from Jasper (heavier).
 *
 * Picked as the rough midpoint between the two visible clusters in the initial
 * data (~4.5 kg vs ~5.6 kg). If either cat's typical weight drifts close to
 * this value, revisit — the per-reading override UI is the user-facing escape
 * hatch when individual rows misclassify.
 *
 * Only readings up to `CATS.jasper.endedAt` are subject to this at all; see
 * `thresholdCat` below.
 */
export const WEIGHT_THRESHOLD_KG = 5.0;

/** Threshold-only classify, used when no overrides apply. */
export function classify(reading: RawWeightReading): WeightReading {
  return {
    ...reading,
    catId: thresholdCat(reading),
    key: readingKey(reading),
  };
}

/**
 * The weight threshold, plus one guard: a cat whose `endedAt` has passed can't
 * be the source of a later reading, so such readings go to the surviving cat
 * regardless of weight.
 *
 * The guard matters because Enzo sits only ~300 g under `WEIGHT_THRESHOLD_KG`.
 * Without it, him gaining a little weight would silently split his series and
 * start growing Jasper's again, hiding the gain this app exists to surface.
 */
function thresholdCat(reading: RawWeightReading): CatId {
  const jasperEnd = CATS.jasper.endedAt;
  if (jasperEnd && reading.timestamp.getTime() > jasperEnd.getTime()) {
    return "enzo";
  }
  return reading.weightKg >= WEIGHT_THRESHOLD_KG ? "jasper" : "enzo";
}

/**
 * Classify a batch of raw readings. Resolution order, highest priority first:
 *   1. User-set override for this reading key (`ignore` drops the row).
 *   2. Pre-assigned `catId` on the raw reading (used by the vendor-export
 *      path, which knows the cat from `pet_id`).
 *   3. The threshold heuristic in `classify` (which itself won't attribute a
 *      reading to a cat whose `endedAt` has already passed).
 */
export function classifyAll(
  readings: RawWeightReading[],
  overrides: OverridesMap = {},
): WeightReading[] {
  const out: WeightReading[] = [];
  for (const r of readings) {
    const key = readingKey(r);
    const override = overrides[key];
    if (override === "ignore") continue;
    if (override === "jasper" || override === "enzo") {
      out.push({ ...r, catId: override, key });
    } else if (r.catId) {
      out.push({ ...r, catId: r.catId, key });
    } else {
      out.push(classify(r));
    }
  }
  return out;
}
