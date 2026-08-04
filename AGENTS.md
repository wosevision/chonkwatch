# Agent guide

Guidance for AI agents working in this repo. Keep this file updated as the
project evolves.

## What this project is

A small web app that visualizes Jasper's and Enzo's weight over time, using
CSV exports from a "smart" litter box's proprietary app. Designed for a
single user (the owner) viewing locally or on a Netlify-hosted instance.
Keep it simple — no auth, no telemetry, no analytics.

## The cats

Cats are **user-managed data**, not hardcoded. The registry lives in a
persisted `CatStore` (see `src/cats.ts`) and is edited through the "Manage
cats" dialog. Nothing in the code may assume how many cats there are or what
they're called.

The two the app was built around ship as the first-run seed in `SEED_CATS`:

- **Jasper** — the heavier (~5.6 kg). **Passed away in June 2026**, recorded as
  `endedAt: "2026-06-30"`. His history is intact and stays in the app.
- **Enzo** — the lighter (~4.5 kg). The only cat currently being weighed.

Worth remembering that these are the user's pets, not just rows in a CSV.

### How a reading gets attributed

The litter box weighs whoever stands on it but doesn't say who that was, so
identity is inferred. `classifyAll` in `src/classify.ts` resolves in this order,
highest priority first:

1. **Dropped-reading set** — `store.droppedReadingKeys`, readings orphaned by
   deleting a cat. Skipped entirely.
2. **Per-reading override** — set by clicking a point in raw view; `ignore`
   drops the row. Persisted in `localStorage` (`src/overrides.ts`). An override
   naming a cat that no longer exists is treated as absent.
3. **`vendorPetId` match** — the vendor bulk export carries a per-row `pet_id`;
   if some cat's `vendorPetId` equals it, that's exact attribution, no guessing.
4. **Nearest typical weight** — among the cats *tracked at that timestamp*.

Step 4 replaced a fixed 5.0 kg threshold, which only worked for exactly two
cats. Each cat carries a `typicalWeightKg` and the reading goes to whichever
cat's is closest; ties break on `id` so results are stable across reloads. For
the seeded pair (5.6 and 4.5) the implied boundary is 5.05 kg rather than 5.00,
which changed nothing in practice — every vendor row carries a `pet_id`, so it
never reaches step 4.

### `startedAt` / `endedAt` are load-bearing

Both bound the window in which a cat is a candidate for step 4, and both matter
for correctness rather than presentation:

- **`endedAt`** stops a cat who has passed away from reappearing when a
  surviving cat's weight drifts into the range that used to be theirs. Enzo sits
  only ~500 g below Jasper's typical weight, so without it, Enzo gaining weight
  would split his series and start regrowing Jasper's — hiding exactly the trend
  this app exists to show.
- **`startedAt`** is the mirror image, and is why adding a cat doesn't rewrite
  history. A newly adopted cat weighing near an existing one would otherwise
  retroactively claim a year of their readings. New cats added through the
  dialog default to "first tracked = today" for this reason.

`endedAt` also drives presentation: `computeStats` sets `ended: true`, anchors
the 30-day average to the cat's final reading instead of wall-clock `now` (a
`now`-based window would always be empty), and `main.ts` relabels the card
("Last reading", "Final 30-day avg") and adds a `.cat-card__note` line showing
the span the readings cover, so blanks don't read as missing data.

Jasper's date is set to the end of June 2026 because the exact day isn't
recorded in any export — the data jumps from 2026-06-01 (the vendor export's
cutoff) straight to 2026-07-07. **If a CSV covering June 2026 is ever imported,
ask the user for the precise date** rather than letting the approximation
silently split that month.

### Deletion vs. `endedAt`

**Deleting a cat is only for correcting a mistaken entry** — a typo, a
duplicate, a cat added by accident. It is *not* how a cat that has passed away
is recorded; that's `endedAt`, which preserves their history. The confirmation
dialog says this explicitly and should keep saying it.

