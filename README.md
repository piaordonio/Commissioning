# Commissioning Points

A point-level commissioning checklist tool, separate from the equipment-level
`apps` tracker for now while its data model is still settling. It replaces
the legacy "Engtool" Excel checksheet (a `.xlsm` with ~3,300 lines of VBA)
that BMS techs currently use to track individual point checkout.

## What it does

For every BMS point on a job — not just each piece of equipment — track the
**Commissioning** checklist: **Wired, Tagged, Calibrate, Function Test,
Sequence, Alarm, Graphics**, plus **Notes** and **Blocked By**, in a
click-to-cycle grid modeled on the `apps` tracker's `ChecklistView` (click a
cell to cycle ✓ / ✗ / N/A, shift-click to select a range, Ctrl/Cmd+C / V to
copy-paste across cells, or type `c` / `x` / `n` / `0` to bulk-fill a
selection). Alongside it is a separate **Install** checklist for the
installer's own paper checksheet — see "Two checklists, one grid" below.

Two more columns summarize the Commissioning checklist for you, both
maintained entirely by a Postgres trigger (`set_point_status_and_date()` in
`supabase/schema.sql`) — never written directly by the app, so they stay
correct no matter which code path touches a checklist field (a single
click, a bulk range-fill, a re-import match, a renumber pairing). This is
Commissioning-only — Install doesn't get its own Status/Date columns, just
the weighted percent described below:

- **Status** — a colored pill: **Not Started** (nothing checked yet),
  **In Progress** (at least one field checked), or **Commissioned** (every
  non-N/A field checked — an N/A field counts as satisfied, same as it
  already does in the progress-percent calculation, so an all-applicable-
  checked point reads Commissioned the same way it already reads 100%
  elsewhere in this app).
- **Date Commissioned** — auto-fills with today's date the moment a point's
  status becomes Commissioned, and auto-clears if it later drops back out
  (a field gets unchecked to correct a mistake, or a re-inspection fails
  something) — it always reflects current status, not a permanent
  first-achieved record.

Both are display-only in the grid and the printed report — no click-to-cycle,
no input.

Points are grouped under **equipment** (a CP panel's direct points, or a
zone/VAV instance), and equipment is grouped under a **project**, so the
same deployment can host several jobs — and since every user hits the same
Supabase database, multiple techs see the same job's live progress, not
separate copies of it.

A **Panel** filter, a **Status** filter (Not Started / In Progress /
Commissioned) and an **Install Status** filter (Not Started / In Progress
/ Complete — see "Two checklists, one grid" below for how the two differ),
and a single **search box** narrow down a long points list: the search box
matches a point type (`AI`/`AO`/`BI`/`BO` — since that token is already
embedded in the resolved point number) or any text in the descriptor,
whichever hits first.

## Two checklists, one grid: Install and Commissioning

Installers fill out their own paper checksheet — **Pipe/Flex, Pulled,
Mounted, Panel Term., Field Term., Tagged, End-to-End** — and that work
often overlaps in time with commissioning: you can be functionally testing
one point while an installer is still pulling wire on the point next to it.
Splitting that onto a separate page would lose exactly the thing that
makes tracking both worthwhile — seeing where install and commissioning
stand on the same panel at a glance — so both checklists live in the same
grid, as two independent column groups (each with its own "Install" /
"Commissioning" header bar and a heavier divider line between them), with
a **Columns** toggle in the toolbar to show or hide either group
independently. Hiding a group hides everything that belongs to it — its 7
checklist fields and its own Status/Notes (or Status/Date Commissioned, on
the Commissioning side) — while the shared columns (the point-level Notes,
Blocked By, Controller) always stay put. The weighted percent shown in the
equipment group header is the one exception: both groups' percentages show
there regardless of which columns are currently visible.

A few things worth knowing if you're touching this:

- **Install's "Tagged" is not Commissioning's "Tagged".** The installer
  self-attests their own tag under Install; Commissioning's Tagged is you
  independently verifying it. Two separate columns, same label, different
  point in the process.
