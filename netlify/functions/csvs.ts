import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

/**
 * Production CSV store: Netlify Blobs.
 *
 * Production note: a Netlify Function can't write to the deployed project's
 * filesystem (it's a read-only serverless container), so uploads in prod
 * land in a Netlify Blobs store instead. The bundled CSVs in `data/` still
 * load via Vite's glob import at build time — bundled and persisted are
 * merged on the client and deduped by `(timestamp, weight, cat)`.
 */

const STORE_NAME = "catweight-csvs";
const SAFE_NAME_RE = /^[\w.\-]+\.csv$/i;

export default async (req: Request, _context: Context): Promise<Response> => {
  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    const list = await store.list();
    const files = await Promise.all(
      list.blobs
        .map((b) => b.key)
        .sort()
        .map(async (name) => ({
          name,
          content: (await store.get(name, { type: "text" })) ?? "",
        })),
    );
    return jsonResponse(200, { files });
  }

  if (req.method === "POST") {
    let body: { name?: unknown; content?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const name = String(body.name ?? "");
    const content = String(body.content ?? "");
    if (!SAFE_NAME_RE.test(name)) {
      return jsonResponse(400, {
        error: `Invalid filename: ${name}. Must match ${SAFE_NAME_RE}.`,
      });
    }
    const replaced = (await store.get(name, { type: "text" })) != null;
    await store.set(name, content);
    return jsonResponse(200, { name, replaced });
  }

  return jsonResponse(405, { error: "Method not allowed" });
};

export const config = {
  path: "/api/csvs",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
