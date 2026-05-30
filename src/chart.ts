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
  /** Number of readings on this day for this cat. */
  count: number;
  min: number;
  max: number;
}

interface RawPoint extends BasePoint {
  source: string;
}

/** Identifies which kind of dataset a Chart.js dataset slot represents. */
type DatasetKind = "median" | "trend" | "band-low" | "band-high" | "raw";

interface DatasetMeta {
  catId: CatId;
  kind: DatasetKind;
}

/**
 * Single Chart.js instance that flips between daily-median and raw views by
 * swapping its datasets. Kept stateful so Chart.js can animate transitions,
 * resize cleanly, and the zoom plugin's internal pan/zoom state survives.
 */
export class WeightChart {
  private chart: Chart<"line", BasePoint[]>;
  private themeMq: MediaQueryList;

  constructor(canvas: HTMLCanvasElement, onZoomChange?: (zoomed: boolean) => void) {
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
                const meta = (data.datasets[idx] as ChartDataset<"line"> & {
                  meta?: DatasetMeta;
                }).meta;
                if (!meta) return true;
                return meta.kind === "median" || meta.kind === "raw";
              },
            },
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                if (items.length === 0) return "";
                const ts = items[0].parsed.x;
                return new Date(ts).toLocaleString();
              },
              label: (ctx) => {
                const meta = (ctx.dataset as ChartDataset<"line"> & {
                  meta?: DatasetMeta;
                }).meta;
                if (!meta) return ctx.formattedValue;

                if (meta.kind === "raw") {
                  const p = ctx.raw as RawPoint;
                  return `${ctx.dataset.label}: ${p.y.toFixed(2)} kg`;
                }
                if (meta.kind === "median") {
                  const p = ctx.raw as DailyPoint;
                  const range = p.min === p.max
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
                return null;
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
                if (onZoomChange) onZoomChange(isZoomed(chart));
              },
            },
          },
        },
      },
    };
    this.chart = new Chart(canvas, config);
  }

  update(readings: WeightReading[], view: ViewMode): void {
    this.chart.data.datasets = buildDatasets(readings, view);
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
): ChartDataset<"line", BasePoint[]>[] {
  if (view === "raw") {
    return CAT_IDS.map((catId) => buildRawDataset(readings, catId));
  }
  return CAT_IDS.flatMap((catId) => buildDailyDatasets(readings, catId));
}

function buildRawDataset(
  readings: WeightReading[],
  catId: CatId,
): ChartDataset<"line", BasePoint[]> {
  const cat = CATS[catId];
  const data = readings
    .filter((r) => r.catId === catId)
    .map<RawPoint>((r) => ({
      x: r.timestamp.getTime(),
      y: r.weightKg,
      source: r.source,
    }))
    .sort((a, b) => a.x - b.x);
  return tagDataset(
    {
      label: cat.name,
      data,
      borderColor: cat.color,
      backgroundColor: cat.color,
      showLine: false,
      pointRadius: 2.5,
      pointHoverRadius: 4,
    },
    { catId, kind: "raw" },
  );
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

/** Attach a small `meta` blob to a dataset so legend/tooltip filters can
 * tell `median`/`raw`/`trend`/`band-*` apart without brittle label matching. */
function tagDataset(
  dataset: ChartDataset<"line", BasePoint[]>,
  meta: DatasetMeta,
): ChartDataset<"line", BasePoint[]> {
  return Object.assign(dataset, { meta });
}
