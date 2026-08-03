import { CAT_IDS, CATS, type CatId, type WeightReading } from "./types.ts";

export interface CatStats {
  latestKg: number | null;
  latestAt: Date | null;
  firstAt: Date | null;
  avg30dKg: number | null;
  count: number;
  /** True when this cat's history is closed — see `CATS[catId].endedAt`. */
  ended: boolean;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function computeStats(
  readings: WeightReading[],
): Record<CatId, CatStats> {
  const result = {} as Record<CatId, CatStats>;
  const now = Date.now();

  for (const catId of CAT_IDS) {
    const ended = CATS[catId].endedAt != null;
    const forCat = readings
      .filter((r) => r.catId === catId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (forCat.length === 0) {
      result[catId] = {
        latestKg: null,
        latestAt: null,
        firstAt: null,
        avg30dKg: null,
        count: 0,
        ended,
      };
      continue;
    }

    const latest = forCat[forCat.length - 1];
    // For a cat whose history is closed, a window ending at wall-clock `now`
    // would always be empty, so anchor to their final reading instead: the
    // number then reads as "their last 30 days" rather than "no data".
    const anchor = ended ? latest.timestamp.getTime() : now;
    const recent = forCat.filter((r) => {
      const t = r.timestamp.getTime();
      return t <= anchor && anchor - t <= THIRTY_DAYS_MS;
    });
    const avg30d =
      recent.length > 0
        ? recent.reduce((sum, r) => sum + r.weightKg, 0) / recent.length
        : null;

    result[catId] = {
      latestKg: latest.weightKg,
      latestAt: latest.timestamp,
      firstAt: forCat[0].timestamp,
      avg30dKg: avg30d,
      count: forCat.length,
      ended,
    };
  }

  return result;
}
