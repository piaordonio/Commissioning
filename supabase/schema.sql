-- Commissioning Points schema for Supabase (Postgres).
-- Run this once in the Supabase project's SQL Editor (Dashboard > SQL Editor > New query)
-- before pointing the app at that project. Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ---- Tables ----

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  project_number text not null default '',
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  tag text not null,
  equipment_type text not null default '',
  location text not null default '',
  notes text not null default '',
  blocked_by text not null default '',
  -- false = not present in the most recent import for this project (removed
  -- or renamed at the source) — never hard-deleted by re-import, so any
  -- checklist progress recorded on its points survives. See import_points().
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists points (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  panel text not null default '',
  ip_op text not null default '',
  analog_digital text not null default '',
  point_number text not null,
  descriptor text not null default '',
  wired text not null default '' check (wired in ('', 'check', 'x', 'na')),
  tagged text not null default '' check (tagged in ('', 'check', 'x', 'na')),
  end_to_end text not null default '' check (end_to_end in ('', 'check', 'x', 'na')),
  calibrate text not null default '' check (calibrate in ('', 'check', 'x', 'na')),
  function_test text not null default '' check (function_test in ('', 'check', 'x', 'na')),
  sequence text not null default '' check (sequence in ('', 'check', 'x', 'na')),
  alarm text not null default '' check (alarm in ('', 'check', 'x', 'na')),
  graphics text not null default '' check (graphics in ('', 'check', 'x', 'na')),
  notes text not null default '',
  blocked_by text not null default '',
  -- Same meaning as equipment.active: a point missing from the latest
  -- import goes inactive, not deleted, so re-importing an edited points
  -- list can't silently erase commissioning progress.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent for anyone who already ran an earlier version of this file
-- against a real project before the active column existed.
alter table equipment add column if not exists active boolean not null default true;
alter table points add column if not exists active boolean not null default true;

-- null = never checked against a controller export yet, distinct from
-- "checked and missing" (false). See set_controller_status() below.
alter table points add column if not exists on_controller boolean;

-- true only for a point created via "Add as New Point" (see
-- addControllerObjectAsPoint in web/src/api.ts) -- a point found on the
-- controller with nothing matching it in the design. Provenance, not a
-- live check result: unlike on_controller, this is set once at insert and
-- never recomputed by set_controller_status() or a later re-import.
alter table points add column if not exists added_from_controller boolean not null default false;

-- Idempotent for anyone who already ran an earlier version of this file
-- before the Function Test checklist field existed.
alter table points add column if not exists function_test text not null default '' check (function_test in ('', 'check', 'x', 'na'));

-- status/date_commissioned are maintained entirely by
-- set_point_status_and_date() below, never written directly by the app.
alter table points add column if not exists status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'commissioned'));
alter table points add column if not exists date_commissioned date;

