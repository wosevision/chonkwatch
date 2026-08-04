import { defineConfig, type Plugin } from "vite";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SAFE_NAME_RE = /^[\w.\-]+\.csv$/i;
/**
 * Dev home for the user-managed cat registry. Sits in `data/` alongside the
 * CSVs so all user data is in one place and can be committed to git; the
 * bundling glob is CSV-specific, so a `.json` here is never inlined into the
 * client bundle. Production keeps the same document in Netlify Blobs.
 */
const CATS_FILE = path.resolve(DATA_DIR, "cats.json");

/**
 * In dev, the upload UI POSTs CSV content here and we drop it straight into
 * `data/`. In production the same routes are served by a Netlify Function
 * backed by Netlify Blobs (see `netlify/functions/csvs.ts`); the response
 * shapes match so the frontend doesn't care which backend it's talking to.
 *
 * Filenames are restricted to a conservative whitelist so a misbehaving
 * client can't path-traverse out of `data/` or stomp arbitrary files in the
 * project root.
 */
function csvApiPlugin(): Plugin {
  return {
    name: "chonkwatch-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/csvs", async (req, res) => {
        try {
          if (req.method === "GET") {
            await ensureDataDir();
            const names = (await fs.readdir(DATA_DIR))
              .filter((n) => n.toLowerCase().endsWith(".csv"))
              .sort();
            const files = await Promise.all(
              names.map(async (name) => ({
                name,
                content: await fs.readFile(
                  path.join(DATA_DIR, name),
                  "utf8",
                ),
              })),
            );
            sendJson(res, 200, { files });
            return;
          }

          if (req.method === "POST") {
            const body = await readJsonBody(req);
            const name = String(body.name ?? "");
            const content = String(body.content ?? "");
            if (!SAFE_NAME_RE.test(name)) {
              sendJson(res, 400, {
                error: `Invalid filename: ${name}. Must match ${SAFE_NAME_RE}.`,
              });
              return;
            }
            await ensureDataDir();
            const target = path.join(DATA_DIR, name);
            const replaced = await pathExists(target);
            await fs.writeFile(target, content, "utf8");
            sendJson(res, 200, { name, replaced });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
        } catch (err) {
          console.error("[chonkwatch-dev-api]", err);
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      server.middlewares.use("/api/cats", async (req, res) => {
        try {
          if (req.method === "GET") {
            if (!(await pathExists(CATS_FILE))) {
              // Nothing stored yet — the client seeds itself and PUTs back.
              sendJson(res, 404, { error: "No cat registry yet" });
              return;
            }
            const raw = await fs.readFile(CATS_FILE, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(raw);
            return;
          }

          if (req.method === "PUT") {
            const body = await readJsonBody(req);
            const error = validateCatStore(body);
            if (error) {
              sendJson(res, 400, { error });
              return;
            }
            await ensureDataDir();
            await fs.writeFile(
              CATS_FILE,
              `${JSON.stringify(body, null, 2)}\n`,
              "utf8",
            );
            sendJson(res, 200, { ok: true });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
        } catch (err) {
          console.error("[chonkwatch-dev-api]", err);
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
  };
}

/**
 * Shallow shape check on an incoming cat registry. Deliberately permissive
 * about individual cat fields — the client normalizes those (`normalizeStore`)
 * and is the only writer. This just stops a malformed body from being persisted
 * as the canonical document.
 */
export function validateCatStore(body: unknown): string | null {
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

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function sendJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default defineConfig({
  plugins: [csvApiPlugin()],
});
