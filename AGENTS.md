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

| Concern              | Dev (`npm run dev`)                            | Prod (Netlify)                    |
| -------------------- | ---------------------------------------------- | --------------------------------- |
| Bundled CSVs         | Vite glob import of `data/poobox_activity_*.csv` | Same — bundled at `vite build`.   |
| `GET /api/csvs`      | Vite plugin reads `data/` from disk            | Netlify Function reads Blobs      |
| `POST /api/csvs`     | Vite plugin writes file into `data/`           | Netlify Function writes to Blobs  |
| Per-reading overrides| `localStorage`                                 | `localStorage`                    |

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
- The bundled glob deliberately requires the `poobox_activity_` prefix
  (note the underscore). The vendor bulk export
  (`poobox_activity-export.csv`, dash) is excluded so its ~1.7 MB payload
  doesn't get inlined into the JS bundle. It still loads via `/api/csvs`
  on the persisted-fetch path.

## Repo layout

- `data/` — raw CSV inputs in two flavors:
  - **Monthly consumer-app exports**, one file per month, named either
    `poobox_activity_<YYYY-MM-DD>.csv` (current export) or
    `poobox_activity_<M-D-YYYY>.csv` (older export, year at the end, no
    leading zeros). These are the routine incremental drops the user
    receives from the litter-box app.
  - **Vendor bulk export**, a single `poobox_activity-export.csv` (dashed,
    no date suffix) — a ~1.7 MB direct database export from the vendor.
    It's the canonical archive: it carries per-row `pet_id` (so cat
    assignment is exact, not threshold-based), full UTC timestamps, and a
    soft-delete flag. The two shipping monthly CSVs that previously lived
    here were fully subsumed by this and were deleted; future monthly
    drops still land alongside it.
  **Treat these as read-only inputs in source code.** The dev API plugin
  is the only thing allowed to write here, and only with the
  `^[\w.\-]+\.csv$` filename whitelist applied.
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
  - `parse.ts` — pure CSV parser for the **monthly consumer-app exports**.
    Returns `RawWeightReading[]`. Handles the `a.m.`/`p.m.` and unit
    quirks, and the year-from-filename inference. Output rows have no
    `catId` set, so classification falls back to the threshold heuristic.
  - `vendor-parse.ts` — pure CSV parser for the **vendor bulk export**
    schema. Different file because the schema, units (lbs), quoting
    rules (RFC 4180), and timestamp format all differ from the simple
    monthly format. Returns `RawWeightReading[]` with `catId` pre-assigned
    from the row's `pet_id`, so the threshold heuristic is bypassed for
    vendor rows. Filters out `metadata_delete=true` rows.
  - `classify.ts` — assigns each reading to Jasper or Enzo. Resolution
    order: per-reading override first (`ignore` drops the row), then any
    `catId` already on the raw reading (vendor path), then the threshold
    heuristic.
  - `aggregate.ts` — daily-median aggregation per cat plus a rolling-median
    smoother used by the chart's trendline overlay.
  - `outliers.ts` — MAD-based per-cat outlier detection. Robust to noisy
    readings (mid-deposit weights, etc.); flagged keys feed back into the
    raw-view rendering as a separate styled dataset.
  - `filter.ts` — preset date-range windows (`30d`, `90d`, `1y`, `all`),
    anchored to the latest reading rather than wall-clock `now`.
  - `data-loader.ts` — bundled glob import + persisted-API fetch + upload
    helpers + classify-and-dedupe (`buildDataset`). Sniffs each file's
    header to dispatch between `parse.ts` and `vendor-parse.ts`.
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

There are three CSV shapes in the wild — two consumer-app generations and
one vendor bulk export. The loader sniffs each file's header and routes to
the right parser. Re-read a sample of each shape in `data/` before
changing parsing logic.

### Monthly consumer-app exports (`parse.ts`)

The CSV is messier than it looks. There are two export-tool generations
in the wild — both supported. Known quirks:

- Header row: `Activity,Timestamp,Value`.
- `Activity` may be values other than `Weight recorded` (e.g. usage
  events). The parser only emits weight rows, and matches the activity
  label case-insensitively (older exports capitalize `Weight Recorded`).
- `Timestamp` lacks a year. Two shapes are accepted:
  - Current export: `MM-DD H:MM a.m./p.m.` — dash-separated date,
    lowercase meridiem with periods, leading space before the meridiem.
  - Older export: `M/D H:MMAM/PM` — slash-separated date, uppercase
    meridiem with no periods and no separating space.
  In both cases the year is inferred from the export filename's date
  suffix; rows whose `MM-DD` is later than the export's `MM-DD` are assumed
  to be from the previous year (December rows in a January export, etc.).
