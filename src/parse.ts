import type { RawWeightReading } from "./types.ts";

/**
 * Parse a `poobox_activity_*.csv` export into raw weight readings.
 *
 * The CSV schema is `Activity,Timestamp,Value` with quirks documented in
 * `AGENTS.md`. The export tool has shipped two slightly different timestamp
 * formats over time, so this parser accepts both interchangeably:
 *   - `MM-DD H:MM a.m./p.m.` (current export, dash-separated, lowercase
 *     periods, leading space before the meridiem).
 *   - `M/D H:MMAM/PM`        (older export, slash-separated, uppercase
 *     meridiem with no separating space and no periods).
 * Both lack a year, so we infer it from `exportDate` (typically derived from
 * the filename — see `exportDateFromFilename`, which also handles two shapes).
 *
 * Non-`Weight recorded` rows (case-insensitive) and malformed rows are skipped
 * silently. Rows with units other than `kg` are skipped with a console warning,
 * since a unit mix-up would silently corrupt the chart.
 */
export function parseCsv(
  text: string,
  exportDate: Date,
  source: string,
): RawWeightReading[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const out: RawWeightReading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i === 0 && /^activity\s*,/i.test(line)) continue;

    const cols = splitCsvRow(line);
    if (cols.length < 3) continue;

    const [activity, timestampStr, valueStr] = cols;
    if (activity.trim().toLowerCase() !== "weight recorded") continue;

    const timestamp = parseTimestamp(timestampStr.trim(), exportDate);
    if (!timestamp) continue;

    const weight = parseWeight(valueStr.trim(), source);
    if (weight === null) continue;

    out.push({ timestamp, weightKg: weight, source });
  }

  return out;
}

/**
 * Extract the export date from a filename. Two shapes are accepted, matching
 * the two export-tool generations we've seen:
 *   - `..._YYYY-MM-DD.csv` (current — year first, zero-padded month/day).
 *   - `..._M-D-YYYY.csv`   (older — year last, month/day not zero-padded).
 *
 * The two patterns are unambiguous because exactly one of the date's outer
 * components has four digits. Returns `null` if neither matches; caller
 * decides the fallback.
 */
export function exportDateFromFilename(filename: string): Date | null {
  const stripped = filename.replace(/\.csv$/i, "");

  const ymd = stripped.match(/(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return buildDate(Number(y), Number(m), Number(d));
  }

  const mdy = stripped.match(/(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return buildDate(Number(y), Number(m), Number(d));
  }

  return null;
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Naive CSV row splitter. The litter-box export uses no quoting or escaping in
 * any row we've seen, so a plain comma split is sufficient. If that ever
 * changes, swap this for a real CSV library.
 */
function splitCsvRow(line: string): string[] {
  return line.split(",");
}

const TIMESTAMP_RE =
  /^(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.|am|pm)$/i;

function parseTimestamp(raw: string, exportDate: Date): Date | null {
  const match = raw.match(TIMESTAMP_RE);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  let hour = Number(match[3]);
  const minute = Number(match[4]);
  // Both `a.m.`/`p.m.` and `am`/`pm` flow through the same regex; the first
  // letter is enough to disambiguate.
  const isPm = match[5][0].toLowerCase() === "p";

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  if (isPm && hour !== 12) hour += 12;
  else if (!isPm && hour === 12) hour = 0;

  // The CSV omits the year. Assume rows on/before the export's MM-DD belong
  // to the export year; later MM-DDs must be from the previous year (e.g. a
  // December row in a January export).
  const exportMonth = exportDate.getMonth() + 1;
  const exportDay = exportDate.getDate();
  const exportYear = exportDate.getFullYear();
  const year =
    month < exportMonth || (month === exportMonth && day <= exportDay)
      ? exportYear
      : exportYear - 1;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

const WEIGHT_RE = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/;

function parseWeight(raw: string, source: string): number | null {
  const match = raw.match(WEIGHT_RE);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit !== "kg") {
    console.warn(
      `[parse] Skipping reading with unexpected unit "${unit}" in ${source}: ${raw}`,
    );
    return null;
  }
  return value;
}
