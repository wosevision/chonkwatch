import "./style.css";

import { WeightChart, type RawClickInfo } from "./chart.ts";
import {
  buildDataset,
  loadBundledRaw,
  loadPersistedRaw,
} from "./data-loader.ts";
import { filterByRange } from "./filter.ts";
import { detectOutliers } from "./outliers.ts";
import { loadOverrides, saveOverrides, setOverride } from "./overrides.ts";
import { computeStats, type CatStats } from "./stats.ts";
import { setupUpload } from "./upload.ts";
import { VisitsChart } from "./visits-chart.ts";
import {
  CAT_IDS,
  CATS,
  DEFAULT_DATE_RANGE,
  type CatId,
  type DateRangeId,
  type Override,
  type OverridesMap,
  type RawWeightReading,
  type ViewMode,
  type WeightReading,
} from "./types.ts";

const canvas = requireEl<HTMLCanvasElement>("#chart");
const chartWrap = requireEl<HTMLElement>(".chart-wrap");
const visitsCanvas = requireEl<HTMLCanvasElement>("#visits-chart");
const fileInput = requireEl<HTMLInputElement>("#file-input");
const dropZone = document.body;
const dropOverlay = requireEl<HTMLElement>(".drop-overlay");
const viewRadios = document.querySelectorAll<HTMLInputElement>(
  'input[name="view"]',
);
const rangeRadios = document.querySelectorAll<HTMLInputElement>(
  'input[name="range"]',
);
const resetZoom = requireEl<HTMLButtonElement>("#reset-zoom");
const sourceList = requireEl<HTMLUListElement>("#source-list");
const status = requireEl<HTMLParagraphElement>("#status");
const overridePopup = requireEl<HTMLDivElement>("#override-popup");
const overrideMeta = requireEl<HTMLParagraphElement>("#override-meta");
const overrideClear = requireEl<HTMLButtonElement>("#override-clear");
const overrideClose = requireEl<HTMLButtonElement>("#override-close");
const overrideButtons =
  overridePopup.querySelectorAll<HTMLButtonElement>(
    "button[data-override]",
  );
const overrideHint = requireEl<HTMLParagraphElement>("#override-hint");

let rawReadings: RawWeightReading[] = loadBundledRaw();
let overrides: OverridesMap = loadOverrides();
let viewMode: ViewMode = "daily";
let rangeId: DateRangeId = DEFAULT_DATE_RANGE;
const hidden = new Set<CatId>();
let activeOverrideKey: string | null = null;

const visitsChart = new VisitsChart(visitsCanvas);
const chart = new WeightChart(canvas, {
  onZoomChange: (zoomed) => {
    resetZoom.hidden = !zoomed;
  },
  onRawClick: openOverridePopup,
});

renderAll();

void hydratePersisted();

viewRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    viewMode = radio.value as ViewMode;
    overrideHint.hidden = viewMode !== "raw";
    chartWrap.classList.toggle("is-raw", viewMode === "raw");
    renderChartOnly();
  });
});

rangeRadios.forEach((radio) => {
  if (radio.value === rangeId) radio.checked = true;
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    rangeId = radio.value as DateRangeId;
    chart.resetZoom();
    renderAll();
  });
});

resetZoom.addEventListener("click", () => {
  chart.resetZoom();
});

setupUpload(fileInput, dropZone, dropOverlay, (outcomes, errors) => {
  for (const o of outcomes) {
    rawReadings = [...rawReadings, ...o.readings];
  }
  renderAll();
  const parts: string[] = [];
  if (outcomes.length > 0) {
    const totalReadings = outcomes.reduce(
      (n, o) => n + o.readings.length,
      0,
    );
    const replacements = outcomes.filter((o) => o.replaced).length;
    const reads = totalReadings === 1 ? "reading" : "readings";
    let line = `Saved ${outcomes.length} file${
      outcomes.length === 1 ? "" : "s"
    } (${totalReadings} ${reads}).`;
    if (replacements > 0) {
      line += ` ${replacements} overwrote existing.`;
    }
    parts.push(line);
  }
  if (errors.length > 0) parts.push(`Errors: ${errors.join("; ")}`);
  status.textContent = parts.join(" ");
});

setupCatToggles();
setupOverridePopup();

async function hydratePersisted(): Promise<void> {
  try {
    const persisted = await loadPersistedRaw();
    rawReadings = [...rawReadings, ...persisted];
    renderAll();
  } catch (err) {
    console.warn(
      "[main] Could not load persisted readings; rendering bundled data only.",
      err,
    );
  }
}

function classifiedReadings(): WeightReading[] {
  return buildDataset(rawReadings, overrides);
}

function visibleReadings(): WeightReading[] {
  return filterByRange(classifiedReadings(), rangeId);
}

function renderAll(): void {
  const all = classifiedReadings();
  const visible = filterByRange(all, rangeId);
  const outliers = detectOutliers(visible);
  chart.update({ readings: visible, view: viewMode, hidden, outliers });
  visitsChart.update(visible.filter((r) => !hidden.has(r.catId)));
  renderStats(visible, all);
  renderSources(all);
  renderRangeAvailability(all);
}

function renderChartOnly(): void {
  const visible = visibleReadings();
  const outliers = detectOutliers(visible);
  chart.update({ readings: visible, view: viewMode, hidden, outliers });
  visitsChart.update(visible.filter((r) => !hidden.has(r.catId)));
}

