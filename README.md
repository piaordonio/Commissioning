# Commissioning Points

A point-level commissioning checklist tool, separate from the equipment-level
`apps` tracker for now while its data model is still settling. It replaces
the legacy "Engtool" Excel checksheet (a `.xlsm` with ~3,300 lines of VBA)
that BMS techs currently use to track individual point checkout.

## What it does

For every BMS point on a job — not just each piece of equipment — track the
same 7 fields the legacy checksheet uses: **Wired, Tagged, End-to-End,
Calibrate, Sequence, Alarm, Graphics**, plus **Notes** and **Blocked By**,
in a click-to-cycle grid modeled on the `apps` tracker's `ChecklistView`
(click a cell to cycle ✓ / ✗ / N/A, shift-click to select a range, Ctrl/Cmd+C
/ V to copy-paste across cells, or type `c` / `x` / `n` / `0` to bulk-fill a
selection).

Points are grouped under **equipment** (a CP panel's direct points, or a
zone/VAV instance), and equipment is grouped under a **project**, so the
same install can host several jobs.

## Importing points from the Engtool Access database

Rather than exporting to CSV and re-importing, this reads the `.mdb`/`.accdb`
file directly in the browser (via [`mdb-reader`](https://www.npmjs.com/package/mdb-reader))
and replicates the legacy VBA's own import logic (`ImportAccessData.bas` +
`VAVPoints.bas`) client-side:

- **`Points List T`** — direct controller points (CP Panel, Point Number,
  Descriptor, Analog/Digital) — one equipment group per CP Panel.
- **`Zone T`** — zone/VAV instances (CP Panel, Ref#, Type id, Location) — one
  equipment group per zone, keyed by its Ref# (e.g. `VAV-101`).
- **`Zone type points list T`** — a point template per zone Type id (IP/OP,
  point number, Descriptor), expanded against every zone instance of that
  type — the same expansion `VavPointNumb` does in the original tool.

The expansion builds each generated point's **number** from the zone's CP
Panel + the template's IP/OP + point number (e.g. `20300.1.AI200`), while the
**descriptor** comes from the zone's Ref# + the template's descriptor (e.g.
`VAV-101_RoomTemp`) — those two come from different source columns in the
original VBA, so don't assume the point number embeds the zone tag.

Nothing is uploaded anywhere for the import itself — the file is parsed
entirely client-side; only the resulting point list is sent to this app's
own server.

## Why a separate database (for now)

This intentionally does **not** share a database with the `apps` tracker
while the schema is still being designed — per-point checklists run to
thousands of rows per project, a different shape than the tracker's
per-equipment/per-phase checklist. If/when this becomes the source of truth
for commissioning progress on the tracker's equipment rows, the two will
need an explicit sync (a scheduled export/import, or a webhook), since they
don't share a Postgres/SQLite instance — there's no free SQL view across
them the way there would be if they lived in one database from the start.

## Stack

Same shape as `apps`: an npm-workspaces monorepo, Express + `better-sqlite3`
server, Vite + React + TypeScript frontend, no external services.

```
npm install
npm run dev     # server on :4001, web on :5174 (proxies /api to the server)
npm run build    # builds the web app for production
npm start        # runs the built server
```

## Known gaps

- **Import path is logic-tested, not tested against a real `.mdb`.** The
  point/equipment-expansion logic (`buildEquipmentAndPoints` in
  `web/src/mdbImport.ts`) is verified against the VBA source and fixture
  data. The `mdb-reader`-based file parsing itself has not been exercised
  against an actual Access database, since none was available in this
  environment — only the `.xlsm` output of a prior import, not a source
  `.mdb`. Test it against a real Engtool database before relying on it.
- **Case-sensitivity in Access table/column names.** `mdb-reader` matches
  table and column names exactly; this app looks them up case-insensitively
  to tolerate real-world naming that may not match the VBA's literal SQL
  text, but hasn't been checked against an actual file that differs in case.
- Analog/Digital isn't populated for zone-expanded points (the "Zone type
  points list T" table doesn't carry that column) — only direct CP-panel
  points have it.