- **End-to-End lives under Install, not Commissioning** — it moved there
  because it's what you're actually confirming during Function Test rather
  than a separate step worth its own Commissioning column. A point that
  was End-to-End-checked before this feature shipped keeps that mark: it
  was carried forward into the new Install row for that point during the
  migration (see `supabase/schema.sql`'s one-time backfill), not lost.
- **Install is weighted, Commissioning isn't.** Commissioning's 7 fields
  are equally weighted (see `pointProgress()` in `web/src/progress.ts`).
  Install's 7 are weighted 40/30/10/10/5/2/3 (Pipe/Flex heaviest, Tagged
  lightest — see `INSTALL_FIELD_WEIGHTS` in `web/src/types.ts` and
  `installProgress()` in `web/src/installProgress.ts`), matching how the
  paper checksheet already weights them. N/A is treated the same way in
  both: excluded from the denominator, so an all-applicable-checked point
  (or an all-N/A one) reads 100% either way.
- **Install gets its own Status column — but no Notes column and no Date
  Installed.** Status is Not Started (nothing checked) / In Progress
  (something checked) / Complete (every non-N/A field checked, same
  vacuous-complete rule as the all-N/A edge case elsewhere in this app) —
  the same plain bucketing Commissioning's Status uses, just unweighted
  (see `installStatus()` in `web/src/installProgress.ts`), and there's a
  matching **Install Status** filter in the toolbar next to Commissioning's
  **Status** filter. Unlike Commissioning's Status/Date Commissioned pair,
  Install Status isn't backed by a Postgres trigger or a stored column —
  it's computed on read from the same 7 fields `installProgress()` already
  uses, since there's no "date completed" requirement here driving a need
  to persist a transition moment. Notes is the one shared column between
  the two checklists — a point has one Notes field, not a Commissioning
  one and a separate Install one.
- **One point, one install_checks row, always.** Every point gets a blank
  `install_checks` row the moment it's created — see
  `create_install_check_for_point()` in `supabase/schema.sql`, a trigger
  rather than something every point-creation code path has to remember to
  do (an .mdb import, "Add as New Point" from a controller check, and any
  future path all get it for free). A re-import pairing
  (`pair_reimported_point()`) carries the Install row's values forward the
  same way it already does for Commissioning's.
- **The grid's selection engine treats Install and Commissioning as two
  independent regions.** Shift-click range-select, Ctrl/Cmd+C/V, and the
  c/x/n/0 keyboard fill all work on both groups the same way they always
  did on Commissioning — but a selection never spans both groups at once
  (shift-clicking into the other group starts a fresh selection there
  instead), since pasting Install data onto Commissioning cells wouldn't
  mean anything.

## An issue log per point, and a project Dashboard

Alongside the two checklists, each point can carry a structured, multi-entry
**issue log** — `description`, `recommended_action`, `notes`, an
`open`/`closed` status, the date it was created, and the date it was
closed (shown next to the status in the issue log itself) (see `issues` in
`supabase/schema.sql`, `web/src/issues.ts`,
`web/src/components/IssuesModal.tsx`). This is deliberately minimal, not
full parity with something like EnteliWEB's commissioning issue tracker —
no priority, assignee, part number, or per-issue comment trail — because a
single tech tracking their own punch list doesn't need a triage workflow
built for a multi-person team.

- **Additive, not a replacement for Blocked By.** `points.blocked_by` stays
  exactly as it was — a single free-text field. Issues are a different data
  shape (a point can accumulate several distinct problems over time, some
  resolved, some not) rather than something that fits in one text field, so
  it gets its own table instead of overloading `blocked_by` or migrating it.
- **Status is informational only.** A point's Commissioning `status` keeps
  being computed purely from the 7 checklist fields — `set_point_status_and_
  date()` never looks at `issues`. Letting an open issue gate "Commissioned"
  would make that word mean two different things depending on whether an
  issue happened to exist; commissioning completeness and "does this point
  have a known problem" are answers to two different questions.
- **A flag next to Blocked By does double duty.** An always-visible button
  sits beside the Blocked By field in the grid, the phone view, and the
  Dashboard's expanded point rows — neutral (⚑) when a point has no open
  issues, a red "!" with the open count (e.g. `! 2`) the moment it does,
  the same red as the rest of the app's danger/alert language. Clicking it
  in either state opens the same issue log (creating the first issue, or
  reviewing/adding to existing ones), so there's no separate "+" control
  just to log a point's first problem.
- **Closing and deleting are two different actions.** Close marks an issue
  resolved without erasing it — closed issues are kept, not deleted, so the
  history of what went wrong and got fixed on a point isn't lost. Delete
  (the 🗑 button next to Close/Reopen in the modal, with a confirm prompt)
  is for the other case: an issue that shouldn't be in the log at all — a
  mistake, a duplicate entry — and is an actual row removal, unlike
  everything else non-destructive in this app (points/equipment soft-delete
  via `active`; issues otherwise soft-state via `status`).