Deletion also **drops the readings currently attributed to that cat**, by
recording their keys in `store.droppedReadingKeys`. That list exists because
readings live in immutable CSVs — without it, those readings would simply be
reassigned to whichever remaining cat is nearest in weight. It's stored beside
the cats (not in `localStorage` with the overrides) so every device agrees on
which readings exist. There's no undo in the UI; the escape hatch is editing
`data/cats.json` (dev) or the Blobs document (prod) by hand.

Deleting also prunes any per-reading overrides pointing at that cat
(`pruneOverrides`) and drops it from the `hidden` set.

### Things to be careful about

- `CatId` is a plain `string`, not a union. There is no exhaustive list to
  switch on, and `cats.length` can be 0 — the UI has an empty state for that
  and classification returns no readings.
- Two cats with near-identical typical weights over overlapping tracked periods
  are rejected by `validateDraft`, because weight can't tell them apart. The
  message tells the user to separate the weights or set start/end dates. If a
  user genuinely has two same-weight cats, that's the conversation to have —
  don't just loosen the check.
- Renaming a cat must never change its `id`; ids are referenced by overrides
  and the dropped-reading list. `newCatId` derives a slug once, at creation.

## Architecture (dev vs. prod)

The app is fully client-side except for two persistence endpoints, each served
by two different backends:

| Concern              | Dev (`npm run dev`)                            | Prod (Netlify)                    |
| -------------------- | ---------------------------------------------- | --------------------------------- |
| Bundled CSVs         | Vite glob import of `data/poobox_activity_*.csv` | Same — bundled at `vite build`.   |
| `GET /api/csvs`      | Vite plugin reads `data/` from disk            | Netlify Function reads Blobs      |
| `POST /api/csvs`     | Vite plugin writes file into `data/`           | Netlify Function writes to Blobs  |
| `GET /api/cats`      | Vite plugin reads `data/cats.json`             | Netlify Function reads Blobs      |
| `PUT /api/cats`      | Vite plugin writes `data/cats.json`            | Netlify Function writes to Blobs  |
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
  both backends. The same applies to `/api/cats`: a missing registry is a
  **404**, not an empty document, because the client has to distinguish "never
  seeded" (seed the defaults) from "seeded and empty" (the user deleted every
  cat, which must not be silently undone).
- Bundled and persisted CSVs are merged on the client, then deduped by
  `(timestamp, weight, cat)`. Uploading a file that's also in `data/`
  doesn't double-count.
- The bundled glob deliberately requires the `poobox_activity_` prefix
  (note the underscore). The vendor bulk export
  (`poobox_activity-export.csv`, dash) is excluded so its ~1.7 MB payload
  doesn't get inlined into the JS bundle. It still loads via `/api/csvs`
  on the persisted-fetch path.

## Repo layout

- `data/` — raw CSV inputs in two flavors, plus the cat registry:
  - **Monthly consumer-app exports**, one file per month, named either
    `poobox_activity_<YYYY-MM-DD>.csv` (current export) or
    `poobox_activity_<M-D-YYYY>.csv` (older export, year at the end, no
    leading zeros). These are the routine incremental drops the user
    receives from the litter-box app.
  - **Vendor bulk export**, a single `poobox_activity-export.csv` (dashed,
    no date suffix) — a ~1.7 MB direct database export from the vendor.
    It's the canonical archive: it carries per-row `pet_id` (so cat
    assignment is exact rather than weight-based), full UTC timestamps, and a
    soft-delete flag. The two shipping monthly CSVs that previously lived
    here were fully subsumed by this and were deleted; future monthly
    drops still land alongside it.
  - `cats.json` — the dev-time cat registry, written by the `/api/cats` dev
    handler. Unlike the CSVs this one *is* mutable; it's colocated here so all
    user data sits together and can be committed. It's absent until the app
    first seeds it, and the bundling glob is CSV-specific so it's never inlined
    into the client bundle.
  **Treat the CSVs as read-only inputs in source code.** The dev API plugin
  is the only thing allowed to write here, and only with the
  `^[\w.\-]+\.csv$` filename whitelist applied (or, for the registry, the
  fixed `cats.json` path).