function renderStats(visible: WeightReading[], all: WeightReading[]): void {
  const stats = computeStats(visible);
  // The note describes a cat's whole history, so it's computed from the full
  // dataset and stays put as the user switches range.
  const overall = computeStats(all);
  for (const catId of CAT_IDS) {
    const s = stats[catId];
    setText(`#${catId}-latest`, formatLatest(s));
    setText(`#${catId}-avg`, formatKg(s.avg30dKg));
    setText(`#${catId}-count`, String(s.count));
    setText(`#${catId}-latest-label`, s.ended ? "Last reading" : "Latest");
    setText(
      `#${catId}-avg-label`,
      s.ended ? "Final 30-day avg" : "30-day avg",
    );
    setNote(`#${catId}-note`, formatEndedNote(overall[catId], s.count));
    const card = document.querySelector<HTMLElement>(
      `[data-cat="${catId}"]`,
    );
    if (card) {
      card.classList.toggle("is-ended", s.ended);
      const swatch = card.querySelector<HTMLElement>(".swatch");
      if (swatch) swatch.style.backgroundColor = CATS[catId].color;
      card.classList.toggle("is-hidden", hidden.has(catId));
      const toggle = card.querySelector<HTMLButtonElement>(".cat-toggle");
      if (toggle) {
        toggle.textContent = hidden.has(catId) ? "Show" : "Hide";
        toggle.setAttribute(
          "aria-pressed",
          hidden.has(catId) ? "true" : "false",
        );
      }
    }
  }
}

function renderSources(all: WeightReading[]): void {
  const sources = new Map<string, number>();
  for (const r of all) {
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

function renderRangeAvailability(all: WeightReading[]): void {
  rangeRadios.forEach((radio) => {
    const id = radio.value as DateRangeId;
    const count = filterByRange(all, id).length;
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

function setupCatToggles(): void {
  for (const catId of CAT_IDS) {
    const card = document.querySelector<HTMLElement>(
      `[data-cat="${catId}"]`,
    );
    if (!card) continue;
    const toggle = card.querySelector<HTMLButtonElement>(".cat-toggle");
    if (!toggle) continue;
    toggle.addEventListener("click", () => {
      if (hidden.has(catId)) hidden.delete(catId);
      else hidden.add(catId);
      renderAll();
    });
  }
}

function setupOverridePopup(): void {
  overrideClose.addEventListener("click", closeOverridePopup);
  overrideClear.addEventListener("click", () => {
    if (!activeOverrideKey) return;
    overrides = setOverride(overrides, activeOverrideKey, undefined);
    saveOverrides(overrides);
    renderAll();
    closeOverridePopup();
  });
  overrideButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!activeOverrideKey) return;
      const value = btn.dataset.override as Override;
      overrides = setOverride(overrides, activeOverrideKey, value);
      saveOverrides(overrides);
      renderAll();
      closeOverridePopup();
    });
  });
  document.addEventListener("click", (e) => {
    if (overridePopup.hidden) return;
    if (overridePopup.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).tagName === "CANVAS") return;
    closeOverridePopup();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverridePopup();
  });
}

function openOverridePopup(info: RawClickInfo): void {
  activeOverrideKey = info.key;
  const current = overrides[info.key];
  overrideMeta.textContent = `${info.timestamp.toLocaleString()} · ${info.weightKg.toFixed(
    2,
  )} kg · currently ${current ?? "auto"} (${CATS[info.catId].name})`;
  overrideButtons.forEach((btn) => {
    const v = btn.dataset.override as Override;
    btn.classList.toggle("is-active", v === current);
  });
  overrideClear.disabled = !current;

  overridePopup.hidden = false;
  // Position the popup near the click, but clamp to the viewport.
  const popupWidth = overridePopup.offsetWidth || 240;
  const popupHeight = overridePopup.offsetHeight || 160;
  const margin = 8;
  let left = info.pageX + 12;
  let top = info.pageY + 12;
  if (left + popupWidth + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - popupWidth - margin);
  }
  if (top + popupHeight + margin > window.innerHeight + window.scrollY) {
    top = Math.max(
      margin + window.scrollY,
      info.pageY - popupHeight - 12,
    );
  }
  overridePopup.style.left = `${left}px`;
  overridePopup.style.top = `${top}px`;
}

function closeOverridePopup(): void {
  overridePopup.hidden = true;
  activeOverrideKey = null;
}

function formatLatest(s: { latestKg: number | null; latestAt: Date | null }): string {
  if (s.latestKg == null || s.latestAt == null) return "—";
  return `${s.latestKg.toFixed(2)} kg · ${s.latestAt.toLocaleDateString()}`;
}

function formatKg(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)} kg`;
}

/**
 * Note shown under an ended cat's name: the span their readings actually
 * cover, so the card reads as a closed history rather than as live data that
 * has gone stale. Returns null for cats that are still being weighed.
 */
function formatEndedNote(
  overall: CatStats,
  visibleCount: number,
): string | null {
  if (!overall.ended) return null;
  if (overall.firstAt == null || overall.latestAt == null) return null;
  const span = `${formatDay(overall.firstAt)} – ${formatDay(overall.latestAt)}`;
  return visibleCount === 0 ? `${span} (none in this range)` : span;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function setNote(selector: string, text: string | null): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.textContent = text ?? "";
  el.hidden = text == null;
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
