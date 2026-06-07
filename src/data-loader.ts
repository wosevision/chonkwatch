import { listFiles, uploadFile, type UploadResult } from "./api.ts";
import { classifyAll } from "./classify.ts";
import { exportDateFromFilename, parseCsv } from "./parse.ts";
import { isVendorExport, parseVendorCsv } from "./vendor-parse.ts";
import type {
  OverridesMap,
  RawWeightReading,
  WeightReading,
} from "./types.ts";

/**
 * Eager glob import of every monthly CSV in `data/`. Acts as the fast path
 * on page load — Vite inlines the contents at build time, so the chart can
 * render before any network round-trip. The persisted store (Vite dev plugin
 * in dev, Netlify Blobs in prod) is fetched in parallel and merged on top.
 *
 * The pattern intentionally requires an underscore (`poobox_activity_`),
 * which excludes the dash-separated vendor bulk export
 * (`poobox_activity-export.csv`) from the bundle. That file is ~1.7 MB and
 * inlining it into the JS payload would balloon initial load; it's served
 * via `/api/csvs` instead and parsed client-side after the round-trip.
 */
const bundledCsvs = import.meta.glob("/data/poobox_activity_*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadBundledRaw(): RawWeightReading[] {
  const all: RawWeightReading[] = [];
  for (const [path, text] of Object.entries(bundledCsvs)) {
    const filename = path.split("/").pop() ?? path;
    all.push(...parseOne(text, filename));
  }
  return all;
}

/**
 * Fetch every persisted CSV from the API and parse it. In dev these come
 * back from `data/` on disk (so they overlap with the bundled glob — the
 * dedupe pass handles it). In prod they come from Netlify Blobs. The
 * vendor bulk export only flows through this path (it's not in the bundle).
 */
export async function loadPersistedRaw(): Promise<RawWeightReading[]> {
  const files = await listFiles();
  const all: RawWeightReading[] = [];
  for (const file of files) {
    all.push(...parseOne(file.content, file.name));
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
  return { readings: parseOne(text, result.name), result };
}

/**
 * Format-aware parse dispatch. Sniffs the header to pick between the vendor
 * bulk export parser and the simple monthly-export parser, so the rest of
 * the loader doesn't need to care which format a given file uses.
 */
function parseOne(text: string, filename: string): RawWeightReading[] {
  if (isVendorExport(text)) {
    return parseVendorCsv(text, filename);
  }
  const exportDate = exportDateFromFilename(filename) ?? new Date();
  if (!exportDateFromFilename(filename)) {
    console.warn(
      `[data-loader] ${filename} has no YYYY-MM-DD or M-D-YYYY suffix; falling back to today's date for year inference.`,
    );
  }
  return parseCsv(text, exportDate, filename);
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
