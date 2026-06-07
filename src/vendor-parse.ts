import type { CatId, RawWeightReading } from "./types.ts";

/**
 * Parser for the vendor's bulk database export — a CSV with one row per
 * weight reading and ~35 columns of denormalized pet metadata, distinct from
 * the consumer-side `Activity,Timestamp,Value` exports handled by `parse.ts`.
 *
 * Why a separate file: the schema, units, quoting rules, and timestamp
 * format all differ from the simple format. Folding it into `parse.ts`
 * would make that file's "small + pure" framing harder to defend. This
 * parser is still pure (no DOM, no fetch) and returns the same
 * `RawWeightReading` shape, so the rest of the pipeline doesn't care.
 *
 * Key differences from the simple format we account for here:
 *   - **Quoting:** the vendor file uses RFC 4180 quoting (fields with
 *     embedded commas wrapped in `"…"`, embedded `"` doubled). We can't
 *     use the simple comma split.
 *   - **Units:** weights are in pounds, not kilograms.
 *   - **Per-row pet identity:** every row carries `pet_id`, so we can
 *     pre-assign `catId` instead of leaning on the threshold heuristic.
 *   - **Timestamps:** full UTC ISO with sub-second precision, e.g.
 *     `2025-06-01 22:08:38.394391+00` (space-separated, microsecond
 *     fractions, two-digit timezone offset).
 *   - **Soft deletes:** `metadata_delete=true` rows are vendor-side
 *     tombstones and must be skipped.
 */

const PET_ID_TO_CAT: Record<string, CatId> = {
  "PET-3fbe0a41-2fb6-4a49-bb55-0dbaffa2f0fc": "jasper",
  "PET-6b7d31d1-d4cf-4f94-b698-6d01c87d486f": "enzo",
};

const LBS_TO_KG = 0.45359237;

const REQUIRED_COLUMNS = [
  "pet_id",
  "last_weight_reading",
  "metadata_timestamp",
  "metadata_delete",
] as const;

/**
 * Cheap header-only sniff — used by the loader to pick between this parser
 * and the simple-format one without paying the full parse cost up front.
 * The vendor export's first column is always `pet_id`; the simple format's
 * is always `Activity`. Reading just the first line is enough.
 */
export function isVendorExport(text: string): boolean {
  const newlineIdx = text.indexOf("\n");
  const firstLine = newlineIdx >= 0 ? text.slice(0, newlineIdx) : text;
  return /^pet_id\s*,/i.test(firstLine);
}

export function parseVendorCsv(
  text: string,
  source: string,
): RawWeightReading[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const header = splitCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  const colIndex: Record<(typeof REQUIRED_COLUMNS)[number], number> = {
    pet_id: -1,
    last_weight_reading: -1,
    metadata_timestamp: -1,
    metadata_delete: -1,
  };
  for (const name of REQUIRED_COLUMNS) {
    const idx = header.indexOf(name);
    if (idx < 0) {
      console.error(
        `[vendor-parse] ${source}: missing required column "${name}". Skipping file.`,
      );
      return [];
    }
    colIndex[name] = idx;
  }

  const out: RawWeightReading[] = [];
  const unknownPets = new Set<string>();
  let deletedCount = 0;
  let invalidCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols = splitCsvRow(line);
    if (cols.length < header.length) {
      invalidCount++;
      continue;
    }

    if (cols[colIndex.metadata_delete].trim().toLowerCase() === "true") {
      deletedCount++;
      continue;
    }

    const petId = cols[colIndex.pet_id].trim();
    const catId = PET_ID_TO_CAT[petId];
    if (!catId) {
      unknownPets.add(petId);
      continue;
    }

    const lbs = Number.parseFloat(cols[colIndex.last_weight_reading]);
    if (!Number.isFinite(lbs) || lbs <= 0) {
      invalidCount++;
      continue;
    }
    const weightKg = lbs * LBS_TO_KG;

    const timestamp = parseVendorTimestamp(
      cols[colIndex.metadata_timestamp].trim(),
    );
    if (!timestamp) {
      invalidCount++;
      continue;
    }

    out.push({ timestamp, weightKg, source, catId });
  }

  if (deletedCount > 0) {
    console.info(
      `[vendor-parse] ${source}: skipped ${deletedCount} soft-deleted row(s).`,
    );
  }
  if (invalidCount > 0) {
    console.warn(
      `[vendor-parse] ${source}: skipped ${invalidCount} malformed row(s).`,
    );
  }
  if (unknownPets.size > 0) {
    console.warn(
      `[vendor-parse] ${source}: skipped readings for unknown pet_id(s): ${[...unknownPets].join(", ")}.`,
    );
  }

  return out;
}

/**
 * Single-row RFC 4180-ish splitter. Handles double-quoted fields, including
 * `""` as an escaped quote. Does not support fields with embedded newlines
 * (the vendor exports we've seen don't use them — every row is one line).
 */
function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse a vendor timestamp like `2025-06-01 22:08:38.394391+00` into a
 * `Date`. Normalizes to ISO 8601:
 *   - replace the date/time space with `T`
 *   - truncate sub-millisecond fractional digits (ECMA-262 only mandates
 *     three; engines vary on whether they accept more)
 *   - pad a bare two-digit timezone offset to `±HH:MM`
 */
function parseVendorTimestamp(raw: string): Date | null {
  const normalized = raw
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
