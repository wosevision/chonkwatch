import { normalizeStore } from "./cats.ts";
import type { CatStore } from "./types.ts";

/**
 * Thin client for the `/api/csvs` and `/api/cats` endpoints. Both are served by
 * the Vite dev plugin in development (backed by `data/`) and by Netlify
 * Functions in production (backed by Netlify Blobs). The response shapes are
 * identical either way, so callers don't care which backend is on the other
 * side.
 *
 * In production both endpoints require a Netlify Identity session. The browser
 * sends it automatically — it rides along in the `nf_jwt` cookie on these
 * same-origin requests — so there's no token to attach here. What does need
 * handling is a 401, which means the session lapsed while the page was open.
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

let unauthorizedHandler: (() => void) | null = null;

/**
 * Register what to do when the server stops accepting the session, typically
 * putting the sign-in gate back up. Inverted like this so this module stays
 * free of DOM and of any import back into the auth UI.
 */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * A 401 is the only response the caller can't do anything useful with: the data
 * isn't missing or malformed, the session is simply gone. Notify, then throw so
 * the calling path unwinds instead of rendering half a page.
 */
function checkAuthorized(res: Response, label: string): void {
  if (res.status !== 401) return;
  unauthorizedHandler?.();
  throw new Error(`${label} failed: not signed in`);
}

export async function listFiles(): Promise<PersistedFile[]> {
  const res = await fetch(ENDPOINT, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  checkAuthorized(res, `GET ${ENDPOINT}`);
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
    credentials: "same-origin",
  });
  checkAuthorized(res, `POST ${ENDPOINT}`);
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
    credentials: "same-origin",
  });
  checkAuthorized(res, `GET ${CATS_ENDPOINT}`);
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
    credentials: "same-origin",
  });
  checkAuthorized(res, `PUT ${CATS_ENDPOINT}`);
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
