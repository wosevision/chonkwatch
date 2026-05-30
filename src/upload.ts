import { readUploadedCsv } from "./data-loader.ts";
import type { WeightReading } from "./types.ts";

type UploadHandler = (readings: WeightReading[], filenames: string[]) => void;

/**
 * Wire up file-input + page-wide drag-and-drop for adding CSV exports at
 * runtime. Calls `onReadings` once per drop/select event with the combined
 * results from all accepted files.
 */
export function setupUpload(
  fileInput: HTMLInputElement,
  dropZone: HTMLElement,
  onReadings: UploadHandler,
): void {
  fileInput.addEventListener("change", async () => {
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    await handleFiles(files, onReadings);
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
    dropZone.classList.add("is-dragging");
  });
  dropZone.addEventListener("dragover", prevent);
  dropZone.addEventListener("dragleave", (e) => {
    prevent(e);
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove("is-dragging");
  });
  dropZone.addEventListener("drop", async (e) => {
    prevent(e);
    dragDepth = 0;
    dropZone.classList.remove("is-dragging");
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    await handleFiles(files, onReadings);
  });
}

async function handleFiles(
  files: File[],
  onReadings: UploadHandler,
): Promise<void> {
  const csvs = files.filter(
    (f) => f.type === "text/csv" || f.name.toLowerCase().endsWith(".csv"),
  );
  if (csvs.length === 0) return;

  const all: WeightReading[] = [];
  const accepted: string[] = [];
  for (const file of csvs) {
    try {
      const readings = await readUploadedCsv(file);
      all.push(...readings);
      accepted.push(file.name);
    } catch (err) {
      console.error(`[upload] Failed to read ${file.name}:`, err);
    }
  }
  if (all.length > 0) onReadings(all, accepted);
}
