import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import "chartjs-adapter-date-fns";
import zoomPlugin from "chartjs-plugin-zoom";
import type { ChartConfiguration, ChartDataset } from "chart.js";

import { aggregateDailyMedian, rollingMedian } from "./aggregate.ts";
import { partitionByOutlier } from "./outliers.ts";
import {
  CAT_IDS,
  CATS,
  type CatId,
  type ViewMode,
  type WeightReading,
} from "./types.ts";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin,
);

/** Days of trailing data per smoother point. Keeps wiggle off the trendline
 * while still being responsive to a real shift in weight. */
const TRENDLINE_WINDOW_DAYS = 7;

interface BasePoint {
  x: number;
  y: number;
}

interface DailyPoint extends BasePoint {
  count: number;
  min: number;
  max: number;
}

interface RawPoint extends BasePoint {
  source: string;
  /** `readingKey` from `types.ts`, used to find the reading on click for
   * the override popup. */
  key: string;
  isOutlier: boolean;
  catId: CatId;
}

type DatasetKind =
  | "median"
  | "trend"
  | "band-low"
  | "band-high"
  | "raw"
  | "raw-outlier";

interface DatasetMeta {
  catId: CatId;
  kind: DatasetKind;
}

export interface RawClickInfo {
  key: string;
  catId: CatId;
  weightKg: number;
  timestamp: Date;
  /** Pixel position of the click within the chart canvas (for popup
   * placement). */
  pageX: number;
  pageY: number;
}

export interface ChartUpdate {
  readings: WeightReading[];
  view: ViewMode;
  hidden: Set<CatId>;
  outliers: Set<string>;
}

export interface ChartHandlers {
  onZoomChange?: (zoomed: boolean) => void;
  onRawClick?: (info: RawClickInfo) => void;
}

/**
 * Single Chart.js instance that flips between daily-median and raw views by
 * swapping its datasets. Stateful so Chart.js can animate transitions, the
 * zoom plugin's pan/zoom state survives, and theme changes can be applied
 * without rebuilding everything from scratch.
 */
export class WeightChart {
  private chart: Chart<"line", BasePoint[]>;
  private themeMq: MediaQueryList;
  private handlers: ChartHandlers;