- **Equipment headers also show an open-issue count** (grid group headers,
  mobile equipment headers, and the Dashboard's equipment rows) whenever at
  least one of that equipment's points has an open issue — the same kind of
  at-a-glance summary the existing Install/Commissioning percent pills
  already provide. The icon is a solid red circle with "!" (`.issue-icon`
  in `styles.css`), not a Unicode warning-triangle character, so it renders
  identically everywhere instead of varying by platform/font.
- **Notes is entered once, at creation, and only ever surfaces in the
  printed Issues report** — not in the issue log's own list (the modal),
  not on the Dashboard. It's for handoff-document context (a vendor ticket
  number, a scheduled follow-up date) that doesn't need to be in view while
  a tech is actually working the point, so it stays out of the compact
  on-screen lists and only appears on the document meant to leave the
  building.
- **`closed_at` autofills the moment an issue is closed.** Same
  trigger-owned pattern as `points.date_commissioned` — `set_issue_closed_at()`
  in `supabase/schema.sql` sets it on the transition into `closed`, never
  overwrites it while an issue stays closed (so an unrelated edit doesn't
  reset it), and clears it back to null the moment the issue is reopened.
  The app never writes it directly; clicking Close/Reopen only ever sends
  `status`. The modal shows a client-side mirror of "closed just now" the
  instant you click Close, purely for immediate feedback — the value that
  actually persists always comes from the trigger.

The **Dashboard** (`web/src/views/ProjectDashboard.tsx`) is the app's
landing page — opening a project goes straight to the project-wide rollup,
not into one panel's checklist, since a status check is the more common
first thing a tech or supervisor wants. The header's **Dashboard** button
and each view's own path back (the grid/phone view's own navigation, or
the Dashboard's own **← Back to Points** button) move between it and the
working grid/phone view. It's a project-wide rollup, not a narrowed
working view — same architectural slot as the print report, a purpose-built
screen rather than a responsive reflow of the grid. It splits every piece of
equipment into **Not Commissioned** / **Commissioned** by an exact check
(every point's status is `commissioned` — not a rounded percentage, so a
99%-but-not-100% device doesn't misleadingly read as done), click-expands
each row inline to show its points, and lists every open issue project-wide
in an **Active Issues** panel for quick triage. It reuses `usePointRows()` —
the same equipment-grouping/filtering hook the grid and phone view already
share — with `showRemoved: false` and no filter UI, rather than reinventing
grouping a third time; this is meant as a live status overview, where a
removed/inactive point cluttering "which devices still need work" would be
actively misleading. A "Commissioning Activity" trend chart (points/issues
completed over time) was scoped out of this pass — noted here as a natural
follow-up, not built.

Within the Dashboard specifically, an issue's own text (its description and
recommended action, in the Active Issues panel) renders in red — the one
screen whose whole job is triage, so the issue content itself is styled to
stand out. This is scoped to the Dashboard (`.dashboard-view` in
`styles.css`) rather than the shared text classes themselves, since those
same classes render inside the Issues modal too, which keeps its normal
text color there.

### Staying fresh across a shared shift

There's no realtime sync between browser tabs — this is deliberately a
plain Supabase REST client, not a websocket subscription, so two techs on
different points never conflict at the field level (every write only ever
touches the specific fields it changed), but nothing pushes one tech's
saves into a tab another tech already has open. Left unaddressed, a tab
opened at 7am would keep showing 7am's Dashboard rollup and filter results
all day. Three small refetches close that gap without the complexity of a
realtime subscription (`web/src/App.tsx`):

- **On window focus / tab visibility regained** — covers a tech switching
  to another app and back, or a tablet waking from sleep. Debounced to
  skip refetching if the last refresh was under 5 seconds ago, so rapid
  focus/visibility events (common when a browser fires both in quick
  succession) don't double up.
- **On a 5-minute background poll**, only while the tab is actually
  visible — catches a tab that's simply left open on a mounted tablet and
  never backgrounded at all, where focus/visibility events never fire.
- **Whenever the Dashboard opens** — its entire purpose is showing current
  project state, so it gets a guaranteed fresh fetch on open rather than
  relying on the background refresh above having happened to run recently.

