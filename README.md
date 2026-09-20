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
same deployment can host several jobs — and since every user hits the same
Supabase database, multiple techs see the same job's live progress, not
separate copies of it.

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

The file itself is parsed entirely client-side — nothing is uploaded except
the resulting point list, which goes straight to Supabase via
`import_points()` (see below).

## Stack

Vite + React + TypeScript, talking directly to [Supabase](https://supabase.com)
(Postgres + auto-generated REST API) via `@supabase/supabase-js` — no
custom backend server. Deployed on [Vercel](https://vercel.com), which
builds and redeploys on every push to the default branch.

```
npm install
npm run dev     # local dev server on :5174, talking to your Supabase project
npm run build   # production build, output in web/dist
```

### One-time setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is plenty for this).
2. **Run the schema**: Dashboard → SQL Editor → New query → paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql) → Run. Creates the three tables
   (`projects`, `equipment`, `points`), the two RPC functions used for
   atomic bulk operations, and RLS policies (see below).
3. **Get your API credentials**: Dashboard → Settings → API → copy the
   **Project URL** and the **anon public** key.
4. **Local dev**: `cp web/.env.example web/.env.local` and fill in those two
   values.
5. **Deploy to Vercel**: connect this GitHub repo in the Vercel dashboard
   (Root Directory: `web`), and add the same two values under Project
   Settings → Environment Variables as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Every push to the default branch redeploys
   automatically — no build step runs on your machine, so the corporate-
   network TLS/cert issues that came up building the (now-removed) desktop
   version don't apply here.

### Why RLS is wide open right now

`supabase/schema.sql` enables Row Level Security on all three tables but
with permissive "anyone can do anything" policies, not locked-down ones —
there's no user-account system in this app yet, and the anon key ships in
the client bundle regardless (it's public by design in Supabase's model).
If this tool grows real user accounts, tightening these policies (e.g.
scoping by project membership) is the first thing to do before that matters.

### Why two operations are Postgres functions, not plain inserts

`import_points()` and `bulk_set_points()` (both in `supabase/schema.sql`)
exist so an Access import or a checklist range-fill/paste is all-or-nothing
— a Postgres function runs inside one transaction, so a failure partway
through rolls back everything instead of leaving half the points imported
or half a paste applied.

*(These two RPCs, and the schema generally, are logic-reviewed but not
exercised against a real Supabase project from this environment — no
Supabase project was available here to test against. Run `supabase/schema.sql`
against a real project and try an import before relying on it for a real job.)*

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
- **The two Supabase RPC functions are untested against a live database**
  (see above) — the build compiles and the client-side error handling was
  verified against a simulated network failure, but the actual
  import/bulk-update SQL has not run against a real Postgres instance.
