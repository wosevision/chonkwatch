import { exportDateFromFilename, parseCsv } from "./parse.ts";
import { classifyAll } from "./classify.ts";
import type { WeightReading } from "./types.ts";

/**
 * Eager glob import of every CSV in `data/`. Each match is resolved to its raw
 * text so we can parse it client-side without a network fetch. Vite handles
 * filesystem watching, so dropping a new monthly export into `data/` and
 * refreshing is enough to see it on the chart.
 */
const bundledCsvs = import.meta.glob("/data/*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadBundledReadings(): WeightReading[] {
  const all: WeightReading[] = [];
  for (const [path, text] of Object.entries(bundledCsvs)) {
    const filename = path.split("/").pop() ?? path;
    const exportDate = exportDateFromFilename(filename);
    if (!exportDate) {
      console.warn(
        `[data-loader] Skipping ${filename}: filename does not match poobox_activity_YYYY-MM-DD.csv`,
      );
      continue;
    }
    const raw = parseCsv(text, exportDate, filename);
    all.push(...classifyAll(raw));
  }
  return all;
}

/**
 * Read a user-uploaded CSV file. Falls back to today as the export date when
 * the filename doesn't carry one — most uploads will be recent exports, and
 * any year-rollover risk is small enough to live with for v1.
 */
export async function readUploadedCsv(file: File): Promise<WeightReading[]> {
  const text = await file.text();
  const exportDate = exportDateFromFilename(file.name) ?? new Date();
  if (!exportDateFromFilename(file.name)) {
    console.warn(
      `[data-loader] ${file.name} has no YYYY-MM-DD suffix; falling back to today's date for year inference.`,
    );
  }
  const raw = parseCsv(text, exportDate, file.name);
  return classifyAll(raw);
}

/**
 * Deduplicate readings by exact timestamp+weight+cat. Lets the user upload the
 * same export twice (or upload a file that's also bundled) without doubling
 * the underlying datapoints.
 */
export function dedupe(readings: WeightReading[]): WeightReading[] {
  const seen = new Set<string>();
  const out: WeightReading[] = [];
  for (const r of readings) {
    const key = `${r.timestamp.getTime()}|${r.weightKg}|${r.catId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
