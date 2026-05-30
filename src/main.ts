import "./style.css";

import { WeightChart } from "./chart.ts";
import { dedupe, loadBundledReadings } from "./data-loader.ts";
import { filterByRange } from "./filter.ts";
import { computeStats } from "./stats.ts";
import { setupUpload } from "./upload.ts";
import {
  CAT_IDS,
  CATS,
  DEFAULT_DATE_RANGE,
  type DateRangeId,
  type ViewMode,
  type WeightReading,
} from "./types.ts";

const canvas = requireEl<HTMLCanvasElement>("#chart");
const fileInput = requireEl<HTMLInputElement>("#file-input");
const dropZone = document.body;
const viewRadios = document.querySelectorAll<HTMLInputElement>(
  'input[name="view"]',
);
const rangeRadios = document.querySelectorAll<HTMLInputElement>(
  'input[name="range"]',
);
const resetZoom = requireEl<HTMLButtonElement>("#reset-zoom");
const sourceList = requireEl<HTMLUListElement>("#source-list");
const status = requireEl<HTMLParagraphElement>("#status");

let allReadings: WeightReading[] = dedupe(loadBundledReadings());
let viewMode: ViewMode = "daily";
let rangeId: DateRangeId = DEFAULT_DATE_RANGE;

const chart = new WeightChart(canvas, (zoomed) => {
  resetZoom.hidden = !zoomed;
});

renderAll();

viewRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    viewMode = radio.value as ViewMode;
    chart.update(visibleReadings(), viewMode);
  });
});

rangeRadios.forEach((radio) => {
  if (radio.value === rangeId) radio.checked = true;
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    rangeId = radio.value as DateRangeId;
    chart.update(visibleReadings(), viewMode);
    chart.resetZoom();
  });
});

resetZoom.addEventListener("click", () => {
  chart.resetZoom();
});

setupUpload(fileInput, dropZone, (added, filenames) => {
  allReadings = dedupe([...allReadings, ...added]);
  renderAll();
  status.textContent = `Added ${added.length} reading${
    added.length === 1 ? "" : "s"
  } from ${filenames.join(", ")}.`;
});

function visibleReadings(): WeightReading[] {
  return filterByRange(allReadings, rangeId);
}

function renderAll(): void {
  const visible = visibleReadings();
  chart.update(visible, viewMode);
  renderStats(visible);
  renderSources();
  renderRangeAvailability();
}

function renderStats(visible: WeightReading[]): void {
  const stats = computeStats(visible);
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
  for (const r of allReadings) {
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

/** Disable preset buttons whose window contains zero readings — keeps the
 * user from picking a range that wipes the chart on a thin dataset. */
function renderRangeAvailability(): void {
  rangeRadios.forEach((radio) => {
    const id = radio.value as DateRangeId;
    const count = filterByRange(allReadings, id).length;
    const wrapper = radio.closest("label");
    radio.disabled = count === 0 && id !== "all";
    if (wrapper) wrapper.classList.toggle("is-disabled", radio.disabled);
    if (radio.disabled && radio.checked) {
      const fallback = Array.from(rangeRadios).find(
        (r) => r.value === "all",
      );
      if (fallback) {
        fallback.checked = true;
        rangeId = "all";
      }
    }
  });
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
