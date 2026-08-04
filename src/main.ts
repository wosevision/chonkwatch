import "./style.css";

import { loadCatStore, saveCatStore } from "./api.ts";
import { WeightChart, type RawClickInfo } from "./chart.ts";
import { catName, hasEnded, pruneOverrides, seedStore } from "./cats.ts";
import { setupCatsDialog } from "./cats-ui.ts";
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
  DEFAULT_DATE_RANGE,
  type Cat,
  type CatId,
  type CatStore,
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
const catCards = requireEl<HTMLElement>("#cat-cards");
const catsEmpty = requireEl<HTMLElement>("#cats-empty");
const manageCats = requireEl<HTMLButtonElement>("#manage-cats");
const overridePopup = requireEl<HTMLDivElement>("#override-popup");
const overrideMeta = requireEl<HTMLParagraphElement>("#override-meta");
const overrideButtonsWrap = requireEl<HTMLDivElement>("#override-buttons");
const overrideClear = requireEl<HTMLButtonElement>("#override-clear");
const overrideClose = requireEl<HTMLButtonElement>("#override-close");
const overrideHint = requireEl<HTMLParagraphElement>("#override-hint");

let rawReadings: RawWeightReading[] = loadBundledRaw();
let overrides: OverridesMap = loadOverrides();
// Optimistic default so the bundled CSVs can render before `/api/cats`
// answers. Replaced wholesale by `hydrate()`.
let store: CatStore = seedStore();
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

const catsDialog = setupCatsDialog({
  getStore: () => store,
  getReadingKeys: (catId) =>
    classifiedReadings()
      .filter((r) => r.catId === catId)
      .map((r) => r.key),
  onChange: applyCatStore,
});

renderAll();

void hydrate();

manageCats.addEventListener("click", () => catsDialog.open());

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

setupOverridePopup();

/**
 * Two-stage startup. The cat registry comes first because classification
 * depends on it; the persisted CSVs follow. Both stages tolerate failure and
 * render whatever they've got — a dead API shouldn't mean a blank page.
 */