  constructor(canvas: HTMLCanvasElement, handlers: ChartHandlers = {}) {
    this.handlers = handlers;
    this.themeMq = window.matchMedia("(prefers-color-scheme: dark)");
    this.applyTheme();
    this.themeMq.addEventListener("change", this.handleThemeChange);

    const config: ChartConfiguration<"line", BasePoint[]> = {
      type: "line",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        animation: false,
        interaction: { mode: "nearest", intersect: false },
        onClick: (event, _elements, chart) => {
          if (!this.handlers.onRawClick) return;
          // Use 'point' mode here so we only fire on actual point hits — the
          // `interaction.mode: nearest` config used for tooltips is too
          // permissive for click-to-edit.
          const items = chart.getElementsAtEventForMode(
            event.native ?? (event as unknown as Event),
            "point",
            { intersect: true },
            false,
          );
          if (items.length === 0) return;
          const item = items[0];
          const ds = chart.data.datasets[item.datasetIndex];
          const meta = datasetMeta(ds);
          if (!meta || (meta.kind !== "raw" && meta.kind !== "raw-outlier")) {
            return;
          }
          const point = ds.data[item.index] as RawPoint;
          const native = event.native as MouseEvent | undefined;
          this.handlers.onRawClick({
            key: point.key,
            catId: point.catId,
            weightKg: point.y,
            timestamp: new Date(point.x),
            pageX: native?.pageX ?? 0,
            pageY: native?.pageY ?? 0,
          });
        },
        scales: {
          x: {
            type: "time",
            time: { unit: "day", tooltipFormat: "PPpp" },
            ticks: { maxRotation: 0, autoSkipPadding: 16 },
            grid: { color: gridColor() },
          },
          y: {
            title: { display: true, text: "Weight (kg)" },
            grid: { color: gridColor() },
            ticks: { callback: (v) => `${v} kg` },
          },
        },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              filter: (legendItem, data) => {
                const idx = legendItem.datasetIndex;
                if (idx == null) return true;
                const meta = datasetMeta(data.datasets[idx]);
                if (!meta) return true;
                return meta.kind === "median" || meta.kind === "raw";
              },
            },
          },
          tooltip: {
            filter: (item) => {
              const meta = datasetMeta(item.dataset);
              return (
                !meta ||
                (meta.kind !== "band-low" && meta.kind !== "band-high")
              );
            },
            callbacks: {
              title: (items) => {
                if (items.length === 0) return "";
                const ts = items[0].parsed.x;
                if (ts == null) return "";
                return new Date(ts).toLocaleString();
              },
              label: (ctx) => {
                const meta = datasetMeta(ctx.dataset);
                if (!meta) return ctx.formattedValue;
                if (meta.kind === "raw" || meta.kind === "raw-outlier") {
                  const p = ctx.raw as RawPoint;
                  const tag = p.isOutlier ? " · ⚠ outlier" : "";
                  return `${CATS[p.catId].name}: ${p.y.toFixed(2)} kg${tag}`;
                }
                if (meta.kind === "median") {
                  const p = ctx.raw as DailyPoint;
                  const range =
                    p.min === p.max
                      ? ""
                      : ` · range ${p.min.toFixed(2)}–${p.max.toFixed(2)} kg`;
                  const reading = p.count === 1 ? "reading" : "readings";
                  return `${ctx.dataset.label}: ${p.y.toFixed(
                    2,
                  )} kg · ${p.count} ${reading}${range}`;
                }
                if (meta.kind === "trend") {
                  return `${ctx.dataset.label} (${TRENDLINE_WINDOW_DAYS}-day trend): ${(
                    ctx.raw as BasePoint
                  ).y.toFixed(2)} kg`;
                }
                return ctx.formattedValue;
              },
            },
          },
          zoom: {
            limits: {},
            pan: { enabled: true, mode: "x", modifierKey: "shift" },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              drag: { enabled: true, modifierKey: "alt" },
              mode: "x",
              onZoomComplete: ({ chart }) => {
                this.handlers.onZoomChange?.(isZoomed(chart));
              },
            },
          },
        },
      },
    };
    this.chart = new Chart(canvas, config);
  }

  update(state: ChartUpdate): void {
    const visibleReadings = state.readings.filter(
      (r) => !state.hidden.has(r.catId),
    );
    this.chart.data.datasets = buildDatasets(
      visibleReadings,
      state.view,
      state.outliers,
    );
    this.chart.update();
  }

  resetZoom(): void {
    this.chart.resetZoom();
  }

  destroy(): void {
    this.themeMq.removeEventListener("change", this.handleThemeChange);
    this.chart.destroy();
  }

  private handleThemeChange = (): void => {
    this.applyTheme();
    if (this.chart.options.scales?.x?.grid)
      this.chart.options.scales.x.grid.color = gridColor();
    if (this.chart.options.scales?.y?.grid)
      this.chart.options.scales.y.grid.color = gridColor();
    this.chart.update();
  };

  private applyTheme(): void {
    const dark = this.themeMq.matches;
    Chart.defaults.color = dark ? "#e7e5e4" : "#1c1917";
    Chart.defaults.borderColor = dark
      ? "rgba(255,255,255,0.06)"
      : "rgba(0,0,0,0.08)";
  }
}

function isZoomed(chart: Chart): boolean {
  const fn = (chart as unknown as { isZoomedOrPanned?: () => boolean })
    .isZoomedOrPanned;
  return typeof fn === "function" ? fn.call(chart) : false;
}

function gridColor(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "rgba(255,255,255,0.06)"
    : "rgba(0,0,0,0.05)";
}

function buildDatasets(
  readings: WeightReading[],
  view: ViewMode,
  outliers: Set<string>,
): ChartDataset<"line", BasePoint[]>[] {
  if (view === "raw") {
    return CAT_IDS.flatMap((catId) =>
      buildRawDatasets(readings, catId, outliers),
    );
  }
  return CAT_IDS.flatMap((catId) => buildDailyDatasets(readings, catId));
}

