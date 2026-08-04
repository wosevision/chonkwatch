# chonkwatch

A simple data visualization of cat weight over time, sourced from CSV exports of
a "smart" litter box's proprietary app. Designed to run locally with
`npm run dev` or be deployed straight to Netlify.

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
- **Cat management** — add, edit, and (rarely) delete the cats being tracked,
  from the "Manage cats" dialog. Each cat has a name, color, typical weight,
  optional first/last tracked dates, birthday, vendor pet ID, and notes. The
  registry is persisted server-side, so a phone and a desktop see the same cats.
- **Per-cat hide toggles** on each cat card.
- **Visits-per-day bar chart** under the main chart for activity context.
- **Auto dark mode** following the OS `prefers-color-scheme`.
- **CSV upload** via button or page-wide drag-and-drop, persisted
  server-side and deduped against bundled data.
- **Invite-only access** in production via Netlify Identity — a sign-in gate in
  front of the UI, and a session check on both API endpoints.

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
     named `chonkwatch-csvs`. The function container's filesystem is
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
- Multiple cats share the box, and the CSV doesn't say who a reading belongs
  to. Each reading is attributed to whichever cat's **typical weight** is
  closest, considering only cats tracked on that date (see `src/classify.ts`).
  The vendor bulk export is the exception — its rows carry a `pet_id`, which is
  matched exactly against a cat's vendor pet ID. When a specific reading still
  lands on the wrong cat, click it in raw view to fix it; that override is saved
  to `localStorage` and re-applied on every load.

## Managing cats

Use **Manage cats** above the cat cards. On first run the registry is seeded
with the two cats the app was built around and saved to the backend.

Two fields do more than they look like they do:

- **First tracked / Last tracked** bound the dates a cat is considered for
  weight-based attribution. Setting *Last tracked* is how you record a cat that
  has passed away or stopped using the box — their history stays in the charts
  and only later readings are excluded. New cats default to "first tracked =
  today" so that adding one doesn't retroactively claim an existing cat's
  readings.
- **Typical weight** is the whole basis of attribution. It doesn't need to be
  exact, just closer to this cat than to any other. Two cats with nearly the
  same typical weight over overlapping dates can't be told apart, and the form
  will say so.

**Deleting a cat is only for fixing mistakes** — a typo or a cat added by
accident. It permanently removes the readings currently attributed to them and
can't be undone from the app. If a cat has passed away, set *Last tracked*
instead.

Where the registry lives:

- In dev: `data/cats.json`, written by the Vite dev API. Safe to commit.
- In production: a Netlify Blobs store named `chonkwatch-cats`.

## Access control

The deployed site is invite-only, using
[Netlify Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/).
There's no signup form: accounts are created by inviting an email address from
**Project configuration → Identity → Invite users** in the Netlify dashboard.
The invitee gets an email, follows the link back to the site, picks a password,
and is signed in.

Two layers, and the second is the one that matters:

1. The **sign-in gate** (`src/auth-ui.ts`) covers the page until there's a
   session. This is convenience — it's browser code, so it can be bypassed by
   anyone who cares to.
2. The **API guard** (`netlify/shared/require-user.ts`) makes `/api/csvs` and
   `/api/cats` return 401 without a valid session. Since every reading reaches
   the browser through `/api/csvs`, this is what actually keeps the data
   private. It validates the caller's token server-side and fails closed.

If a session expires while the page is open, the next API call gets a 401 and
the gate comes back up with a note.

**Local dev is deliberately unauthenticated.** `npm run dev` is plain Vite with
no Identity service behind it, so the gate switches itself off and the dev API
stays open on localhost. To exercise the real flow locally, run `netlify dev`
with `VITE_FORCE_AUTH=true`. Note that `npm run preview` serves a production
build, so it shows the gate but can't get past it without a Netlify runtime.

One thing to watch: files matching `data/poobox_activity_*.csv` are inlined into
the JS bundle at build time, and **static assets are served without
authentication** — no client-side login can protect them. That's fine today,
because the only file in `data/` is the dashed vendor export, which is
deliberately excluded from the bundle and loaded through `/api/csvs` instead. If
you add monthly CSVs back into `data/` and want them private too, drop the glob
in `src/data-loader.ts` and let everything load through the API.

## Deploying to Netlify

The repo includes a `netlify.toml` and two serverless functions under
`netlify/functions/` (`/api/csvs` and `/api/cats`). To deploy:

1. Push the repo to GitHub (or wherever).
2. In Netlify, "Import from Git" and pick the repo. The default settings
   (build command `npm run build`, publish directory `dist`) match
   `netlify.toml`.
3. Netlify Blobs is enabled per-site automatically — no extra configuration
   needed.
4. Enable **Identity** in the project configuration, set registration to
   **Invite only**, and invite yourself. Identity needs HTTPS, which Netlify
   provisions automatically for both `*.netlify.app` and custom domains.

To test the production-shaped backend locally, install the Netlify CLI and
run:

```bash
netlify dev
```

That serves the Netlify Function and Blobs emulator alongside Vite. Plain
`npm run dev` is faster and uses the local-filesystem dev API instead.

## Scripts

- `npm run dev` — Vite dev server + filesystem-backed `/api/csvs` and
  `/api/cats`.
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
  persistence backend for both the CSVs and the cat registry.
- [`@netlify/identity`](https://www.npmjs.com/package/@netlify/identity) —
  invite-only auth, used both in the browser for the sign-in gate and inside
  the functions to verify the session. (This is the headless library Netlify
  recommends for new projects, not the older `netlify-identity-widget`.)

See [`AGENTS.md`](./AGENTS.md) for a tour of the source layout, the
dev/prod architecture split, and the small pile of CSV-format gotchas.