-- Install-phase checklist, tracked separately from the 7-field commissioning
-- checklist above: installers work these 7 fields (often concurrently with
-- someone else commissioning a neighboring point), they're weighted rather
-- than equally-weighted (see INSTALL_FIELD_WEIGHTS in web/src/types.ts), and
-- End-to-End used to live on points -- it moved here since the commissioning
-- side verifies it during Function Test rather than tracking it separately.
-- One row per point (point_id unique), auto-created by
-- create_install_check_for_point() below so every code path that inserts a
-- point gets one for free, the same "regardless of which code path" pattern
-- set_point_status_and_date() already relies on.
create table if not exists install_checks (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null unique references points(id) on delete cascade,
  pipe_flex text not null default '' check (pipe_flex in ('', 'check', 'x', 'na')),
  pulled text not null default '' check (pulled in ('', 'check', 'x', 'na')),
  mounted text not null default '' check (mounted in ('', 'check', 'x', 'na')),
  panel_term text not null default '' check (panel_term in ('', 'check', 'x', 'na')),
  field_term text not null default '' check (field_term in ('', 'check', 'x', 'na')),
  tagged text not null default '' check (tagged in ('', 'check', 'x', 'na')),
  end_to_end text not null default '' check (end_to_end in ('', 'check', 'x', 'na')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_equipment_project on equipment(project_id);
create index if not exists idx_points_equipment on points(equipment_id);
create index if not exists idx_install_checks_point on install_checks(point_id);

-- ---- Keep updated_at current on every UPDATE, regardless of caller ----

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();

drop trigger if exists trg_equipment_updated_at on equipment;
create trigger trg_equipment_updated_at before update on equipment
  for each row execute function set_updated_at();

drop trigger if exists trg_points_updated_at on points;
create trigger trg_points_updated_at before update on points
  for each row execute function set_updated_at();

drop trigger if exists trg_install_checks_updated_at on install_checks;
create trigger trg_install_checks_updated_at before update on install_checks
  for each row execute function set_updated_at();

-- Every point gets a blank install_checks row for free the moment it's
-- created, regardless of which code path inserted it (an .mdb import, "Add
-- as New Point" from a controller check, a future import path) -- so the
-- frontend never has to special-case "this point has no install row yet".
create or replace function create_install_check_for_point()
returns trigger
language plpgsql
as $$
begin
  insert into install_checks (point_id) values (new.id)
    on conflict (point_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_points_create_install_check on points;
create trigger trg_points_create_install_check after insert on points
  for each row execute function create_install_check_for_point();

-- One-time (idempotent) backfill for points that existed before this table
-- did: carries forward whatever was already recorded in the old
-- points.end_to_end column rather than starting every point's Install
-- End-to-End blank. That column stays in place (unused by the app from here
-- on) rather than being dropped, since dropping it isn't reversible and
-- nothing requires it to go.
insert into install_checks (point_id, end_to_end)
  select id, end_to_end from points
  on conflict (point_id) do nothing;

-- ---- Keep status/date_commissioned in sync with the 7 checklist fields,
-- regardless of which code path touched them (a single cell edit, a
-- bulk-fill range, a re-import match, or a renumber pairing) ----
-- (End-to-End moved to install_checks -- verified during Function Test
-- rather than tracked as its own commissioning field, so it's excluded
-- from this count.)
-- An N/A field counts as satisfied, matching pointProgress() in
-- web/src/progress.ts: N/A is excluded from the denominator there too,
-- so a point with everything applicable checked (N/A's aside) already
-- reads as fully complete elsewhere in this app -- Commissioned agrees
-- with that instead of introducing a stricter, inconsistent definition.
-- All 7 fields N/A is the same "vacuously complete" edge case
-- pointProgress() already treats as 100%, so it reads as Commissioned
-- here too. date_commissioned is set only on the transition into
-- Commissioned (never overwritten while already Commissioned, so it
-- doesn't reset on an unrelated edit) and cleared the moment the point
-- is no longer Commissioned -- it always reflects current status, not a
-- permanent first-achieved record.
create or replace function set_point_status_and_date()
returns trigger
language plpgsql
as $$
declare
  v_checked int;
  v_na int;
begin
  v_checked := (case when new.wired = 'check' then 1 else 0 end)
             + (case when new.tagged = 'check' then 1 else 0 end)
             + (case when new.calibrate = 'check' then 1 else 0 end)
             + (case when new.function_test = 'check' then 1 else 0 end)
             + (case when new.sequence = 'check' then 1 else 0 end)
             + (case when new.alarm = 'check' then 1 else 0 end)
             + (case when new.graphics = 'check' then 1 else 0 end);
  v_na := (case when new.wired = 'na' then 1 else 0 end)
        + (case when new.tagged = 'na' then 1 else 0 end)
        + (case when new.calibrate = 'na' then 1 else 0 end)
        + (case when new.function_test = 'na' then 1 else 0 end)
        + (case when new.sequence = 'na' then 1 else 0 end)
        + (case when new.alarm = 'na' then 1 else 0 end)
        + (case when new.graphics = 'na' then 1 else 0 end);

  if v_checked = 7 - v_na then
    new.status := 'commissioned';
    if new.date_commissioned is null then
      new.date_commissioned := current_date;
    end if;
  else
    new.status := case when v_checked = 0 then 'not_started' else 'in_progress' end;
    new.date_commissioned := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_points_status_and_date on points;
create trigger trg_points_status_and_date before insert or update on points
  for each row execute function set_point_status_and_date();

-- One-time (idempotent-safe) recompute: existing rows' status/date_commissioned
-- were computed against the old 8-field formula and won't update on their own
-- until next written. A plain UPDATE re-fires the BEFORE UPDATE trigger above
-- for every row even though no column value actually changes, so this is safe
-- to run (and re-run) without touching any other column.
update points set updated_at = updated_at;

-- ---- RPCs for the two operations that need to be all-or-nothing ----
-- (a Postgres function runs inside the calling transaction, so either of
-- these fully succeeds or fully rolls back — same guarantee the old
-- Express server got from explicit BEGIN/COMMIT/ROLLBACK.)

-- Non-destructive re-import: matches equipment by tag and points by
-- point_number (scoped within their matched equipment) against what
-- already exists in this project. A match updates identity fields only —
-- the 7 checklist fields, notes, and blocked_by are never touched, so
-- re-importing an updated design points list can't erase commissioning
-- progress. Anything not present in this import (removed or renamed at
-- the source) goes inactive rather than being deleted, since a renamed
-- point is indistinguishable from a removed one at this level — see the
-- reconciliation UI, which lets the user pair a "went inactive" point to
-- a "newly added" one when they recognize a rename.
create or replace function import_points(p_project_id uuid, p_equipment jsonb, p_points jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb;
  v_existing_id uuid;
  v_new_id uuid;
  v_equipment_id uuid;
  v_equipment_new int := 0;
  v_equipment_matched int := 0;
  v_equipment_deactivated int := 0;
  v_point_new int := 0;
  v_point_matched int := 0;
  v_point_deactivated int := 0;
  v_new_points_json jsonb;
  v_deactivated_points_json jsonb;
begin
  create temporary table if not exists _import_id_map (temp_id text primary key, real_id uuid) on commit drop;
  create temporary table if not exists _touched_equipment (id uuid primary key) on commit drop;
  create temporary table if not exists _touched_points (id uuid primary key) on commit drop;
  -- Subset of _touched_points that were freshly inserted (not matched) this
  -- run — used to report exactly this import's new points for the
  -- reconciliation UI, not every point ever inserted.
  create temporary table if not exists _new_points (id uuid primary key) on commit drop;

  for v_item in select * from jsonb_array_elements(p_equipment) loop
    select id into v_existing_id from equipment
      where project_id = p_project_id and tag = v_item->>'tag'
      limit 1;

    if v_existing_id is not null then
      update equipment
        set equipment_type = coalesce(v_item->>'equipment_type', ''),
            location = coalesce(v_item->>'location', ''),
            active = true
        where id = v_existing_id;
      v_new_id := v_existing_id;
      v_equipment_matched := v_equipment_matched + 1;
    else
      insert into equipment (project_id, tag, equipment_type, location)
      values (
        p_project_id,
        v_item->>'tag',
        coalesce(v_item->>'equipment_type', ''),
        coalesce(v_item->>'location', '')
      )
      returning id into v_new_id;
      v_equipment_new := v_equipment_new + 1;
    end if;

    insert into _import_id_map (temp_id, real_id) values (v_item->>'tempId', v_new_id);
    insert into _touched_equipment (id) values (v_new_id) on conflict do nothing;
  end loop;

  for v_item in select * from jsonb_array_elements(p_points) loop
    select real_id into v_equipment_id from _import_id_map where temp_id = v_item->>'equipmentTempId';
    if v_equipment_id is null then
      continue; -- defensive: a point referencing an equipment tempId that was never in p_equipment
    end if;

    -- A blank point_number isn't a safe matching key on its own: some
    -- source rows (hardwired/interlocked devices with no discrete I/O
    -- address, e.g. an aquastat wired straight to a valve) legitimately
    -- have no point number at all, and more than one can share that same
    -- blank value under one equipment. Matching purely on point_number
    -- would collapse them into a single row -- whichever was processed
    -- last would silently overwrite the other's descriptor, and the
    -- import would come up one point short with no error. Descriptor
    -- disambiguates them when point_number is empty; a non-empty
    -- point_number is still the sole key, as it's the real natural one.
    if coalesce(v_item->>'point_number', '') = '' then
      select id into v_existing_id from points
        where equipment_id = v_equipment_id and point_number = ''
          and descriptor = coalesce(v_item->>'descriptor', '')
        limit 1;
    else
      select id into v_existing_id from points
        where equipment_id = v_equipment_id and point_number = v_item->>'point_number'
        limit 1;
    end if;

    if v_existing_id is not null then
      update points
        set panel = coalesce(v_item->>'panel', ''),
            ip_op = coalesce(v_item->>'ip_op', ''),
            analog_digital = coalesce(v_item->>'analog_digital', ''),
            descriptor = coalesce(v_item->>'descriptor', ''),
            active = true
        where id = v_existing_id;
      v_new_id := v_existing_id;
      v_point_matched := v_point_matched + 1;
    else
      insert into points (equipment_id, panel, ip_op, analog_digital, point_number, descriptor)
      values (
        v_equipment_id,
        coalesce(v_item->>'panel', ''),
        coalesce(v_item->>'ip_op', ''),
        coalesce(v_item->>'analog_digital', ''),
        v_item->>'point_number',
        coalesce(v_item->>'descriptor', '')
      )
      returning id into v_new_id;
      v_point_new := v_point_new + 1;
      insert into _new_points (id) values (v_new_id);
    end if;

    insert into _touched_points (id) values (v_new_id) on conflict do nothing;
  end loop;

  update equipment set active = false
    where project_id = p_project_id and active = true and id not in (select id from _touched_equipment);
  get diagnostics v_equipment_deactivated = row_count;

  with deactivated as (
    update points set active = false
      where active = true
        and equipment_id in (select id from equipment where project_id = p_project_id)
        and id not in (select id from _touched_points)
    returning id, point_number, descriptor, equipment_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'point_number', d.point_number, 'descriptor', d.descriptor, 'equipment_tag', e.tag
         )), '[]'::jsonb)
    into v_deactivated_points_json
    from deactivated d join equipment e on e.id = d.equipment_id;
  v_point_deactivated := jsonb_array_length(v_deactivated_points_json);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'point_number', p.point_number, 'descriptor', p.descriptor, 'equipment_tag', e.tag
         )), '[]'::jsonb)
    into v_new_points_json
    from points p join equipment e on e.id = p.equipment_id
    where p.id in (select id from _new_points);

  drop table if exists _import_id_map;
  drop table if exists _touched_equipment;
  drop table if exists _touched_points;
  drop table if exists _new_points;

  return jsonb_build_object(
    'equipment_new', v_equipment_new,
    'equipment_matched', v_equipment_matched,
    'equipment_deactivated', v_equipment_deactivated,
    'point_new', v_point_new,
    'point_matched', v_point_matched,
    'point_deactivated', v_point_deactivated,
    'new_points', v_new_points_json,
    'deactivated_points', v_deactivated_points_json
  );
end;
$$;

-- Reconciliation: the user recognized that "point_number" going inactive
-- and "point_number" newly added in the same re-import are actually the
-- same physical point, renumbered — not a removal + an unrelated addition.
-- Transfers checklist state/notes/blocked_by from the old point onto the
-- new one, then removes the now-redundant old row (its data has been
-- merged forward, so keeping it around would just clutter the "show
-- removed points" view with an already-resolved entry).
create or replace function pair_reimported_point(p_old_point_id uuid, p_new_point_id uuid)
returns void
language plpgsql
as $$
begin
  update points as new_pt
    set wired = old_pt.wired,
        tagged = old_pt.tagged,
        calibrate = old_pt.calibrate,
        function_test = old_pt.function_test,
        sequence = old_pt.sequence,
        alarm = old_pt.alarm,
        graphics = old_pt.graphics,
        notes = old_pt.notes,
        blocked_by = old_pt.blocked_by
    from points as old_pt
    where new_pt.id = p_new_point_id
      and old_pt.id = p_old_point_id;

  -- The new point already has its own blank install_checks row (created by
  -- trg_points_create_install_check on insert), so this transfers values
  -- onto it rather than re-pointing the old row -- point_id is unique, so
  -- the old row can't just be reassigned to the new point's id.
  update install_checks as new_ic
    set pipe_flex = old_ic.pipe_flex,
        pulled = old_ic.pulled,
        mounted = old_ic.mounted,
        panel_term = old_ic.panel_term,
        field_term = old_ic.field_term,
        tagged = old_ic.tagged,
        end_to_end = old_ic.end_to_end
    from install_checks as old_ic
    where new_ic.point_id = p_new_point_id
      and old_ic.point_id = p_old_point_id;

  -- Cascades to the old point's install_checks row too (point_id references
  -- points(id) on delete cascade).
  delete from points where id = p_old_point_id;
end;
$$;

-- Applies the checklist grid's range-fill / paste as one transaction.
-- Field names are allowlisted before being used in dynamic SQL — this runs
-- with the anon key, which is public (ships in the client bundle), so it
-- must not trust the field name from the request body.
create or replace function bulk_set_points(p_updates jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_field text;
  v_allowed text[] := array['wired', 'tagged', 'calibrate', 'function_test', 'sequence', 'alarm', 'graphics', 'notes', 'blocked_by'];
begin
  for v_item in select * from jsonb_array_elements(p_updates) loop
    v_field := v_item->>'field';
    if v_field = any(v_allowed) then
      execute format('update points set %I = $1, updated_at = now() where id = $2', v_field)
        using (v_item->>'value'), (v_item->>'id')::uuid;
    end if;
  end loop;
end;
$$;

-- Same shape as bulk_set_points() above, targeting install_checks instead —
-- keyed by point_id (not install_checks.id), since the grid already has
-- each row's point id on hand from the shared points list and never needs
-- to look up an install_checks row's own id separately.
create or replace function bulk_set_install_checks(p_updates jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_field text;
  v_allowed text[] := array['pipe_flex', 'pulled', 'mounted', 'panel_term', 'field_term', 'tagged', 'end_to_end'];
begin
  for v_item in select * from jsonb_array_elements(p_updates) loop
    v_field := v_item->>'field';
    if v_field = any(v_allowed) then
      execute format('update install_checks set %I = $1, updated_at = now() where point_id = $2', v_field)
        using (v_item->>'value'), (v_item->>'id')::uuid;
    end if;
  end loop;
end;
$$;

-- Sets points.on_controller from a client-computed comparison against an
-- EnteliWEB controller-points export (see web/src/controllerImport.ts and
-- web/src/pointNumber.ts for the parsing/matching, which happens client-
-- side — this just persists the result). The client always sends every
-- active point's status on each run, not only the ones that changed, so a
-- point that was previously flagged missing self-corrects the next time
-- the check runs against an updated controller export.
create or replace function set_controller_status(p_updates jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_updates) loop
    update points
      set on_controller = (v_item->>'on_controller')::boolean
      where id = (v_item->>'id')::uuid;
  end loop;
end;
$$;

-- ---- Row Level Security ----
-- No auth system exists yet — this is a single-team internal tool, so RLS
-- is enabled with explicit "anon can do everything" policies rather than
-- left disabled, so the openness is a deliberate, visible choice instead of
-- an oversight. The anon key ships in the client bundle either way; if this
-- tool ever gets real user accounts, these policies are the first thing to
-- tighten (e.g. scope by project membership).

alter table projects enable row level security;
alter table equipment enable row level security;
alter table points enable row level security;
alter table install_checks enable row level security;

drop policy if exists "anon full access" on projects;
create policy "anon full access" on projects for all using (true) with check (true);

drop policy if exists "anon full access" on equipment;
create policy "anon full access" on equipment for all using (true) with check (true);

drop policy if exists "anon full access" on points;
create policy "anon full access" on points for all using (true) with check (true);

drop policy if exists "anon full access" on install_checks;
create policy "anon full access" on install_checks for all using (true) with check (true);

grant execute on function import_points(uuid, jsonb, jsonb) to anon, authenticated;
grant execute on function bulk_set_points(jsonb) to anon, authenticated;
grant execute on function bulk_set_install_checks(jsonb) to anon, authenticated;
grant execute on function pair_reimported_point(uuid, uuid) to anon, authenticated;
grant execute on function set_controller_status(jsonb) to anon, authenticated;
