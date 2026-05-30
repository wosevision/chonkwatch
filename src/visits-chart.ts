import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
} from "chart.js";
import "chartjs-adapter-date-fns";
import type { ChartConfiguration, ChartDataset } from "chart.js";

import { localIsoDate } from "./aggregate.ts";
import {
  CAT_IDS,
  CATS,
  type CatId,
  type WeightReading,
} from "./types.ts";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, TimeScale, Tooltip);

interface BarPoint {
  x: number;
  y: number;
}

/**
 * Compact stacked-bar chart sitting under the main chart. One bar per day,
 * stacked by cat, height = number of readings. Designed as a passive
 * "context strip" — its x-axis is independently labeled rather than
 * coupled to the main chart's pan/zoom state, since it shares the same
 * `readings` input and so always reflects the same data window.
 */
export class VisitsChart {
  private chart: Chart<"bar", BarPoint[]>;

  constructor(canvas: HTMLCanvasElement) {
    const config: ChartConfiguration<"bar", BarPoint[]> = {
      type: "bar",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        scales: {
          x: {
            type: "time",
            stacked: true,
            time: { unit: "day", tooltipFormat: "PP" },
            ticks: { maxRotation: 0, autoSkipPadding: 16 },
            grid: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: "Visits" },
            ticks: { precision: 0 },
            grid: { color: gridColor() },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                if (items.length === 0) return "";
                const ts = items[0].parsed.x;
                if (ts == null) return "";
                return new Date(ts).toLocaleDateString();
              },
              label: (ctx) => {
                const y = (ctx.raw as BarPoint).y;
                const reading = y === 1 ? "reading" : "readings";
                return `${ctx.dataset.label}: ${y} ${reading}`;
              },
            },
          },
        },
      },
    };
    this.chart = new Chart(canvas, config);
  }

  update(readings: WeightReading[]): void {
    this.chart.data.datasets = buildVisitDatasets(readings);
    this.chart.update();
  }

  destroy(): void {
    this.chart.destroy();
  }
}

function buildVisitDatasets(
  readings: WeightReading[],
): ChartDataset<"bar", BarPoint[]>[] {
  return CAT_IDS.map((catId) => buildCatVisits(readings, catId));
}

function buildCatVisits(
  readings: WeightReading[],
  catId: CatId,
): ChartDataset<"bar", BarPoint[]> {
  const cat = CATS[catId];
  const counts = new Map<string, number>();
  for (const r of readings) {
    if (r.catId !== catId) continue;
    const key = localIsoDate(r.timestamp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const data = Array.from(counts.entries())
    .map<BarPoint>(([date, count]) => ({
      x: new Date(`${date}T12:00:00`).getTime(),
      y: count,
    }))
    .sort((a, b) => a.x - b.x);
  return {
    label: cat.name,
    data,
    backgroundColor: cat.color,
    borderColor: cat.color,
    borderWidth: 0,
    stack: "visits",
    barPercentage: 0.9,
    categoryPercentage: 0.95,
  };
}

function gridColor(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "rgba(255,255,255,0.06)"
    : "rgba(0,0,0,0.05)";
}