This is a staleness fix, not a conflict-resolution system — it doesn't
merge concurrent edits or warn "someone else is editing this," it just
makes sure an open tab doesn't drift far from reality. That's sufficient
because techs work different points by convention, not because the app
enforces or needs to enforce it.

## A separate phone view for the field

Opening this on a phone (viewport width ≤ 480px, checked live via
`useIsNarrowViewport` — a tablet in portrait stays well above that and keeps
the grid, only true phone widths switch) swaps the grid for
`PointsCardList.tsx`: one point per card, fields stacked vertically instead
of side-by-side, tap a field to cycle it the same ✓ / ✗ / N/A / blank order
as the grid. No shift-select, no Ctrl/Cmd+C/V, no keyboard bulk-fill — the
field workflow this was built for is single point at a time (walk up to a
point, tap through its checks, move on), not a range operation, so there's
nothing to invent a touch equivalent for. Cards still group under an
equipment header with both weighted % pills, and the same Panel/Status/
Install Status/search filters are there too, just stacked full-width instead
of one toolbar row. The same **Columns** toggle the grid has (show/hide
Install or Commissioning independently) is here too — hiding a group hides
its field list and its per-point status pill together, same as the grid,
while the equipment header's weighted % pills for both groups keep showing
regardless. A tablet in portrait doesn't need this feature repeated here —
it's already on the grid, which already has its own Columns toggle.

The whole filter toolbar (Columns toggle plus the four filter controls)
starts collapsed behind a "Filters ▾" bar, same collapse pattern as the
header's Actions and each point card below — narrowing the list down to a
point isn't something you need mid-checklist, only when hunting for the
next one. The bar shows the active filter count while collapsed (e.g.
"Filters (2) ▾") so it's clear something's been narrowed even with the
toolbar out of sight, and switches to "Hide Filters ▲" once expanded.

Each card is itself collapsed by default, down to exactly point number
(header), point name/descriptor, and its status flags (Install and
Commissioning status pills) — everything else (Date Commissioned, Not on
Controller / Added from Controller, the checklist fields, Notes/Blocked By)
only mounts once you tap the card. On a job with a long points list this
keeps the scroll scannable (find the point you're at by name and status,
without a full checklist's worth of rows for every other point in between);
each card expands and collapses independently, not an accordion, so more
than one can be open if you're working two points at once. Same pattern as
the header's Actions toggle, just per-card instead of global.

The header's action buttons (Delete Project, Check Against Controller,
Print Report, Import Access Database) are desk-oriented, not field
workflow, so at the same narrow width they start collapsed behind a single
"Actions ▾" bar instead of eating vertical space above the checklist —
tap it to reveal the full row, "Hide Actions ▲" to collapse it again. Purely
a phone-width behavior (`isNarrowViewport` gates both the toggle button and
the default collapsed state); the desktop header is unchanged.

It's a second view over the same data, not a responsive reflow of the
grid's `<table>` — that table's `colSpan` tricks, sticky columns, and
row/column-indexed selection state don't translate to a phone width via CSS
alone, so this follows the same pattern `PointsReport.tsx` already
established (a purpose-built view instead of overloading one component with
a second job). The filtering/sorting/equipment-grouping logic
(`usePointRows()` in `web/src/usePointRows.ts`) and the ✓/✗/N/A cycling
order (`web/src/checklistCycle.ts`) are shared between the two views rather
than duplicated, so both always show the same rows in the same order and
cycle fields identically.

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
- **Points with no point number at all** (a hardwired/interlocked device
  with no discrete I/O address, e.g. an aquastat wired straight to a
  valve — legitimate in the source `.mdb`, not a parsing gap) match by
  `descriptor` instead, since a blank `point_number` isn't a safe key on
  its own: two such points under the same equipment used to collide,
  silently overwriting one with the other's descriptor and coming up one
  point short with no error. Confirmed against a real bug report — a job
  with two hardwired aquastats (`..._IFP1_AQSTAT` and `..._IFP2_AQSTAT`)
  under the same panel, both blank point numbers, where only one survived
  import.

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

## Checking design points against the controller

The design list is what was *planned*; it's not necessarily what actually
got programmed into the Delta controller during CX. **Check Against
Controller** imports the "Points List" CSV exported from EnteliWEB
(`Device, Object ID, Name, Sensor Type, Calibration, Flags`) and cross-
checks it against the design points already tracked for the project —
nothing is uploaded, the file is read and compared entirely in the
browser.

