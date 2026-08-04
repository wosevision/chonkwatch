import { normalizeStore } from "./cats.ts";
import type { CatStore } from "./types.ts";

/**
 * Thin client for the `/api/csvs` and `/api/cats` endpoints. Both are served by
 * the Vite dev plugin in development (backed by `data/`) and by Netlify
 * Functions in production (backed by Netlify Blobs). The response shapes are
 * identical either way, so callers don't care which backend is on the other
 * side.
 */

export interface PersistedFile {
  name: string;
  content: string;
}

export interface UploadResult {
  name: string;
  replaced: boolean;
}

const ENDPOINT = "/api/csvs";
const CATS_ENDPOINT = "/api/cats";

export async function listFiles(): Promise<PersistedFile[]> {
  const res = await fetch(ENDPOINT, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${ENDPOINT} failed: ${res.status}`);
  }
  const data = (await res.json()) as { files: PersistedFile[] };
  return data.files ?? [];
}

export async function uploadFile(
  name: string,
  content: string,
): Promise<UploadResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ name, content }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ? ` — ${body.error}` : "";
    } catch {
      // Non-JSON error body; ignore.
    }
    throw new Error(`POST ${ENDPOINT} failed: ${res.status}${detail}`);
  }
  return (await res.json()) as UploadResult;
}

/**
 * Fetch the cat registry. Returns null when the backend has nothing stored yet,
 * which the caller treats as "seed me" — that's the first-run path, not an
 * error.
 */
export async function loadCatStore(): Promise<CatStore | null> {
  const res = await fetch(CATS_ENDPOINT, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${CATS_ENDPOINT} failed: ${res.status}`);
  }
  return normalizeStore(await res.json());
}

/** Persist the whole registry. The document is small and single-user, so
 * whole-document replacement beats a per-field patch protocol. */
export async function saveCatStore(store: CatStore): Promise<void> {
  const res = await fetch(CATS_ENDPOINT, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(store),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ? ` — ${body.error}` : "";
    } catch {
      // Non-JSON error body; ignore.
    }
    throw new Error(`PUT ${CATS_ENDPOINT} failed: ${res.status}${detail}`);
  }
}
