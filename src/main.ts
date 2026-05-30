import "./style.css";

import { WeightChart } from "./chart.ts";
import { dedupe, loadBundledReadings } from "./data-loader.ts";
import { computeStats } from "./stats.ts";
import { setupUpload } from "./upload.ts";
import {
  CAT_IDS,
  CATS,
  type CatId,
  type ViewMode,
  type WeightReading,
} from "./types.ts";

const canvas = requireEl<HTMLCanvasElement>("#chart");
const fileInput = requireEl<HTMLInputElement>("#file-input");
const dropZone = document.body;
const viewRadios = document.querySelectorAll<HTMLInputElement>(
  'input[name="view"]',
);
const sourceList = requireEl<HTMLUListElement>("#source-list");
const status = requireEl<HTMLParagraphElement>("#status");

let readings: WeightReading[] = dedupe(loadBundledReadings());
let viewMode: ViewMode = "daily";

const chart = new WeightChart(canvas);

renderAll();

viewRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    viewMode = radio.value as ViewMode;
    chart.update(readings, viewMode);
  });
});

setupUpload(fileInput, dropZone, (added, filenames) => {
  readings = dedupe([...readings, ...added]);
  renderAll();
  status.textContent = `Added ${added.length} reading${
    added.length === 1 ? "" : "s"
  } from ${filenames.join(", ")}.`;
});

function renderAll(): void {
  chart.update(readings, viewMode);
  renderStats();
  renderSources();
}

function renderStats(): void {
  const stats = computeStats(readings);
  for (const catId of CAT_IDS) {
    setText(`#${catId}-latest`, formatLatest(stats[catId]));
    setText(`#${catId}-avg`, formatKg(stats[catId].avg30dKg));
    setText(`#${catId}-count`, String(stats[catId].count));
    const swatch = document.querySelector<HTMLElement>(
      `[data-cat="${catId}"] .swatch`,
    );
    if (swatch) swatch.style.backgroundColor = CATS[catId].color;
  }
}

function renderSources(): void {
  const sources = new Map<string, number>();
  for (const r of readings) {
    sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
  }
  sourceList.innerHTML = "";
  if (sources.size === 0) {
    const li = document.createElement("li");
    li.textContent = "No CSVs loaded yet.";
    li.className = "source-empty";
    sourceList.appendChild(li);
    return;
  }
  const entries = Array.from(sources.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [name, count] of entries) {
    const li = document.createElement("li");
    li.textContent = `${name} — ${count} reading${count === 1 ? "" : "s"}`;
    sourceList.appendChild(li);
  }
}

function formatLatest(s: { latestKg: number | null; latestAt: Date | null }): string {
  if (s.latestKg == null || s.latestAt == null) return "—";
  return `${s.latestKg.toFixed(2)} kg · ${s.latestAt.toLocaleDateString()}`;
}

function formatKg(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)} kg`;
}

function setText(selector: string, text: string): void {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}
