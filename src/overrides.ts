import type { Override, OverridesMap } from "./types.ts";

const STORAGE_KEY = "catweight:overrides:v1";

/**
 * Load the override map from localStorage. Returns `{}` if absent or
 * malformed — overrides are advisory metadata, not source of truth, so a
 * corrupted blob shouldn't take the app down.
 */
export function loadOverrides(): OverridesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as OverridesMap;
    }
    return {};
  } catch (err) {
    console.warn("[overrides] Failed to load; ignoring saved overrides.", err);
    return {};
  }
}

export function saveOverrides(overrides: OverridesMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (err) {
    console.warn("[overrides] Failed to persist override.", err);
  }
}

/**
 * Apply a single override change. Passing `undefined` clears the entry,
 * letting the threshold classifier take over again.
 */
export function setOverride(
  overrides: OverridesMap,
  key: string,
  value: Override | undefined,
): OverridesMap {
  const next = { ...overrides };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}