- Don't feed the timestamp string straight to `Date.parse` — both shapes
  rely on the dedicated `TIMESTAMP_RE` in `parse.ts`.
- `Value` is a unit-suffixed string like `"5.5 kg"`. The parser strips the
  unit and warns + skips on anything other than `kg`, since a unit mix-up
  would silently corrupt the chart.
- Filenames also come in two shapes (`YYYY-MM-DD` and `M-D-YYYY` — see the
  Repo layout note); `exportDateFromFilename` in `parse.ts` handles both.
  The two patterns are unambiguous because exactly one of the outer date
  components has four digits.
- Rows here have no per-row pet identity, so `classify.ts` falls back to
  the `WEIGHT_THRESHOLD_KG` heuristic (5.0 kg) for these.

### Vendor bulk export (`vendor-parse.ts`)

The vendor occasionally provides a direct database dump (so far: once).
Distinct from the monthly format on every axis that matters. Known quirks:

- Header row starts with `pet_id,age,birthday,…` — that's the sniff used
  in `data-loader.ts` to pick this parser over the monthly one.
- Real CSV quoting: fields contain commas and JSON-ish blobs like
  `"[""maine_coon""]"` and
  `"{""brandType"":""TIKI_CAT"",…}"`. The `splitCsvRow` in
  `vendor-parse.ts` is a small RFC 4180 implementation; the naive
  `line.split(",")` used in `parse.ts` would corrupt these rows.
- **Weights are in pounds**, in the `last_weight_reading` column.
  Multiplied by `LBS_TO_KG` (0.45359237) before being stored as
  `weightKg`. (There's also a `weight` column — that's a smoothed
  per-pet aggregate, not the per-event reading. Don't use it.)
- Timestamps live in `metadata_timestamp` as
  `YYYY-MM-DD HH:MM:SS.ffffff+00` (space separator, micro-fractions, two-
  digit timezone offset). `parseVendorTimestamp` normalizes them to ISO
  8601 (`T` separator, fractional seconds truncated to 3 digits, padded
  `±HH:MM` offset) before handing off to `new Date()`.
- `metadata_delete=true` is a vendor-side soft-delete tombstone — those
  rows must be skipped, not surfaced.
- `pet_id` → `catId` mapping lives at the top of `vendor-parse.ts`. If
  the user ever adds a third pet the mapping needs an entry; readings for
  unknown pet IDs are skipped with a console warning rather than guessed.
- Each row is also a hefty pile of denormalized pet metadata (breed,
  diet, food brand, personality, …). All ignored — only the four
  required columns participate in parsing. If the vendor schema ever
  drops or renames one of those four, the parser logs an error and emits
  zero rows for the file (rather than silently misinterpreting columns).

## Responsive design

The app is meant to be usable from a phone as well as a desktop browser, so
two things to keep in mind when adding UI:

- `src/style.css` declares responsive breakpoints in a single block at the
  bottom — 720 px (stack the controls bar), 480 px (smaller chart heights +
  full-width override popup), 360 px (single-column cat-card stats). New
  components should fit into that ladder rather than introducing one-off
  `@media` blocks scattered through the file.
- Touch-primary devices (`@media (pointer: coarse)`) hide desktop-only
  interaction hints via the same CSS file, and `chart.ts` flips its zoom
  plugin config so pan + box-zoom work without modifier keys (touch has no
  Shift/Alt). The detection runs once at module load — fine for mobile
  Safari/Chrome/Firefox; hybrid devices effectively get the desktop config.
- Two layout guardrails worth knowing about before you "simplify" them:
  - `main` and `.cats` use `grid-template-columns: minmax(0, 1fr)` rather
    than the implicit `1fr`. The default min-track-size is `auto`, which
    lets a too-wide descendant (Chart.js canvases briefly hold a 300 px
    intrinsic width before the first responsive resize) stretch the column
    past the parent's content box. `minmax(0, 1fr)` caps the track.
  - `body` has `overflow-x: clip` and the chart canvases have
    `min-width: 0; max-width: 100%`. Belt-and-suspenders for the same
    canvas-resize quirk; without them the right padding visually
    "disappears" on narrow viewports while Chart.js settles. Prefer `clip`
    over `hidden` so we don't accidentally promote `body` into a scroll
    container (breaks `position: sticky`).

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