- `netlify/`
  - `functions/csvs.ts` — production `/api/csvs` handler, Blobs-backed. Uses
    Netlify Functions v2 (default-export request handler + `config.path`).
  - `functions/cats.ts` — production `/api/cats` handler, same shape, backed by
    the `chonkwatch-cats` Blobs store under the key `cats.json`.
- `netlify.toml` — Netlify build / dev / redirect config. The SPA catch-all
  redirect must come *after* any explicit function paths (each v2 function's
  own `config.path` already wins, but be careful when adding more rewrites).
- `vite.config.ts` — Vite config + the dev-only `chonkwatch-dev-api` plugin
  that backs `/api/csvs` and `/api/cats` against the local filesystem.
- `src/`
  - `main.ts` — entrypoint; orchestrates loading, filters, charts, upload,
    overrides, the popup, and the cat cards. Holds the small amount of UI state
    in module-local variables. The cat cards and the override popup's buttons
    are both generated from the registry, so neither can be hardcoded in
    `index.html`.
  - `types.ts` — shared types (`Cat`, `CatStore`, `DATE_RANGES`, …) plus the
    `readingKey` helper used by overrides + the outlier set. `CatId` is a plain
    `string`.
  - `cats.ts` — the cat registry: `SEED_CATS`, `normalizeStore` (tolerant
    parsing of an untrusted document), `validateDraft`, the add/update/delete
    operations, and the `startedAt`/`endedAt` boundary helpers. Pure — no DOM,
    no fetch; every mutation returns a new `CatStore`.
  - `cats-ui.ts` — the "Manage cats" `<dialog>`: roster, add/edit form, and the
    delete confirmation carrying the "deletion is only for mistakes" notice.
    Owns no data; reaches back through its `deps` for everything.
  - `parse.ts` — pure CSV parser for the **monthly consumer-app exports**.
    Returns `RawWeightReading[]`. Handles the `a.m.`/`p.m.` and unit
    quirks, and the year-from-filename inference. Output rows carry no identity,
    so classification falls back to the weight heuristic.
  - `vendor-parse.ts` — pure CSV parser for the **vendor bulk export**
    schema. Different file because the schema, units (lbs), quoting
    rules (RFC 4180), and timestamp format all differ from the simple
    monthly format. Passes the row's `pet_id` through as `vendorPetId` and lets
    `classify.ts` resolve it, so the parser stays independent of the registry —
    that's what lets a cat edit re-classify in place instead of forcing a
    re-fetch and re-parse. Filters out `metadata_delete=true` rows.
  - `classify.ts` — assigns each reading to a cat. See "How a reading gets
    attributed" above for the resolution order.
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
  - `api.ts` — frontend client for `/api/csvs` and `/api/cats`. The only place
    the rest of the app talks HTTP.
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
  - `stats.ts` — per-cat summary numbers shown beside the charts. Takes the
    registry so every cat gets a card even with no readings in the window. Cats
    with an `endedAt` report `ended: true` and anchor their 30-day average to
    their final reading rather than `now`.
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

There are four CSV shapes in the wild — three consumer-app generations
(which differ only in their timestamp format, so one parser handles all
three) and one vendor bulk export. The loader sniffs each file's header and
routes to the right parser. Re-read a sample of each shape in `data/` before
changing parsing logic.

### Monthly consumer-app exports (`parse.ts`)

The CSV is messier than it looks. There are three export-tool generations
in the wild — all supported. Known quirks:

- Header row: `Activity,Timestamp,Value`.
- `Activity` may be values other than `Weight recorded` (e.g. usage
  events). The parser only emits weight rows, and matches the activity
  label case-insensitively (older exports capitalize `Weight Recorded`).