The match key is the point number in its resolved form (see below):
EnteliWEB's `Object ID` (e.g. `20300.AI83`) already uses the same
`AI`/`BI`/`AO`/`BO` form the grid displays. Every active point in the
project is checked:

- **Found on the controller**: no visible change — checked and confirmed.
- **Not found on the controller**: a red "Not on Controller" pill appears
  next to its point number in the grid. This is re-evaluated fresh on
  every check, so a point that shows up on a later controller export
  clears automatically — nothing is stuck permanently flagged.
- **A controller object with no matching design point** (and, on the
  other side, a design point not found on the controller) usually means
  one of two things: the point was renumbered on-site, or it was genuinely
  missed in the original design and only showed up once it got wired and
  programmed — common on jobs where a lot of time passes between design
  and commissioning. A reconciliation screen shows both lists side by
  side:
  - Click one on each side to **pair** them, which corrects the design
    point's number to match what's really on the controller — its
    checklist progress is untouched. Use this for a renumber.
  - Click **Add as New Point** on a controller object to insert it as a
    real design point instead — same equipment tag (creating the
    equipment if this is its first point), blank checklist, confirmed on
    the controller from the start. Use this when the point wasn't
    designed at all, not just renumbered. It gets a green "Added from
    Controller" pill next to its point number in the grid — permanent
    provenance, not re-evaluated by later checks the way the red pill is,
    so it stays even if a future check can't find that point (it can
    appear alongside the red pill if that happens).
  Both are skippable — closing without acting on an entry just leaves it
  flagged for next time, same as the re-import reconciliation above.

## Displaying the point number: folding IP/OP and Analog/Digital together

Direct CP-panel points carry a raw `IP`/`OP` token in their point number
plus a separate Analog/Digital field, from the source Access data.
`resolvedPointNumber()` (`web/src/pointNumber.ts`) folds the two into the
token techs and the controller both actually use — `IP` + Analog -> `AI`,
`IP` + Digital -> `BI`, `OP` + Analog -> `AO`, `OP` + Digital -> `BO` —
display-only: the underlying `point_number`/`analog_digital` columns are
never rewritten, since re-import and the controller check both match
points by their stored `point_number`, and changing what that value *is*
would break that matching for every point already imported. Zone-expanded
points have no Analog/Digital value and pass through unchanged.

## Printing a handoff report

**Print Report** swaps the interactive grid for `PointsReport.tsx` — a
clean, read-only view built to print or save as a PDF, not the working
grid with a stylesheet grafted on: no Controller or delete columns, and
Notes/Blocked By render as plain text instead of inputs. Always shows
active points only, regardless of the grid's "show removed" toggle.

Header carries an Ainsworth letterhead (`web/public/ainsworth-logo.jpg`),
the generation date, points/percent complete, and a "Commissioned By"
dropdown you pick from right before printing. Names typed in via "+ Add
name…" are remembered in that browser's `localStorage` (not saved to the
project — it's who ran *this* check, a per-machine convenience, not
project data shared across techs). A "Hide Date Commissioned column"
checkbox in the toolbar drops that column from the printed table when a
handoff doesn't need it — neither control prints itself (`no-print`).

A **Status** filter (three checkboxes: Not Started / In Progress /
Commissioned, all checked by default) controls which rows print — the
main use case is a manager handoff of what's still open: uncheck
Commissioned and the report becomes a punch list of exactly what's
remaining. Filtering only removes rows; each equipment group's progress
pill still reflects that panel's true completion across all its active
points (not just the ones currently shown), and a panel that's fully
filtered out (e.g. 100% Commissioned while only Not Started/In Progress
are checked) drops out of the report entirely instead of printing an
empty group header.

Each equipment group's progress pill reads its color off the same
percentage the grid shows: green above 90%, red below 10%, the default
indigo in between — a quick visual scan across a long panel list.

Two print-specific fixes worth knowing about if you touch this file:
browsers don't print background colors by default, so the blue equipment
group-header rows need an explicit `print-color-adjust: exact` or they
render as blank white bars; and the page margin is set via `@page` in
`styles.css`, not container padding, since print mode strips that padding
anyway. The table also gets its own `.report-table-wrap` override
(`overflow: visible; flex-shrink: 0;`) rather than the grid's scrolling
`.table-wrap` — the report is one long printable document, not a fixed-
height scroll panel, and without this override the flex column would
shrink it and pop up a second, nested scrollbar next to the page's real
one.