async function hydrate(): Promise<void> {
  try {
    const loaded = await loadCatStore();
    if (loaded) {
      store = loaded;
    } else {
      // Nothing stored yet: seed the backend with the defaults so subsequent
      // loads (and other devices) agree.
      store = seedStore();
      await saveCatStore(store);
    }
    afterStoreChange();
  } catch (err) {
    console.warn(
      "[main] Could not load the cat registry; using defaults for this session. Edits won't persist.",
      err,
    );
  }

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

/** Adopt a new registry: persist it, drop anything referring to cats that no
 * longer exist, and re-render. */
function applyCatStore(next: CatStore): void {
  store = next;
  afterStoreChange();
  void saveCatStore(store).catch((err) => {
    console.error("[main] Failed to save the cat registry.", err);
    status.textContent =
      "Cat changes couldn't be saved to the server; they'll be lost on reload.";
  });
}

function afterStoreChange(): void {
  const pruned = pruneOverrides(overrides, store.cats);
  if (Object.keys(pruned).length !== Object.keys(overrides).length) {
    overrides = pruned;
    saveOverrides(overrides);
  }
  const ids = new Set(store.cats.map((c) => c.id));
  for (const id of hidden) {
    if (!ids.has(id)) hidden.delete(id);
  }
  renderAll();
}

function classifiedReadings(): WeightReading[] {
  return buildDataset(
    rawReadings,
    store.cats,
    overrides,
    new Set(store.droppedReadingKeys),
  );
}

function renderAll(): void {
  const all = classifiedReadings();
  const visible = filterByRange(all, rangeId);
  const outliers = detectOutliers(visible);
  chart.update({
    readings: visible,
    cats: store.cats,
    view: viewMode,
    hidden,
    outliers,
  });
  visitsChart.update(
    visible.filter((r) => !hidden.has(r.catId)),
    store.cats,
  );
  renderCatCards(visible, all);
  renderOverrideButtons();
  renderSources(all);
  renderRangeAvailability(all);
}

function renderChartOnly(): void {
  const visible = filterByRange(classifiedReadings(), rangeId);
  const outliers = detectOutliers(visible);
  chart.update({
    readings: visible,
    cats: store.cats,
    view: viewMode,
    hidden,
    outliers,
  });
  visitsChart.update(
    visible.filter((r) => !hidden.has(r.catId)),
    store.cats,
  );
}

/**
 * Rebuild the cat cards from the registry. Fully re-rendered rather than
 * diffed: there are a handful of cards, and the alternative is tracking which
 * cat owns which node across add/edit/delete.
 */
function renderCatCards(visible: WeightReading[], all: WeightReading[]): void {
  const stats = computeStats(visible, store.cats);
  // The history note describes a cat's whole span, so it's computed from the
  // full dataset and stays put as the user switches range.
  const overall = computeStats(all, store.cats);

  catCards.innerHTML = "";
  catsEmpty.hidden = store.cats.length > 0;
  for (const cat of store.cats) {
    catCards.appendChild(
      catCard(cat, stats[cat.id], overall[cat.id]),
    );
  }
}

function catCard(cat: Cat, s: CatStats, overall: CatStats): HTMLElement {
  const card = document.createElement("article");
  card.className = "cat-card";
  card.dataset.cat = cat.id;
  card.classList.toggle("is-ended", hasEnded(cat));
  card.classList.toggle("is-hidden", hidden.has(cat.id));

  const header = document.createElement("header");
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.backgroundColor = cat.color;
  swatch.setAttribute("aria-hidden", "true");
  const title = document.createElement("h3");
  title.textContent = cat.name;

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "cat-edit";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit ${cat.name}`);
  edit.addEventListener("click", () => catsDialog.openEdit(cat.id));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cat-toggle";
  const isHidden = hidden.has(cat.id);
  toggle.textContent = isHidden ? "Show" : "Hide";
  toggle.setAttribute("aria-pressed", isHidden ? "true" : "false");
  toggle.setAttribute("aria-label", `${isHidden ? "Show" : "Hide"} ${cat.name}`);
  toggle.addEventListener("click", () => {
    if (hidden.has(cat.id)) hidden.delete(cat.id);
    else hidden.add(cat.id);
    renderAll();
  });

  header.append(swatch, title, edit, toggle);
  card.appendChild(header);

  const note = endedNote(overall, s.count);
  if (note) {
    const p = document.createElement("p");
    p.className = "cat-card__note";
    p.textContent = note;
    card.appendChild(p);
  }

  card.appendChild(
    statList([
      [s.ended ? "Last reading" : "Latest", formatLatest(s)],
      [s.ended ? "Final 30-day avg" : "30-day avg", formatKg(s.avg30dKg)],
      ["Readings", String(s.count)],
    ]),
  );
  return card;
}

function statList(entries: [string, string][]): HTMLDListElement {
  const dl = document.createElement("dl");
  for (const [label, value] of entries) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    wrap.append(dt, dd);
    dl.appendChild(wrap);
  }
  return dl;
}

/**
 * The override popup offers one button per cat plus Ignore, so it has to be
 * rebuilt whenever the registry changes.
 */
function renderOverrideButtons(): void {
  overrideButtonsWrap.innerHTML = "";
  for (const cat of store.cats) {
    overrideButtonsWrap.appendChild(overrideButton(cat.id, cat.name));
  }
  overrideButtonsWrap.appendChild(overrideButton("ignore", "Ignore"));
}

function overrideButton(value: Override, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.override = value;
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (!activeOverrideKey) return;
    overrides = setOverride(overrides, activeOverrideKey, value);
    saveOverrides(overrides);
    renderAll();
    closeOverridePopup();
  });
  return btn;
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

function setupOverridePopup(): void {
  overrideClose.addEventListener("click", closeOverridePopup);
  overrideClear.addEventListener("click", () => {
    if (!activeOverrideKey) return;
    overrides = setOverride(overrides, activeOverrideKey, undefined);
    saveOverrides(overrides);
    renderAll();
    closeOverridePopup();
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
  )} kg · currently ${current ?? "auto"} (${catName(store.cats, info.catId)})`;
  for (const btn of overrideButtonsWrap.querySelectorAll<HTMLButtonElement>(
    "button[data-override]",
  )) {
    btn.classList.toggle("is-active", btn.dataset.override === current);
  }
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
 * has gone stale. Returns null for cats that are still being tracked.
 */
function endedNote(overall: CatStats, visibleCount: number): string | null {
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

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}
