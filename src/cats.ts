import type { Cat, CatId, CatStore, OverridesMap } from "./types.ts";

/**
 * The cat registry: seed data, validation, and pure CRUD over a `CatStore`.
 *
 * No DOM and no fetch here — `api.ts` moves the store over the wire and
 * `cats-ui.ts` drives the form. Every mutation returns a new store rather than
 * editing in place, so `main.ts` can treat it like any other render input.
 */

/**
 * Seed used the first time the app runs against an empty store. These are the
 * two cats the app was originally built around, carried over verbatim so an
 * existing deployment keeps classifying its history exactly as before —
 * including Jasper's end date and both vendor `pet_id`s.
 */
export const SEED_CATS: Cat[] = [
  {
    id: "jasper",
    name: "Jasper",
    color: "#0ea5e9",
    typicalWeightKg: 5.6,
    // Jasper passed away in June 2026. No export pins down the day (the data
    // jumps from 2026-06-01 to 2026-07-07), so this sits at the end of the
    // month: late enough that his real final readings still classify normally,
    // early enough to exclude everything after the gap.
    endedAt: "2026-06-30",
    vendorPetId: "PET-3fbe0a41-2fb6-4a49-bb55-0dbaffa2f0fc",
  },
  {
    id: "enzo",
    name: "Enzo",
    color: "#f59e0b",
    typicalWeightKg: 4.5,
    vendorPetId: "PET-6b7d31d1-d4cf-4f94-b698-6d01c87d486f",
  },
];

/** Palette offered in the colour picker; the next unused one is preselected
 * when adding a cat, so two cats don't silently share a colour. */
export const CAT_COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#a855f7",
  "#ef4444",
  "#14b8a6",
  "#f472b6",
  "#84cc16",
];

export function seedStore(): CatStore {
  return { version: 1, cats: SEED_CATS.map((c) => ({ ...c })), droppedReadingKeys: [] };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Coerce an untrusted blob (API response, hand-edited JSON) into a usable
 * store. Anything unparseable is dropped rather than thrown on: a mangled cat
 * record shouldn't make the whole app fail to render. Returns null when there's
 * nothing usable at all, which the caller treats as "not seeded yet".
 */
export function normalizeStore(input: unknown): CatStore | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { cats?: unknown; droppedReadingKeys?: unknown };
  if (!Array.isArray(raw.cats)) return null;

  const cats: Cat[] = [];
  for (const entry of raw.cats) {
    const cat = normalizeCat(entry);
    if (cat && !cats.some((c) => c.id === cat.id)) cats.push(cat);
  }
  const dropped = Array.isArray(raw.droppedReadingKeys)
    ? raw.droppedReadingKeys.filter((k): k is string => typeof k === "string")
    : [];
  return { version: 1, cats, droppedReadingKeys: dropped };
}

function normalizeCat(input: unknown): Cat | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  const weight = Number(raw.typicalWeightKg);
  const cat: Cat = {
    id,
    name,
    color: typeof raw.color === "string" && HEX_COLOR_RE.test(raw.color)
      ? raw.color
      : CAT_COLORS[0],
    typicalWeightKg: Number.isFinite(weight) && weight > 0 ? weight : 4.5,
  };
  for (const field of ["startedAt", "endedAt", "birthday"] as const) {
    const value = raw[field];
    if (typeof value === "string" && DATE_RE.test(value)) cat[field] = value;
  }
  for (const field of ["vendorPetId", "notes"] as const) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) cat[field] = value.trim();
  }
  return cat;
}

/** A cat's fields as the edit form collects them, before validation. */
export type CatDraft = Omit<Cat, "id">;

/**
 * Validate a draft against the rest of the registry. Returns human-readable
 * messages for display in the form; an empty array means valid. `editingId` is
 * the cat being edited, excluded from uniqueness checks against itself.
 */
export function validateDraft(
  draft: CatDraft,
  cats: Cat[],
  editingId?: CatId,
): string[] {
  const errors: string[] = [];
  const others = cats.filter((c) => c.id !== editingId);

  if (!draft.name.trim()) {
    errors.push("Name is required.");
  } else if (
    others.some((c) => c.name.toLowerCase() === draft.name.trim().toLowerCase())
  ) {
    errors.push(`Another cat is already called "${draft.name.trim()}".`);
  }

  if (!HEX_COLOR_RE.test(draft.color)) {
    errors.push("Color must be a hex value like #0ea5e9.");
  }

  if (!Number.isFinite(draft.typicalWeightKg) || draft.typicalWeightKg <= 0) {
    errors.push("Typical weight must be a positive number of kilograms.");
  } else if (draft.typicalWeightKg > 25) {
    errors.push("Typical weight looks implausible for a cat (over 25 kg).");
  }

  for (const [field, label] of [
    ["startedAt", "Start date"],
    ["endedAt", "End date"],
    ["birthday", "Birthday"],
  ] as const) {
    const value = draft[field];
    if (value && !DATE_RE.test(value)) {
      errors.push(`${label} must be a valid date.`);
    }
  }

  if (draft.startedAt && draft.endedAt && draft.startedAt > draft.endedAt) {
    errors.push("End date can't be before the start date.");
  }

  if (draft.vendorPetId) {
    const clash = others.find((c) => c.vendorPetId === draft.vendorPetId);
    if (clash) {
      errors.push(`${clash.name} already uses that vendor pet ID.`);
    }
  }

  // Two cats with the same typical weight make the nearest-weight rule a coin
  // flip, and the tie-break is arbitrary. Warn rather than block: overlapping
  // weights are legitimate if their tracked periods don't overlap.
  const clash = others.find(
    (c) =>
      Math.abs(c.typicalWeightKg - draft.typicalWeightKg) < 0.1 &&
      periodsOverlap(draft, c),
  );
  if (clash) {
    errors.push(
      `${clash.name} has nearly the same typical weight (${clash.typicalWeightKg} kg) over an overlapping period, so readings can't be told apart. Separate the weights or set start/end dates.`,
    );
  }

  return errors;
}

