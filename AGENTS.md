# Agent guide

Guidance for AI agents working in this repo. Keep this file updated as the
project evolves.

## What this project is

A small web app that visualizes Jasper's and Enzo's weight over time, using
CSV exports from a "smart" litter box's proprietary app. Designed for a
single user (the owner) viewing locally or on a Netlify-hosted instance.
Keep it simple — no auth, no telemetry, no analytics.

## The cats

Two cats share the litter box:

- **Jasper** — the heavier of the two (~5.6 kg in the initial sample).
- **Enzo** — the lighter (~4.5 kg).

Their typical weights are far enough apart that a simple weight threshold
(`WEIGHT_THRESHOLD_KG` in `src/classify.ts`) reliably attributes a reading to
one cat or the other. When a specific reading misclassifies, the user can
fix it via the **per-reading override popup** in raw view (click any point);
overrides are persisted in `localStorage` (see `src/overrides.ts`). If the
threshold itself starts looking wrong systematically, that's the signal to
revisit it — discuss with the user before changing the heuristic.

## Architecture (dev vs. prod)

The app is fully client-side except for a single CSV-persistence endpoint
served by two different backends:

| Concern              | Dev (`npm run dev`)                     | Prod (Netlify)                    |
| -------------------- | --------------------------------------- | --------------------------------- |
| Bundled CSVs         | Vite glob import of `data/*.csv`        | Same — bundled at `vite build`.   |
| `GET /api/csvs`      | Vite plugin reads `data/` from disk     | Netlify Function reads Blobs      |
| `POST /api/csvs`     | Vite plugin writes file into `data/`    | Netlify Function writes to Blobs  |
| Per-reading overrides| `localStorage`                          | `localStorage`                    |

Implications worth keeping in mind:

- **Netlify Functions cannot write to the deployed project's filesystem**
  (the function container is read-only). That's why prod uploads land in
  Netlify Blobs, not git. If a user wants prod uploads to "make it back"
  into `data/` for git-tracking, they have to download from Blobs and
  commit manually. (We can add a sync command later if that becomes a real
  need.)
- The frontend doesn't know which backend it's talking to — both expose the
  same `{ files: [{ name, content }] }` shape and the same `POST` contract.
  Look at `src/api.ts` for the contract; do not break it without updating
  both backends.
- Bundled and persisted CSVs are merged on the client, then deduped by
  `(timestamp, weight, cat)`. Uploading a file that's also in `data/`
  doesn't double-count.

## Repo layout

- `data/` — raw CSV exports, one file per month. Filenames follow
  `poobox_activity_<YYYY-MM-DD>.csv`. **Treat these as read-only inputs in
  source code.** The dev API plugin is the only thing allowed to write here,
  and only with the `^[\w.\-]+\.csv$` filename whitelist applied.
- `netlify/`
  - `functions/csvs.ts` — production `/api/csvs` handler, Blobs-backed. Uses
    Netlify Functions v2 (default-export request handler + `config.path`).
- `netlify.toml` — Netlify build / dev / redirect config. The SPA catch-all
  redirect must come *after* any explicit function paths (the v2 function's
  own `config.path` already wins, but be careful when adding more rewrites).
- `vite.config.ts` — Vite config + the dev-only `chonkwatch-dev-api` plugin
  that backs `/api/csvs` against the local filesystem.
- `src/`
  - `main.ts` — entrypoint; orchestrates loading, filters, charts, upload,
    overrides, and the popup. Holds the small amount of UI state in
    module-local variables.
  - `types.ts` — shared types and registries (`CATS`, `CAT_IDS`,
    `DATE_RANGES`), plus the `readingKey` helper used by overrides + the
    outlier set.
  - `parse.ts` — pure CSV parser. Returns `RawWeightReading[]`. Handles the
    `a.m.`/`p.m.` and unit quirks, and the year-from-filename inference.
  - `classify.ts` — assigns each reading to Jasper or Enzo via threshold,
    honoring any per-reading overrides (`ignore` drops the row).
  - `aggregate.ts` — daily-median aggregation per cat plus a rolling-median
    smoother used by the chart's trendline overlay.
  - `outliers.ts` — MAD-based per-cat outlier detection. Robust to noisy
    readings (mid-deposit weights, etc.); flagged keys feed back into the
    raw-view rendering as a separate styled dataset.
  - `filter.ts` — preset date-range windows (`30d`, `90d`, `1y`, `all`),
    anchored to the latest reading rather than wall-clock `now`.
  - `data-loader.ts` — bundled glob import + persisted-API fetch + upload
    helpers + classify-and-dedupe (`buildDataset`).
  - `api.ts` — frontend client for `/api/csvs`. The only place the rest of
    the app talks HTTP.
  - `overrides.ts` — `localStorage`-backed override map under
    `chonkwatch:overrides:v1`.
  - `upload.ts` — file-input + page-wide drag-and-drop UI glue. Posts to
    the API and parses locally for instant feedback.
  - `chart.ts` — main weight chart. Builds two views (daily median, raw
    readings), the min/max range bands, the 7-day rolling-median trendline,
    outlier-styled raw points, and the click handler that opens the
    override popup. Reacts to `prefers-color-scheme` changes.
  - `visits-chart.ts` — small stacked-bar chart under the main chart
    showing how many readings each cat had per day.
  - `stats.ts` — per-cat summary numbers shown beside the charts.
  - `style.css` — all styles. Plain CSS, no preprocessor; auto dark mode
    via `prefers-color-scheme`.
