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

## Re-importing without losing progress

The design points list isn't frozen — points get added, removed, or
renumbered between design and commissioning, and even during CX itself.
Re-importing an updated `.mdb` is **non-destructive**: `import_points()`
matches equipment by `tag` and points by `point_number` against what's
already in the project, rather than always inserting.

- A **matched** point (same point_number as before) gets its
  descriptor/panel/IP-OP/A-D updated from the new import, but the 7
  checklist fields, Notes, and Blocked By are **never touched** — progress
  survives.
- A **new** point (wasn't there before) is inserted as usual, blank
  checklist.
- A point **missing** from the new import (removed at the source) is marked
  `active = false`, not deleted — its progress is preserved in case the
  removal was a mistake, or the point was actually renumbered rather than
  truly removed. The grid hides inactive points by default; a "Show N
  removed points" toggle in the toolbar reveals them (shown dimmed, tagged
  "(removed)"), for manual review/cleanup.
- Equipment gets the same treatment — a whole zone renamed or removed goes
  inactive along with its points, rather than silently losing everything
  under it.

**Renumbering** (a point's number changed, not truly removed) looks
identical to "removed + unrelated new point added" from the matching logic
alone — there's no way to tell those apart automatically without risking a
wrong guess that silently loses progress. Instead, whenever a re-import
removes at least one point, a reconciliation screen (`web/src/components/
ImportReconciliation.tsx`) shows the just-removed and just-added points
side by side; clicking a removed one then its replacement calls
`pair_reimported_point()`, which transfers the checklist state onto the new
point_number and removes the now-redundant old row. Skippable — closing the
screen without pairing anything is exactly the "point was actually removed"
case, already handled correctly by default.

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

### Why three operations are Postgres functions, not plain inserts/updates

`import_points()`, `bulk_set_points()`, and `pair_reimported_point()` (all
in `supabase/schema.sql`) exist so an import, a checklist range-fill/paste,
or a renumber-pairing is all-or-nothing — a Postgres function runs inside
one transaction, so a failure partway through rolls back everything instead
of leaving an import half-applied.

*(Verified against a real local PostgreSQL 16 instance from this
environment — not a live Supabase project, since none was available here,
but the same Postgres engine Supabase runs on. Ran the full schema, then
exercised realistic scenarios directly: a first import, a re-import with a
point added/removed/renamed confirming matched points keep their checklist
state and removed points go inactive rather than deleted, a whole equipment
group disappearing, and a renumber pairing transferring progress and
removing the old row. All behaved exactly as designed. What's NOT verified:
the Supabase-specific pieces that only exist on their platform, not plain
Postgres — the RLS policies' actual behavior under the `anon` role (that
role doesn't exist on a local install, so the grants targeting it were
skipped in this testing) and the Supabase-generated REST API surface
`supabase-js` talks to. Try a real import against your own Supabase project
before relying on this for a live job.)*

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
- **Not tested against a live Supabase project** (see the RPC section
  above) — the schema and all three functions are verified against real
  PostgreSQL, but Supabase's own layer on top (RLS under the actual `anon`
  role, the generated REST API `supabase-js` calls) hasn't been exercised.
- **The reconciliation UI's pairing interaction is verified in isolation**
  (a standalone harness with mocked data, confirming the click-to-pair flow
  calls `pair_reimported_point()` with the right IDs and updates correctly),
  not as part of a full real import → reconciliation → confirm flow against
  a live project.