A **Checklist / Issues** toggle in the toolbar switches the whole report
between the per-field grid above and a second, differently-shaped report
over the same project data: a punch list of every active point that has an
issue logged against it (description, recommended action, status, and the
date it was created), grouped by equipment the same way. It defaults to
open issues only — the report you'd actually hand to a subcontractor —
with an "Include closed issues" checkbox to pull resolved ones back in for
a closeout record. This is a mode on the existing report rather than a
second print flow, since both need the same project data and print CSS and
neither needed its own screen. Each row has a screen-only "✎" button
(`no-print`, so it never shows up on an actual printout) opening that
point's issue log in the same modal the grid and Dashboard use — a punch
list is often the moment you notice something needs a status update or a
follow-up note, so fixing it shouldn't mean leaving the report to hunt the
point down in the grid.

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

### Why five operations are Postgres functions, not plain inserts/updates

`import_points()`, `bulk_set_points()`, `bulk_set_install_checks()`,
`pair_reimported_point()`, and `set_controller_status()` (all in
`supabase/schema.sql`) exist so an import, a checklist range-fill/paste, a
renumber-pairing, or a controller check is all-or-nothing — a Postgres
function runs inside one transaction, so a failure partway through rolls
back everything instead of leaving an import half-applied.

*(Verified against a real local PostgreSQL 16 instance from this
environment — not a live Supabase project, since none was available here,
but the same Postgres engine Supabase runs on. Ran the full schema, then
exercised realistic scenarios directly: a first import, a re-import with a
point added/removed/renamed confirming matched points keep their checklist
state and removed points go inactive rather than deleted, a whole equipment
group disappearing, a renumber pairing transferring progress and removing
the old row, and — using the real Hell's Kitchen `.mdb` import and its real
EnteliWEB controller export — a controller check flagging the right points
matched/unmatched and a controller-reconciliation pairing correcting a
point's number while leaving its checklist progress untouched. For the
Install checklist specifically: confirmed every new point gets an
`install_checks` row automatically (`create_install_check_for_point()`),
that a pre-existing point's already-checked `points.end_to_end` carries
forward into its new Install row on the one-time backfill, that
`pair_reimported_point()` transfers an old point's Install values onto the
new point's row (not just its Commissioning ones) and the old row's
`install_checks` row cascades away with it, and that the Commissioning
status trigger's 7-field formula (post-End-to-End-removal) walks correctly
through Not Started → In Progress → Commissioned → back to In Progress on
an uncheck → Commissioned again on re-check → the all-N/A edge case. All
behaved exactly as designed. What's NOT verified: the Supabase-specific
pieces that only exist on their platform, not plain Postgres — the RLS
policies' actual behavior under the `anon` role (that role doesn't exist
on a local install, so the grants targeting it were skipped in this
testing) and the Supabase-generated REST API surface `supabase-js` talks
to. Try a real import against your own Supabase project before relying on
this for a live job.)*

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
- **The IP/OP -> AI/BI/AO/BO fold is a string-replace heuristic.** It's
  verified against a real Hell's Kitchen `.mdb` import and its real
  EnteliWEB controller export side by side (see `web/src/pointNumber.ts`),
  but it assumes a design point's raw `point_number` literally contains
  `IP` or `OP` as a substring. If a site's naming convention doesn't, the
  controller check will silently show every point as unmatched — a
  near-zero match count on a real project is a sign to check that, not
  proof the points are actually missing.
- **The controller CSV parser** (`web/src/controllerImport.ts`) is tested
  against the one real EnteliWEB export inspected while building this
  feature, plus a hand-mutated fixture exercising a renumbered point. It
  expects plain CSV with an "Object ID" header cell; a differently-shaped
  export (extra columns, a re-saved `.xls`/`.xlsx` copy with banner rows)
  hasn't been tried.
- **Not tested against a live Supabase project** (see the RPC section
  above) — the schema and all three functions are verified against real
  PostgreSQL, but Supabase's own layer on top (RLS under the actual `anon`
  role, the generated REST API `supabase-js` calls) hasn't been exercised.
- **The reconciliation UI's pairing interaction is verified in isolation**
  (a standalone harness with mocked data, confirming the click-to-pair flow
  calls `pair_reimported_point()` with the right IDs and updates correctly),
  not as part of a full real import → reconciliation → confirm flow against
  a live project.
