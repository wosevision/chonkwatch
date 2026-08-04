import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

import { requireUser } from "../shared/require-user.ts";

/**
 * Production store for the user-managed cat registry: Netlify Blobs.
 *
 * Mirrors the dev-time `/api/cats` handler in `vite.config.ts`, which keeps the
 * same document at `data/cats.json`. As with the CSV endpoint, a Netlify
 * Function can't write to the deployed project's filesystem, so the document
 * lives in Blobs and survives across deploys.
 *
 * A missing document returns 404 rather than an empty registry: the client
 * distinguishes "never seeded" (seed the defaults) from "seeded and empty"
 * (the user deleted every cat, which must not be silently undone).
 *
 * Requires a Netlify Identity session, like `/api/csvs`. Without the guard an
 * anonymous `PUT` could rewrite the registry outright, and since deletions here
 * also carry `droppedReadingKeys`, that would take readings down with it.
 */

const STORE_NAME = "chonkwatch-cats";
const KEY = "cats.json";

export default async (req: Request, _context: Context): Promise<Response> => {
  const unauthorized = await requireUser();
  if (unauthorized) return unauthorized;

  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    const raw = await store.get(KEY, { type: "text" });
    if (raw == null) {
      return jsonResponse(404, { error: "No cat registry yet" });
    }
    return new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (req.method === "PUT") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const error = validateCatStore(body);
    if (error) return jsonResponse(400, { error });
    await store.set(KEY, JSON.stringify(body));
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: "Method not allowed" });
};

export const config = {
  path: "/api/cats",
};

/**
 * Shallow shape check, matching the dev plugin's. Individual cat fields are
 * normalized client-side (`normalizeStore` in `src/cats.ts`); this only stops a
 * malformed body from becoming the canonical document.
 */
function validateCatStore(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Body must be an object";
  const store = body as { cats?: unknown; droppedReadingKeys?: unknown };
  if (!Array.isArray(store.cats)) return "`cats` must be an array";
  if (
    store.droppedReadingKeys !== undefined &&
    !Array.isArray(store.droppedReadingKeys)
  ) {
    return "`droppedReadingKeys` must be an array";
  }
  for (const cat of store.cats) {
    if (!cat || typeof cat !== "object") return "Each cat must be an object";
    const { id, name } = cat as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !id) return "Each cat needs a string `id`";
    if (typeof name !== "string" || !name) {
      return "Each cat needs a string `name`";
    }
  }
  return null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}