function periodsOverlap(
  a: Pick<Cat, "startedAt" | "endedAt">,
  b: Pick<Cat, "startedAt" | "endedAt">,
): boolean {
  const aStart = a.startedAt ?? "0000-01-01";
  const aEnd = a.endedAt ?? "9999-12-31";
  const bStart = b.startedAt ?? "0000-01-01";
  const bEnd = b.endedAt ?? "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Generate a stable id. Slug of the name when that's free, otherwise a random
 * suffix. The slug is only ever computed once, at creation — renaming later
 * leaves the id (and everything referencing it) untouched.
 */
export function newCatId(name: string, cats: Cat[]): CatId {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const taken = new Set(cats.map((c) => c.id));
  if (slug && !taken.has(slug)) return slug;
  const base = slug || "cat";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function addCat(store: CatStore, draft: CatDraft): CatStore {
  const cat: Cat = { id: newCatId(draft.name, store.cats), ...compact(draft) };
  return { ...store, cats: [...store.cats, cat] };
}

export function updateCat(
  store: CatStore,
  id: CatId,
  draft: CatDraft,
): CatStore {
  return {
    ...store,
    cats: store.cats.map((c) => (c.id === id ? { id, ...compact(draft) } : c)),
  };
}

/**
 * Remove a cat and drop the readings currently attributed to them.
 *
 * Deletion is for correcting a mistaken entry, not for recording that a cat has
 * passed away — that's what `endedAt` is for, and it keeps the history. The
 * confirmation dialog says as much before this ever runs.
 *
 * `keysToDrop` are the reading keys presently assigned to this cat. They're
 * recorded in the store because the readings themselves live in immutable CSVs;
 * without the exclusion list they'd simply be reassigned to whichever remaining
 * cat is closest in weight.
 */
export function deleteCat(
  store: CatStore,
  id: CatId,
  keysToDrop: string[],
): CatStore {
  const dropped = new Set(store.droppedReadingKeys);
  for (const key of keysToDrop) dropped.add(key);
  return {
    version: 1,
    cats: store.cats.filter((c) => c.id !== id),
    droppedReadingKeys: [...dropped],
  };
}

/** Strip empty optional fields so the persisted JSON stays tidy. */
function compact(draft: CatDraft): CatDraft {
  const out: CatDraft = {
    name: draft.name.trim(),
    color: draft.color,
    typicalWeightKg: draft.typicalWeightKg,
  };
  if (draft.startedAt) out.startedAt = draft.startedAt;
  if (draft.endedAt) out.endedAt = draft.endedAt;
  if (draft.birthday) out.birthday = draft.birthday;
  if (draft.vendorPetId?.trim()) out.vendorPetId = draft.vendorPetId.trim();
  if (draft.notes?.trim()) out.notes = draft.notes.trim();
  return out;
}

export function catById(cats: Cat[], id: CatId): Cat | undefined {
  return cats.find((c) => c.id === id);
}

export function catName(cats: Cat[], id: CatId): string {
  return catById(cats, id)?.name ?? id;
}

/** Inclusive start of a cat's tracked window, or null when unbounded. */
export function startBoundary(cat: Cat): Date | null {
  return cat.startedAt ? dayStart(cat.startedAt) : null;
}

/** Inclusive end of a cat's tracked window, or null when unbounded. `endedAt`
 * names a whole day, so the boundary is that day's last instant. */
export function endBoundary(cat: Cat): Date | null {
  return cat.endedAt ? dayEnd(cat.endedAt) : null;
}

/** Was this cat being tracked at `when`? */
export function isTrackedAt(cat: Cat, when: Date): boolean {
  const start = startBoundary(cat);
  if (start && when.getTime() < start.getTime()) return false;
  const end = endBoundary(cat);
  if (end && when.getTime() > end.getTime()) return false;
  return true;
}

/** Cats whose history is closed. */
export function hasEnded(cat: Cat): boolean {
  return cat.endedAt != null;
}

/** `vendorPetId` → `CatId`, for the vendor bulk-export parser. */
export function vendorPetIdMap(cats: Cat[]): Record<string, CatId> {
  const map: Record<string, CatId> = {};
  for (const cat of cats) {
    if (cat.vendorPetId) map[cat.vendorPetId] = cat.id;
  }
  return map;
}

/** Drop overrides pointing at cats that no longer exist, so a deleted cat
 * can't keep influencing classification from `localStorage`. */
export function pruneOverrides(
  overrides: OverridesMap,
  cats: Cat[],
): OverridesMap {
  const ids = new Set(cats.map((c) => c.id));
  const out: OverridesMap = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value === "ignore" || ids.has(value)) out[key] = value;
  }
  return out;
}

function dayStart(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function dayEnd(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** `YYYY-MM-DD` for today, in local time — used as the default start date for
 * a newly added cat. */
export function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
