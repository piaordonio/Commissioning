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

Same shape as `apps` (npm-workspaces monorepo, Express + SQLite server,
Vite + React + TypeScript frontend, no external services), but on
`node:sqlite` (built into Node 22.5+) instead of `better-sqlite3` — that
avoids a native-compilation step (`node-gyp`) that fails behind corporate
TLS-intercepting proxies. Requires Node 22.5+; the "SQLite is an
experimental feature" warning on startup is expected and harmless.

```
npm install
npm run dev     # server on :4001, web on :5174 (proxies /api to the server)
npm run build    # builds the server and the web app for production
npm start        # runs the built server (serves the built web app too)
```

## Desktop app (Windows .exe)

`desktop/` wraps the same server + web UI in Electron, so it runs as a real
double-clickable Windows app — its own window and icon, no browser tab, no
terminal, no npm once it's built. It starts the Express server in-process on
a fixed local port (`4317`), waits for it to come up, then opens a window
pointed at it. The SQLite file lives under the OS's per-user app-data folder
(`%APPDATA%\Commissioning Points\data\` on Windows), not next to the
installed program, since Program Files isn't writable.

**Build the installer on a Windows machine** — this has to run on Windows
itself; electron-builder's NSIS installer step needs Wine to cross-build from
Linux/Mac and won't complete without it:

```
npm run dist:desktop
```

That builds the server and web app, installs `desktop`'s own dependencies
(it's deliberately *not* an npm workspace member — Electron and its bundled
Chromium/Node runtime shouldn't be part of the same dependency graph as the
plain web app), and runs `electron-builder` to produce both a `Setup *.exe`
installer and a portable `.exe` in `desktop/release/`. Both are large
(~150–250MB) since they bundle Chromium + Node — that's inherent to Electron,
not a config issue.

If `npm install` inside `desktop/` hits the same
`unable to get local issuer certificate` error the main install did,
apply the same `NODE_EXTRA_CA_CERTS` fix — Electron's own install step
downloads a large binary over HTTPS and hits the same corporate-proxy
TLS interception.

*(Verified in this dev environment: `electron-builder --win --dir` — the
unpacked win32 build, without the NSIS wrapper — completes correctly and
produces a working `Commissioning Points.exe` with the right internal
layout. That exact same code was launched and exercised end-to-end on the
Linux equivalent build: server starts, the real UI is served, a project
round-trips through the API, and the database file lands in the OS's
user-data folder as expected. What's *not* verified from this environment
is the Windows binary itself actually running on Windows, or the final NSIS
installer — both require Wine or a real Windows machine to test to
completion.)*

### Auto-update

The app checks GitHub Releases on this repo on every launch (and via
Help → Check for Updates…), downloads a newer version in the background if
one exists, and installs it on restart (or automatically the next time the
app is closed, if you never click "Restart Now"). This only works against a
**public** repo — checking a private repo's releases needs a token, and
that token would have to be embedded in every installed copy of the app for
it to check on its own, which isn't something to ship. **Make the repo
public under Settings → Danger Zone → Change visibility before cutting the
first release** — nothing else in this setup does that for you, and until
then, update checks will just fail quietly (logged, not shown to the user)
with no releases to find anyway.

To cut a release once the repo is public:

```
export GH_TOKEN=<a GitHub token with contents:write on this repo>
npm run build
npm install --prefix desktop
npm run release --prefix desktop
```

That builds a new version, uploads the installer + portable `.exe` + update
metadata to a new GitHub Release matching the version in `desktop/package.json`
(bump it first), and every already-installed copy of the app picks it up on
its next launch. `GH_TOKEN` is only needed on the machine cutting the
release — it's never bundled into the shipped app.

*(Verified in this environment: the packaged app doesn't crash when the
update check has nothing to find — launched under Xvfb with the publish
config pointed at the not-yet-public repo, the server and UI kept working
normally and the failed check was only logged, never surfaced to the user.
What's not verified: an actual successful check-download-install cycle
against a real published release, since that requires the repo to be
public and a release to exist — neither is true yet.)*

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