- `Timestamp` lacks a year. Three shapes are accepted:
  - Current export: `MM-DD at H:MM a.m./p.m.` — as the previous generation,
    but with a literal `at` between the date and the time. This one appeared
    in the 2026-08-02 drop and silently produced zero readings until
    `TIMESTAMP_RE` learned the optional `at`.
  - Previous export: `MM-DD H:MM a.m./p.m.` — dash-separated date,
    lowercase meridiem with periods, leading space before the meridiem.
  - Oldest export: `M/D H:MMAM/PM` — slash-separated date, uppercase
    meridiem with no periods and no separating space.
  In all cases the year is inferred from the export filename's date
  suffix; rows whose `MM-DD` is later than the export's `MM-DD` are assumed
  to be from the previous year (December rows in a January export, etc.).
- Don't feed the timestamp string straight to `Date.parse` — all shapes
  rely on the dedicated `TIMESTAMP_RE` in `parse.ts`.
- A timestamp the regex rejects is skipped *silently* (only unit mismatches
  warn). If a new export ever charts as empty, check `TIMESTAMP_RE` against
  a sample row first — that's been the failure mode twice now.
- `Value` is a unit-suffixed string like `"5.5 kg"`. The parser strips the
  unit and warns + skips on anything other than `kg`, since a unit mix-up
  would silently corrupt the chart.
- Filenames also come in two shapes (`YYYY-MM-DD` and `M-D-YYYY` — see the
  Repo layout note); `exportDateFromFilename` in `parse.ts` handles both.
  The two patterns are unambiguous because exactly one of the outer date
  components has four digits.
- Rows here have no per-row pet identity, so `classify.ts` falls back to the
  nearest-typical-weight heuristic for these.

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
- `pet_id` is passed through as `vendorPetId` and resolved in `classify.ts`
  against each cat's user-editable `vendorPetId` field. A row whose `pet_id`
  matches no cat still yields a reading — it just falls back to the weight
  heuristic, rather than being dropped as it used to be. Dropping it would
  silently discard real data whenever a cat has no vendor ID recorded, which is
  now the default for any cat added through the UI.
- Each row is also a hefty pile of denormalized pet metadata (breed,
  diet, food brand, personality, …). All ignored — only the four
  required columns participate in parsing. If the vendor schema ever
  drops or renames one of those four, the parser logs an error and emits
  zero rows for the file (rather than silently misinterpreting columns).

## Responsive design

The app is meant to be usable from a phone as well as a desktop browser, so
two things to keep in mind when adding UI:

- `src/style.css` declares responsive breakpoints in a single block at the
  bottom — 720 px (stack the controls bar), 480 px (smaller chart heights,
  full-width override popup, near-fullscreen manage-cats dialog), 360 px
  (single-column cat-card stats, wrapped roster rows). New components should fit
  into that ladder rather than introducing one-off `@media` blocks scattered
  through the file.
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
- Keep data transforms pure (`parse.ts`, `vendor-parse.ts`, `classify.ts`,
  `cats.ts`, `aggregate.ts`, `filter.ts`, `outliers.ts`, `stats.ts`): functions
  that take inputs and return arrays/records. No DOM, no fetch, no globals —
  easy to unit-test later. The DOM/Chart.js/HTTP stuff lives in `main.ts`,
  `chart.ts`, `visits-chart.ts`, `cats-ui.ts`, `upload.ts`, and `api.ts`.
- The cat registry is passed **as a parameter** to anything that needs it, never
  imported as a mutable module global. That's what keeps the transforms pure now
  that cats are editable at runtime.
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
  should be loaded and parsed in the browser; `/api/csvs` and `/api/cats` are
  the only server-side surfaces.
- Don't hardcode cat names, ids, colors, or counts anywhere outside
  `SEED_CATS`. `CatId` is a `string` and the list is user-editable and possibly
  empty.
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
  are the supported escape hatch; nearest-typical-weight should stay simple
  unless the data clearly demands more.
- Softening the delete confirmation, or making deletion do anything other than
  what it does now. The notice about `endedAt` is a deliberate product decision,
  not boilerplate.
- Wiring any non-Netlify backend (S3, Supabase, GitHub API to commit to
  `data/`, etc.) — it's a noticeable architectural shift that should be
  discussed first.
