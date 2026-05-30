import { CAT_IDS, type CatId, type WeightReading } from "./types.ts";

export interface CatStats {
  latestKg: number | null;
  latestAt: Date | null;
  avg30dKg: number | null;
  count: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function computeStats(
  readings: WeightReading[],
): Record<CatId, CatStats> {
  const result = {} as Record<CatId, CatStats>;
  const now = Date.now();

  for (const catId of CAT_IDS) {
    const forCat = readings
      .filter((r) => r.catId === catId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (forCat.length === 0) {
      result[catId] = {
        latestKg: null,
        latestAt: null,
        avg30dKg: null,
        count: 0,
      };
      continue;
    }

    const latest = forCat[forCat.length - 1];
    const recent = forCat.filter(
      (r) => now - r.timestamp.getTime() <= THIRTY_DAYS_MS,
    );
    const avg30d =
      recent.length > 0
        ? recent.reduce((sum, r) => sum + r.weightKg, 0) / recent.length
        : null;

    result[catId] = {
      latestKg: latest.weightKg,
      latestAt: latest.timestamp,
      avg30dKg: avg30d,
      count: forCat.length,
    };
  }

  return result;
}
