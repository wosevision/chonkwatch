# catweight

A simple client-side data visualization of Jasper's and Enzo's weight over
time, sourced from CSV exports of a "smart" litter box's proprietary app.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually [http://localhost:5173](http://localhost:5173)).

## How data flows in

There are two ways to load CSV exports:

1. **Drop them in `data/`.** Anything matching
   `data/poobox_activity_YYYY-MM-DD.csv` is bundled at build time via Vite's
   glob import and shows up automatically on next dev-server start.
2. **Upload at runtime.** Click "Add CSV export(s)" or drag-and-drop one or
   more `.csv` files anywhere on the page. Uploaded readings are merged with
   the bundled ones in-memory; nothing is persisted across reloads.

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
- Multiple cats share the box. Readings are attributed to Jasper or Enzo via a
  fixed weight threshold (see `src/classify.ts`), which works as long as their
  typical weights stay well-separated.

## Scripts

- `npm run dev` — Vite dev server with HMR.
- `npm run build` — type-check and produce a static build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run typecheck` — type-check only.

## Stack

- [Vite](https://vitejs.dev/) — dev server and bundler.
- [TypeScript](https://www.typescriptlang.org/) — strict mode.
- [Chart.js](https://www.chartjs.org/) + `chartjs-adapter-date-fns` — chart
  rendering with a time-aware x-axis.

See [`AGENTS.md`](./AGENTS.md) for a tour of the source layout and the small
pile of CSV-format gotchas.
