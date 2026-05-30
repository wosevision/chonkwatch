# Agent guide

Guidance for AI agents working in this repo. Keep this file updated as the
project evolves.

## What this project is

A small client-side web app that visualizes one or more cats' weight over time,
using CSV exports from a "smart" litter box's proprietary app. The intended
audience is a single user (the owner) viewing locally — there is no backend,
no auth, no telemetry. Keep it simple.

## Repo layout

- `data/` — raw CSV exports, one file per month. Filenames follow
  `poobox_activity_<YYYY-MM-DD>.csv`. **Treat these as read-only inputs.** Do
  not rewrite, normalize, or rename them; parse them at runtime instead.
- `package.json` — npm metadata. Vite is the dev server / bundler; Chart.js is
  the visualization library. Prefer adding new deps only when clearly needed.
- `README.md` — human-facing overview.
- `AGENTS.md` — this file.

Source code does not exist yet. When adding it, prefer a flat `src/` layout
unless the project clearly outgrows it.

## CSV format gotchas

The CSV is messier than it looks. Before writing a parser, re-read a sample
file in `data/`. Known quirks:

- Header row: `Activity,Timestamp,Value`.
- `Activity` may be values other than `Weight recorded` (e.g. usage events).
  Filter for the activity type you actually care about.
- `Timestamp` is `MM-DD H:MM a.m./p.m.` with **no year**. Infer the year from
  the export filename's date suffix, and watch for month rollovers within a
  single file.
- `a.m.` / `p.m.` use lowercase letters with periods — not `AM`/`PM`. Don't
  feed the string straight to `Date.parse`.
- `Value` is a unit-suffixed string like `"5.5 kg"`. Strip the unit and parse
  as a float; don't assume the unit is always `kg` — surface a clear error if
  it isn't.
- Rows are roughly newest-first, but don't rely on ordering — sort
  explicitly after parsing.
- Multiple cats may share the box. Readings cluster around each cat's typical
  weight (e.g. ~4.5 kg vs ~5.6 kg in the current sample). Cluster-by-weight
  is the simplest disambiguation; let the user override per-row if needed.

## Conventions

- ES modules (`"type": "module"` in `package.json`).
- Modern JS/TS is fine; pick one and stick with it. If introducing TypeScript,
  add it as a single coherent change with `tsconfig.json` and update this file.
- No global state libraries until there's a real need.
- Keep CSV parsing pure and unit-testable: a function that takes a string (and
  the filename's year) and returns a typed array of weight events.

## Things to avoid

- Don't commit large binary assets or anything in `node_modules/` /
  `dist/` — they're already gitignored.
- Don't introduce a backend, database, or build-time data pipeline. The CSVs
  should be loaded and parsed in the browser.
- Don't auto-rename or "clean up" files in `data/`. The raw export filenames
  carry the year, which the parser depends on.
- Don't add analytics, error reporting, or external network calls.

## When in doubt

Ask the user before:

- Adding a new top-level dependency.
- Introducing a framework (React, Vue, Svelte, etc.) — vanilla JS + Chart.js
  is the current default.
- Changing the CSV input format or adding a server-side processing step.