function buildRawDatasets(
  readings: WeightReading[],
  catId: CatId,
  outliers: Set<string>,
): ChartDataset<"line", BasePoint[]>[] {
  const cat = CATS[catId];
  const { normal, outliers: bad } = partitionByOutlier(
    readings,
    outliers,
    catId,
  );
  const toPoint = (r: WeightReading, isOutlier: boolean): RawPoint => ({
    x: r.timestamp.getTime(),
    y: r.weightKg,
    source: r.source,
    key: r.key,
    catId: r.catId,
    isOutlier,
  });
  const datasets: ChartDataset<"line", BasePoint[]>[] = [];
  if (normal.length > 0) {
    datasets.push(
      tagDataset(
        {
          label: cat.name,
          data: normal
            .map((r) => toPoint(r, false))
            .sort((a, b) => a.x - b.x),
          borderColor: cat.color,
          backgroundColor: cat.color,
          showLine: false,
          pointRadius: 2.5,
          pointHoverRadius: 4,
        },
        { catId, kind: "raw" },
      ),
    );
  }
  if (bad.length > 0) {
    datasets.push(
      tagDataset(
        {
          label: `${cat.name} outliers`,
          data: bad.map((r) => toPoint(r, true)).sort((a, b) => a.x - b.x),
          borderColor: "#dc2626",
          backgroundColor: cat.color,
          pointStyle: "rectRot",
          pointBorderWidth: 1.5,
          showLine: false,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        { catId, kind: "raw-outlier" },
      ),
    );
  }
  return datasets;
}

function buildDailyDatasets(
  readings: WeightReading[],
  catId: CatId,
): ChartDataset<"line", BasePoint[]>[] {
  const cat = CATS[catId];
  const aggregates = aggregateDailyMedian(
    readings.filter((r) => r.catId === catId),
  );
  if (aggregates.length === 0) return [];

  const xs = aggregates.map((a) => new Date(`${a.date}T12:00:00`).getTime());
  const medians = aggregates.map((a) => a.median);
  const trend = rollingMedian(medians, TRENDLINE_WINDOW_DAYS);

  const lowPoints: BasePoint[] = aggregates.map((a, i) => ({
    x: xs[i],
    y: a.min,
  }));
  const highPoints: BasePoint[] = aggregates.map((a, i) => ({
    x: xs[i],
    y: a.max,
  }));
  const medianPoints: DailyPoint[] = aggregates.map((a, i) => ({
    x: xs[i],
    y: a.median,
    count: a.count,
    min: a.min,
    max: a.max,
  }));
  const trendPoints: BasePoint[] = aggregates.map((_, i) => ({
    x: xs[i],
    y: trend[i],
  }));

  const bandFill = cat.color + "1a";

  return [
    tagDataset(
      {
        label: `${cat.name} range (low)`,
        data: lowPoints,
        borderColor: "transparent",
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0.25,
      },
      { catId, kind: "band-low" },
    ),
    tagDataset(
      {
        label: `${cat.name} range (high)`,
        data: highPoints,
        borderColor: "transparent",
        backgroundColor: bandFill,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: "-1",
        tension: 0.25,
      },
      { catId, kind: "band-high" },
    ),
    tagDataset(
      {
        label: cat.name,
        data: medianPoints,
        borderColor: cat.color,
        backgroundColor: cat.color,
        fill: false,
        tension: 0.25,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
      { catId, kind: "median" },
    ),
    tagDataset(
      {
        label: `${cat.name} trend`,
        data: trendPoints,
        borderColor: cat.color,
        backgroundColor: "transparent",
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0.4,
      },
      { catId, kind: "trend" },
    ),
  ];
}

/** Attach a small `meta` blob to a dataset so legend/tooltip filters and
 * the click handler can tell `median`/`raw`/`trend`/`band-*` apart without
 * brittle label matching. */
function tagDataset(
  dataset: ChartDataset<"line", BasePoint[]>,
  meta: DatasetMeta,
): ChartDataset<"line", BasePoint[]> {
  return Object.assign(dataset, { meta });
}

function datasetMeta(dataset: unknown): DatasetMeta | undefined {
  if (!dataset || typeof dataset !== "object") return undefined;
  return (dataset as { meta?: DatasetMeta }).meta;
}
