import type { CatId, RawWeightReading, WeightReading } from "./types.ts";

/**
 * Threshold (kg) separating Enzo (lighter) from Jasper (heavier).
 *
 * Picked as the rough midpoint between the two visible clusters in the initial
 * data (~4.5 kg vs ~5.6 kg). If either cat's typical weight drifts close to
 * this value, revisit — and consider promoting this to a per-reading override
 * UI as discussed in `AGENTS.md`.
 */
export const WEIGHT_THRESHOLD_KG = 5.0;

export function classify(reading: RawWeightReading): WeightReading {
  const catId: CatId =
    reading.weightKg >= WEIGHT_THRESHOLD_KG ? "jasper" : "enzo";
  return { ...reading, catId };
}

export function classifyAll(readings: RawWeightReading[]): WeightReading[] {
  return readings.map(classify);
}
