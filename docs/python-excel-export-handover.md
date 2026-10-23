# Handover: standalone Python .mdb → Excel exporter

## What this is

A one-off Python script, run locally by the project owner, that takes a
controller export (`.mdb`/`.accdb`) and produces an Excel workbook laid out
like this app's own checksheet (Install + Commissioning grid) and Dashboard
(progress rollups) — **without touching Supabase at all**. Not a scheduled
job, not a web service: a script you run by hand when you want an Excel
snapshot straight from an .mdb file, independent of whether anything has
been imported into the live app yet.

### Explicit constraints (from the conversation that produced this doc)

- **No Supabase/Postgres connection of any kind.** Data comes only from the
  `.mdb` file the script is pointed at — same source the app's own
  "Import Points" feature reads, not the live database.
- **No schema changes.** This doc and the script it describes never touch
  `supabase/schema.sql`.
- One project's worth of points per run, picked by whatever identifier the
  `.mdb` file represents (there's no multi-project concept here the way the
  live app has one — a single .mdb is one project's controller export).
- Output format should visually/structurally match what a user of the live
  app already recognizes — same column order, same field weights, same
  equipment grouping — not a from-scratch redesign.

## Why this is a separate effort from the main app work

This repo's primary branch (`claude/practical-sagan-ncd334`, ff-merged to
`main`) is the live, deployed Commissioning Points web app — Vite+React+
TypeScript frontend, Supabase/Postgres backend, Vercel deployment. This
Python tool shares none of that runtime: it's a standalone script with no
dependency on the live app being up, the schema being current, or network
access to Supabase. Keeping it out of the same conversation/branch avoids
mixing an unrelated Python codebase into the TypeScript app's history.

## Source logic to port (read these directly — this doc is a map, not a spec)

All paths relative to the repo root.

### 1. `.mdb` parsing + point/equipment expansion — `web/src/mdbImport.ts`

The actual logic to replicate. Pure, already isolated from the file-reading
code (`buildEquipmentAndPoints()` takes plain row arrays, independent of the
`mdb-reader` npm package used to read the file) — read this function first,
it's the whole algorithm in ~60 lines:

- Three tables read case-insensitively: `"Points List T"` (direct CP-panel
  points), `"Zone T"` (zone/VAV instances), `"Zone type points list T"`
  (a point template per zone type, expanded against every zone instance of
  that type).
- Point numbering and zone naming come from **different** source columns —
  see the comment at the top of the file, it's easy to conflate them.
- The file-level comment names the legacy VBA this mirrors
  (`ImportAccessData.bas` / `VAVPoints.bas`) if the original Access tool's
  behavior is ever in question.

**Python gotcha**: there is no direct Python equivalent of the `mdb-reader`
npm package used here. Reading `.mdb`/`.accdb` from Python typically means
either `mdbtools`'s `mdb-export` CLI (Linux/Mac, shell out + parse CSV/read
via `pandas`) or `pyodbc` with the Microsoft Access Database Engine driver
(Windows-only). Pick based on what platform this actually runs on — confirm
with the user before building, don't assume.

### 2. Field definitions, order, and weights — `web/src/types.ts`

- `CHECK_FIELDS` (7 fields, Commissioning — equally weighted) and
  `CHECK_FIELD_LABELS`.
- `INSTALL_FIELDS` (10 fields, Install — **unequally** weighted via
  `INSTALL_FIELD_WEIGHTS`, which sums to 100) and `INSTALL_FIELD_LABELS`.
  The first 3 (Space Ready, Equipment Installed, Ducted / Piped) are
  prerequisite checks and must stay first in column order.
- `CheckState = "" | "check" | "x" | "na"` — the four states every
  checklist cell can hold. `IssueStatus`/`IssuePriority` types are also
  here if the issue log is ever in scope (it isn't for v1 per the
  conversation, but the types exist if asked later).

Treat this file as the source of truth for field order/weights — don't
trust a paraphrase of it from memory, re-read it, since both lists have
changed more than once this session already.

### 3. Progress/status calculations

- `web/src/progress.ts` — Commissioning completion % per point/equipment
  (`pointProgress`, `averageProgress`, `buildProgressByEquipment`):
  equally-weighted across the 7 `CHECK_FIELDS`, N/A excluded from the
  denominator, empty/unchecked counts as 0.
- `web/src/installProgress.ts` — Install completion %
  (`installProgress`, `averageInstallProgress`,
  `buildInstallProgressByEquipment`), same N/A-excluded shape but weighted
  per `INSTALL_FIELD_WEIGHTS` instead of equal weighting. Also has
  `installStatus()` (not_started/in_progress/complete bucketing) and
  `installFieldPercent()` (per-field % across a point set — this is what
  feeds the Dashboard's "Install Progress by Activity" tiles).
- Commissioning's own not_started/in_progress/commissioned bucketing is
  **server-side only** — `full_bucket()` in `supabase/schema.sql` (search
  for that function name). A freshly-.mdb-imported point has never been
  through this trigger, so for this tool's purposes every point starts
  `not_started` with all fields blank; the bucketing logic only matters if
  this tool is ever extended to read back already-filled-in checklist
  state from somewhere (out of scope today, since there's no Supabase
  connection).

### 4. The actual Excel layout/styling to match — `web/src/exportXlsx.ts`

This is the file to mirror most closely — it's the app's own existing
Commissioning/Install/Issues-to-Excel export (via `exceljs`, triggered from
Print Report in the UI), and already implements equipment-grouped rows,
the color palette (`COLOR` object near the top of the file), status pill
cell styling (`statusCellSpec`), checkmark/✗/N/A cell styling
(`checkCellSpec`), and column widths for exactly the two layouts this tool
needs to reproduce: `exportCommissioningXlsx` and `exportInstallXlsx`.
Porting this file's structure to `openpyxl`/`xlsxwriter` is the most direct
path to "matches the web app's own format."

## Suggested Python stack

- `openpyxl` or `xlsxwriter` for the `.xlsx` output (either is fine;
  `xlsxwriter` is generally faster for write-only workbooks, `openpyxl` has
  easier cell-by-cell styling if the output also needs to be re-opened and
  edited later — pick based on which matters more here).
- Whichever `.mdb` reading approach is confirmed for the target platform
  (see the gotcha under item 1 above).
- No Supabase client library needed at all — this is the one constraint
  that most distinguishes this tool from everything else built in the main
  app's repo this session.

## Suggested shape of the work

1. Confirm the target platform (affects `.mdb` reading approach) and
   whether `openpyxl` vs `xlsxwriter` matters for this user's follow-on
   needs (e.g., re-editing the output later).
2. Port `buildEquipmentAndPoints()` from `mdbImport.ts` to Python, against
   real sample `.mdb` output if available — the row-matching is
   case-insensitive and column-name-based, easy to get subtly wrong without
   a real file to test against.
3. Build the two sheets (Install, Commissioning) matching
   `exportXlsx.ts`'s layout/styling, using `CHECK_FIELDS`/`INSTALL_FIELDS`
   from `types.ts` as the column source of truth.
4. Build the Dashboard-equivalent sheet (equipment-level progress rollup —
   mirror `buildProgressByEquipment`/`buildInstallProgressByEquipment`'s
   math, not the live Dashboard UI's React rendering).
5. Verify against a real `.mdb` file end to end before calling it done.
