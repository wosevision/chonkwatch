import { uploadAndParse } from "./data-loader.ts";
import type { RawWeightReading } from "./types.ts";

export interface UploadOutcome {
  filename: string;
  replaced: boolean;
  readings: RawWeightReading[];
}

type UploadHandler = (outcomes: UploadOutcome[], errors: string[]) => void;

/**
 * Wire up file-input + page-wide drag-and-drop. Each accepted file is sent
 * to the persistence API and locally parsed for immediate feedback. The
 * caller decides what to do with the parsed readings (typically: merge
 * into the in-memory dataset and re-render).
 *
 * `overlay` is the visual indicator shown while a drag is in progress. It
 * starts with the `hidden` attribute set (FOUC guard) and we toggle that
 * attribute rather than a class so the overlay stays hidden through the
 * brief window before CSS finishes loading.
 */
export function setupUpload(
  fileInput: HTMLInputElement,
  dropZone: HTMLElement,
  overlay: HTMLElement,
  onUpload: UploadHandler,
): void {
  fileInput.addEventListener("change", async () => {
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    await handleFiles(files, onUpload);
    fileInput.value = "";
  });

  const prevent = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  let dragDepth = 0;
  dropZone.addEventListener("dragenter", (e) => {
    prevent(e);
    dragDepth++;
    overlay.hidden = false;
  });
  dropZone.addEventListener("dragover", prevent);
  dropZone.addEventListener("dragleave", (e) => {
    prevent(e);
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  });
  dropZone.addEventListener("drop", async (e) => {
    prevent(e);
    dragDepth = 0;
    overlay.hidden = true;
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    await handleFiles(files, onUpload);
  });
}

async function handleFiles(
  files: File[],
  onUpload: UploadHandler,
): Promise<void> {
  const csvs = files.filter(
    (f) => f.type === "text/csv" || f.name.toLowerCase().endsWith(".csv"),
  );
  if (csvs.length === 0) return;

  const outcomes: UploadOutcome[] = [];
  const errors: string[] = [];
  for (const file of csvs) {
    try {
      const { readings, result } = await uploadAndParse(file);
      outcomes.push({
        filename: result.name,
        replaced: result.replaced,
        readings,
      });
    } catch (err) {
      console.error(`[upload] Failed to upload ${file.name}:`, err);
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (outcomes.length > 0 || errors.length > 0) {
    onUpload(outcomes, errors);
  }
}