- `index.html` — single page; references `/src/main.ts` as a module.
- `package.json` — npm metadata. Vite is the dev server / bundler; Chart.js
  is the visualization library; `chartjs-adapter-date-fns` provides the
  time-axis date adapter; `chartjs-plugin-zoom` enables drag/wheel zoom and
  pan; `@netlify/blobs` is the Blobs runtime for the prod function.
  Prefer adding new deps only when clearly needed.
- `tsconfig.json` — solution-style config that references
  `tsconfig.app.json` (browser code) and `tsconfig.node.json` (vite config
  + Netlify function code, which run on Node and need different libs).
- `README.md` — human-facing overview.
- `AGENTS.md` — this file.

## CSV format gotchas

The CSV is messier than it looks. Before changing the parser, re-read a
sample file in `data/`. Known quirks:

- Header row: `Activity,Timestamp,Value`.
- `Activity` may be values other than `Weight recorded` (e.g. usage events).
  The parser only emits weight rows.
- `Timestamp` is `MM-DD H:MM a.m./p.m.` with **no year**. The year is
  inferred from the export filename's date suffix; rows whose `MM-DD` is
  later than the export's `MM-DD` are assumed to be from the previous year
  (December rows in a January export, etc.).
- `a.m.` / `p.m.` use lowercase letters with periods — not `AM`/`PM`. Don't
  feed the string straight to `Date.parse`.
- `Value` is a unit-suffixed string like `"5.5 kg"`. The parser strips the
  unit and warns + skips on anything other than `kg`, since a unit mix-up
  would silently corrupt the chart.

## Conventions

- TypeScript with `strict` on. Browser code uses `tsconfig.app.json`; Node
  code (`vite.config.ts`, `netlify/**/*.ts`) uses `tsconfig.node.json`.
  `npm run typecheck` runs both via TS solution mode (`tsc -b`).
- ES modules everywhere (`"type": "module"` in `package.json`). Imports use
  explicit `.ts` extensions; `allowImportingTsExtensions` is on.
- Keep data transforms pure (`parse.ts`, `classify.ts`, `aggregate.ts`,
  `filter.ts`, `outliers.ts`): functions that take inputs and return
  arrays/records. No DOM, no fetch, no globals — easy to unit-test later.
  The DOM/Chart.js/HTTP stuff lives in `main.ts`, `chart.ts`,
  `visits-chart.ts`, `upload.ts`, and `api.ts`.
- Time math runs in the user's local timezone (matching the CSV's
  local-time semantics). `aggregate.ts#localIsoDate` is the canonical
  day-key formatter.
- Chart datasets are tagged with a small `meta: { catId, kind }` blob in
  `chart.ts`. Use `meta.kind` (not the `label`) when filtering legend
  items, branching tooltip text, or routing click events.
- Every persistence-bound filename must satisfy `^[\w.\-]+\.csv$` — both
  backends enforce this and reject anything else with a 400.

## Things to avoid

- Don't commit large binary assets, anything in `node_modules/`,
  `dist/`, or `.netlify/` — they're already gitignored.
- Don't introduce a database, queue, or build-time data pipeline. The CSVs
  should be loaded and parsed in the browser; `/api/csvs` is the only
  server-side surface.
- Don't auto-rename or "clean up" files in `data/`. The raw export
  filenames carry the year, which the parser depends on.
- Don't add analytics, error reporting, or external network calls.
- Don't switch frontend frameworks (React/Vue/Svelte) without buy-in —
  vanilla DOM + Chart.js is the current default and the codebase is small
  enough not to need more.

## When in doubt

Ask the user before:

- Adding a new top-level dependency.
- Introducing a framework — vanilla TS + Chart.js is the current default.
- Changing the CSV input format or moving CSV processing server-side.
- Materially changing the cat-assignment heuristic. Per-reading overrides
  are the supported escape hatch; threshold logic should stay simple unless
  the data clearly demands more.
- Wiring any non-Netlify backend (S3, Supabase, GitHub API to commit to
  `data/`, etc.) — it's a noticeable architectural shift that should be
  discussed first.
