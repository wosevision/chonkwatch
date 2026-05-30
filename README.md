# catweight

A simple data visualization of cat weight over time, sourced from CSV exports
of a "smart" litter box's proprietary app.

## Status

Barebones scaffold. No UI yet.

## Data

CSV files live in [`data/`](./data/). Each file is a one-month export from the
litter box app, with the schema:

```csv
Activity,Timestamp,Value
Weight recorded,05-30 10:23 a.m.,5.5 kg
```

Notes on the raw format:

- `Timestamp` has no year — the year must be inferred from the export filename
  (e.g. `poobox_activity_2026-05-30.csv`) or from context.
- `Value` is a string with units (e.g. `"5.5 kg"`).
- Multiple cats may share the box, so weights cluster around each cat's typical
  mass. Disambiguating which cat produced a given reading is part of the
  visualization problem.

## Getting started

```bash
npm install
npm run dev
```

## Stack

- [Vite](https://vitejs.dev/) for the dev server and build
- [Chart.js](https://www.chartjs.org/) for the visualization
