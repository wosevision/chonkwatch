import {
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
 */
export const WEIGHT_THRESHOLD_KG = 5.0;

/** Threshold-only classify, used when no overrides apply. */
export function classify(reading: RawWeightReading): WeightReading {
  const catId: CatId =
    reading.weightKg >= WEIGHT_THRESHOLD_KG ? "jasper" : "enzo";
  return { ...reading, catId, key: readingKey(reading) };
}

/**
 * Classify a batch of raw readings, honoring any per-reading overrides.
 * Readings whose override is `ignore` are dropped from the output.
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
    } else {
      out.push(classify(r));
    }
  }
  return out;
}
