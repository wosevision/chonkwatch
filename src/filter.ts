import {
  DATE_RANGES,
  type DateRangeId,
  type WeightReading,
} from "./types.ts";

/**
 * Keep readings whose timestamp falls inside the selected preset window,
 * anchored to the most recent reading (not "now") so an old data set still
 * shows results when a tight window is selected.
 */
export function filterByRange(
  readings: WeightReading[],
  rangeId: DateRangeId,
): WeightReading[] {
  const days = DATE_RANGES[rangeId].days;
  if (days === null || readings.length === 0) return readings;

  let latest = readings[0].timestamp.getTime();
  for (const r of readings) {
    const t = r.timestamp.getTime();
    if (t > latest) latest = t;
  }
  const cutoff = latest - days * 24 * 60 * 60 * 1000;
  return readings.filter((r) => r.timestamp.getTime() >= cutoff);
}
