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
import type { ChartConfiguration, ChartDataset } from "chart.js";

import { aggregateDailyMedian } from "./aggregate.ts";
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
);

interface CatPoint {
  x: number;
  y: number;
}

/**
 * Single Chart.js instance that flips between daily-median and raw views by
 * swapping its dataset. Kept stateful (rather than rebuilt on each update) so
 * Chart.js can animate transitions and resize cleanly.
 */
export class WeightChart {
  private chart: Chart<"line", CatPoint[]>;

  constructor(canvas: HTMLCanvasElement) {
    const config: ChartConfiguration<"line", CatPoint[]> = {
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
            time: { unit: "day", tooltipFormat: "PP" },
            ticks: { maxRotation: 0, autoSkipPadding: 16 },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
          y: {
            title: { display: true, text: "Weight (kg)" },
            grid: { color: "rgba(0,0,0,0.05)" },
            ticks: { callback: (v) => `${v} kg` },
          },
        },
        plugins: {
          legend: { position: "top", align: "end" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const y = (ctx.raw as CatPoint).y;
                return `${ctx.dataset.label}: ${y.toFixed(2)} kg`;
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
}

function buildDatasets(
  readings: WeightReading[],
  view: ViewMode,
): ChartDataset<"line", CatPoint[]>[] {
  return CAT_IDS.map((catId) => buildDataset(readings, catId, view));
}

function buildDataset(
  readings: WeightReading[],
  catId: CatId,
  view: ViewMode,
): ChartDataset<"line", CatPoint[]> {
  const cat = CATS[catId];
  const forCat = readings.filter((r) => r.catId === catId);

  if (view === "raw") {
    const data = forCat
      .map((r) => ({ x: r.timestamp.getTime(), y: r.weightKg }))
      .sort((a, b) => a.x - b.x);
    return {
      label: cat.name,
      data,
      borderColor: cat.color,
      backgroundColor: cat.color,
      showLine: false,
      pointRadius: 2.5,
      pointHoverRadius: 4,
    };
  }

  const aggregates = aggregateDailyMedian(forCat).filter(
    (a) => a.catId === catId,
  );
  const data = aggregates.map((a) => ({
    x: new Date(`${a.date}T12:00:00`).getTime(),
    y: a.median,
  }));
  return {
    label: cat.name,
    data,
    borderColor: cat.color,
    backgroundColor: cat.color + "22",
    fill: false,
    tension: 0.25,
    pointRadius: 2,
    pointHoverRadius: 4,
    borderWidth: 2,
  };
}
