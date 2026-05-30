import { listFiles, uploadFile, type UploadResult } from "./api.ts";
import { classifyAll } from "./classify.ts";
import { exportDateFromFilename, parseCsv } from "./parse.ts";
import type {
  OverridesMap,
  RawWeightReading,
  WeightReading,
} from "./types.ts";

/**
 * Eager glob import of every CSV in `data/`. Acts as the fast path on page
 * load — Vite inlines the contents at build time, so the chart can render
 * before any network round-trip. The persisted store (Vite dev plugin in
 * dev, Netlify Blobs in prod) is fetched in parallel and merged on top.
 */
const bundledCsvs = import.meta.glob("/data/*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadBundledRaw(): RawWeightReading[] {
  const all: RawWeightReading[] = [];
  for (const [path, text] of Object.entries(bundledCsvs)) {
    const filename = path.split("/").pop() ?? path;
    const exportDate = exportDateFromFilename(filename);
    if (!exportDate) {
      console.warn(
        `[data-loader] Skipping ${filename}: filename does not match poobox_activity_YYYY-MM-DD.csv`,
      );
      continue;
    }
    all.push(...parseCsv(text, exportDate, filename));
  }
  return all;
}

/**
 * Fetch every persisted CSV from the API and parse it. In dev these come
 * back from `data/` on disk (so they overlap with the bundled glob — the
 * dedupe pass handles it). In prod they come from Netlify Blobs.
 */
export async function loadPersistedRaw(): Promise<RawWeightReading[]> {
  const files = await listFiles();
  const all: RawWeightReading[] = [];
  for (const file of files) {
    const exportDate = exportDateFromFilename(file.name);
    if (!exportDate) {
      console.warn(
        `[data-loader] Skipping persisted ${file.name}: filename has no YYYY-MM-DD suffix.`,
      );
      continue;
    }
    all.push(...parseCsv(file.content, exportDate, file.name));
  }
  return all;
}

/**
 * Read an uploaded CSV File, persist it server-side via the API, and return
 * the locally-parsed readings (for instant feedback) alongside the upload
 * response.
 */
export async function uploadAndParse(
  file: File,
): Promise<{ readings: RawWeightReading[]; result: UploadResult }> {
  const text = await file.text();
  const result = await uploadFile(file.name, text);
  const exportDate =
    exportDateFromFilename(result.name) ?? new Date();
  if (!exportDateFromFilename(result.name)) {
    console.warn(
      `[data-loader] ${result.name} has no YYYY-MM-DD suffix; falling back to today's date for year inference.`,
    );
  }
  const readings = parseCsv(text, exportDate, result.name);
  return { readings, result };
}

/**
 * Classify and dedupe raw readings into the canonical dataset for the UI.
 * Dedupe key is `(timestamp, weight, cat)` — lets the same export coexist
 * in bundled `data/` and the persisted store without doubling the chart.
 */
export function buildDataset(
  raws: RawWeightReading[],
  overrides: OverridesMap,
): WeightReading[] {
  const classified = classifyAll(raws, overrides);
  const seen = new Set<string>();
  const out: WeightReading[] = [];
  for (const r of classified) {
    const dedupeKey = `${r.timestamp.getTime()}|${r.weightKg}|${r.catId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(r);
  }
  return out;
}
