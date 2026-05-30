import { defineConfig, type Plugin } from "vite";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SAFE_NAME_RE = /^[\w.\-]+\.csv$/i;

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
    },
  };
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
