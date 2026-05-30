# catweight

A simple data visualization of Jasper's and Enzo's weight over time, sourced
from CSV exports of a "smart" litter box's proprietary app. Designed to run
locally with `npm run dev` or be deployed straight to Netlify.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually [http://localhost:5173](http://localhost:5173)).

Requires Node 20.19+ or 22.12+ (Vite 8).

## Features

- **Daily median view** with a translucent min/max range band and a 7-day
  rolling-median trendline overlay per cat — smooths the day-to-day noise
  caused by mid-deposit scale readings.
- **Raw readings view** that scatters every parsed weight, with **MAD-based
  outlier flagging** rendering suspicious points as red diamonds. Click any
  point to reassign it to a cat or mark it as ignored — overrides are saved
  to `localStorage`.
- **Date-range presets** (All / 1Y / 90D / 30D), anchored to the most
  recent reading so old datasets still render.
- **Drag-zoom and pan** on the chart (wheel/pinch to zoom, Alt-drag to
  box-zoom, Shift-drag to pan). A "Reset zoom" button appears once you've
  zoomed.
- **Per-cat hide toggles** on each cat card.
- **Visits-per-day bar chart** under the main chart for activity context.
- **Auto dark mode** following the OS `prefers-color-scheme`.
- **CSV upload** via button or page-wide drag-and-drop, persisted
  server-side and deduped against bundled data.

## How data flows in

There are two ways to add CSV exports:

1. **Drop them in `data/`** before starting the dev server. Anything
   matching `data/poobox_activity_YYYY-MM-DD.csv` is bundled by Vite at
   build time.
2. **Upload at runtime** via the "Add CSV export(s)" button or by dragging
   files onto the page. Uploads are sent to `/api/csvs`, which:
   - In dev (Vite): writes the file straight into `data/`. Commit it to
     git when ready.
   - In production (Netlify): stores the file in a Netlify Blobs store
     named `catweight-csvs`. The function container's filesystem is
     read-only at runtime, so prod uploads cannot land in the deployed
     repo. They survive across deploys via Blobs and merge with bundled
     data on every page load.

Each CSV row looks like:

```csv
Activity,Timestamp,Value
Weight recorded,05-30 10:23 a.m.,5.5 kg
```

A few quirks worth knowing about:

- The `Timestamp` column has no year. The year is inferred from the export
  filename (`poobox_activity_2026-05-30.csv` → 2026), with a wrap to the
  previous year for any rows whose `MM-DD` is later than the export's.
- `Value` carries its unit. Anything other than `kg` is skipped with a
  console warning so a unit change can't silently corrupt the chart.
- Multiple cats share the box. Readings are attributed to Jasper or Enzo
  via a fixed weight threshold (see `src/classify.ts`). When a specific
  reading misclassifies, click it in raw view to fix it; that override is
  saved to `localStorage` and re-applied on every load.

## Deploying to Netlify

The repo includes a `netlify.toml` and a serverless function under
`netlify/functions/`. To deploy:

1. Push the repo to GitHub (or wherever).
2. In Netlify, "Import from Git" and pick the repo. The default settings
   (build command `npm run build`, publish directory `dist`) match
   `netlify.toml`.
3. Netlify Blobs is enabled per-site automatically — no extra configuration
   needed.

To test the production-shaped backend locally, install the Netlify CLI and
run:

```bash
netlify dev
```

That serves the Netlify Function and Blobs emulator alongside Vite. Plain
`npm run dev` is faster and uses the local-filesystem dev API instead.

## Scripts

- `npm run dev` — Vite dev server + filesystem-backed `/api/csvs`.
- `npm run build` — type-check both projects and produce a static build in
  `dist/`.
- `npm run preview` — serve the production build locally (no API).
- `npm run typecheck` — type-check only (`tsc -b`).

## Stack

- [Vite](https://vitejs.dev/) — dev server, bundler, and home of the
  filesystem-backed dev API plugin. Requires Node 20.19+ or 22.12+.
- [TypeScript](https://www.typescriptlang.org/) — strict mode, solution-style
  config (`tsconfig.app.json` + `tsconfig.node.json`).
- [Chart.js](https://www.chartjs.org/) + `chartjs-adapter-date-fns` — chart
  rendering with a time-aware x-axis.
- [`chartjs-plugin-zoom`](https://www.chartjs.org/chartjs-plugin-zoom/) —
  drag/wheel zoom and pan.
- [Netlify Functions](https://docs.netlify.com/functions/overview/) +
  [Netlify Blobs](https://docs.netlify.com/blobs/overview/) — production
  CSV persistence backend.

See [`AGENTS.md`](./AGENTS.md) for a tour of the source layout, the
dev/prod architecture split, and the small pile of CSV-format gotchas.
