/**
 * Thin client for the `/api/csvs` endpoint. The endpoint is served by the
 * Vite dev plugin in development (writes to `data/`) and by a Netlify
 * Function in production (writes to Netlify Blobs). The response shapes are
 * identical, so callers don't care which backend is on the other side.
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
