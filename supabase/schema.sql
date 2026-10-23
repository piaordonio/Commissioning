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

-- Idempotent for anyone who already ran an earlier version of this file
-- that had Install use its own separate Notes column -- reverted to a
-- single shared points.notes for both checklists, so this column is kept
-- in place (unused by the app from here on) rather than dropped, same
-- reasoning as points.end_to_end above: dropping it isn't reversible and
-- nothing requires it to go.
alter table install_checks add column if not exists notes text not null default '';

-- Structured, multi-entry issue log per point -- additive to (and
-- independent of) the existing points.blocked_by free-text field, which
-- stays exactly as-is and is never migrated into this table. Deliberately
-- minimal: description, recommended_action, and a bare open/closed status
-- -- no priority, assignee, part number, or per-issue comment trail.
-- status is purely informational: it is never read by
-- set_point_status_and_date() below and never gates a point's
-- commissioning status. Closed issues are kept, not deleted, so history
-- isn't lost -- same non-destructive ethos as points.active/equipment.active,
-- just encoded in this status column rather than a separate active flag.
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references points(id) on delete cascade,
  description text not null default '',
  recommended_action text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent for anyone who already ran an earlier version of this file
-- before this column existed -- report-only notes, meant for the printed
-- Issues report handoff document rather than the interactive issue log
-- (the modal, the Dashboard), so the compact on-screen views don't grow a
-- second block of free text nobody needs while working a point.
alter table issues add column if not exists notes text not null default '';

-- Idempotent for anyone who already ran an earlier version of this file
-- before this column existed -- maintained by set_issue_closed_at() below,
-- never written directly by the app, same "trigger-owned" pattern as
-- points.date_commissioned.
alter table issues add column if not exists closed_at timestamptz;

-- User-defined checklist columns on top of the fixed 7 commissioning + 7
-- install fields above -- modeled on EnteliWEB's own "Point Attributes"
-- admin page. Global definitions, not project-scoped: one attribute (e.g.
-- "End to End") can be reused across multiple projects, matching how
-- EnteliWEB's "Commissioning Sessions" checkboxes assign a single shared
-- attribute to specific sessions rather than redefining it per session --
-- see point_attribute_projects below for that per-project assignment.
-- attr_type is fixed at creation and never changed by the app after a
-- value row exists for this attribute (enforced client-side; see
-- AttributesAdmin.tsx) -- changing it would make existing
-- point_attribute_values rows semantically wrong (e.g. a stored 'check'
-- reinterpreted as literal text) and could trip check_point_attribute_value()
-- below on the next write to an old row.
create table if not exists point_attributes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_text text not null default '',
  attr_type text not null check (attr_type in ('boolean', 'text', 'number')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which projects an attribute is active for -- the "Commissioning Sessions"
-- checkbox list on EnteliWEB's attribute edit page. Composite PK, no
-- separate id: a pure many-to-many join that nothing else references
-- directly. Replaced wholesale on save (see set_point_attribute_projects()
-- below) rather than diffed row by row.
create table if not exists point_attribute_projects (
  point_attribute_id uuid not null references point_attributes(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  primary key (point_attribute_id, project_id)
);

-- The fixed dropdown-option list for a 'text' attribute configured as a
-- list rather than free entry -- zero rows means the attribute renders as
-- plain free-text input; one or more rows means it renders as a <select>
-- instead. Lives server-side and per-attribute (unlike the client-only
-- "Commissioned By" name list in PointsReport.tsx, which is a per-browser
-- localStorage convenience) since multiple techs working the same project
-- need to see the same shared list.
create table if not exists point_attribute_options (
  id uuid primary key default gen_random_uuid(),
  point_attribute_id uuid not null references point_attributes(id) on delete cascade,
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- One row per (point, attribute) that actually has a value -- sparse by
-- design, since a point only gets rows for attributes assigned to its
-- project, and a point with no value for a given attribute should just
-- read as blank rather than needing a placeholder row. value is always
-- text regardless of attr_type (boolean: '' | 'check' | 'x' | 'na', the
-- same CheckState convention as points.wired etc.; number: the raw
-- numeric string; text: the raw string) -- consistent with every other
-- checklist-style value column in this schema being text, and enforced by
-- check_point_attribute_value() below since a single shared column can't
-- use a literal per-field CHECK constraint the way every fixed field does.
-- Factored into pointProgress() in web/src/progress.ts (not installProgress.ts --
-- attributes sit in the Commissioning column group, not Install) AND into
-- full_bucket() below, which gates Commissioned itself on every attribute
-- assigned to the point's project being complete, same as the 7 fixed
-- fields. A value changing here re-triggers that recomputation via
-- trg_point_attribute_values_recompute_status below, in either direction --
-- completing the last unfilled attribute can newly reach Commissioned here,
-- not just revert out of it.
create table if not exists point_attribute_values (
  point_id uuid not null references points(id) on delete cascade,
  point_attribute_id uuid not null references point_attributes(id) on delete cascade,
  value text not null default '',
  updated_at timestamptz not null default now(),
  primary key (point_id, point_attribute_id)
);

create index if not exists idx_point_attribute_projects_project on point_attribute_projects(project_id);
create index if not exists idx_point_attribute_options_attr on point_attribute_options(point_attribute_id);
create index if not exists idx_point_attribute_values_attr on point_attribute_values(point_attribute_id);

create index if not exists idx_equipment_project on equipment(project_id);
create index if not exists idx_points_equipment on points(equipment_id);
create index if not exists idx_install_checks_point on install_checks(point_id);
create index if not exists idx_issues_point on issues(point_id);
-- Speeds "open issues for this point/project" lookups -- both the per-point
-- flag and the Dashboard's project-wide Active Issues panel filter on
-- status = 'open' across many rows at once.
create index if not exists idx_issues_open on issues(status) where status = 'open';

-- ---- Auth: project ownership + restricted installer role ----
-- Added once this app gained its first real login (Supabase Auth) --
-- everything above predates per-user accounts entirely, which is why
-- owner_id defaults to auth.uid() rather than being required at insert, and
-- every statement here is an idempotent add against a database that may
-- already hold real data.

-- Stamped from the request's JWT at insert time -- api.create("projects", ...)
-- in web/src/api.ts needs no code change, Postgres fills this in on its own.
alter table projects add column if not exists owner_id uuid references auth.users(id) default auth.uid();
-- Separate and unconditional, unlike the ADD COLUMN above: "if not exists"
-- is a full no-op (default included) if the column is already there for any
-- reason -- a partial earlier run, an experiment, anything -- which would
-- otherwise leave a database stuck with a defaultless owner_id forever,
-- failing every new project's insert against the WITH CHECK below with no
-- obvious cause. This line re-asserts the default regardless of history.
alter table projects alter column owner_id set default auth.uid();

-- A supervisor who can see every project, not just their own -- add someone
-- with a one-line insert in the SQL Editor, no redeploy needed. Deliberately
-- not a general roles/permissions table: this is the one cross-cutting
-- override this app needs, not a framework for every future one.
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id)
);

-- language sql / not security definer -- runs with the caller's own RLS, so
-- it only ever sees its own row in admin_users (see that table's own select
-- policy below), which is exactly enough for this to answer correctly for
-- every caller: an admin sees their row and gets true, anyone else sees no
-- matching row and gets false, and nobody can enumerate the admin list.
create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from admin_users where user_id = uid);
$$;

-- Field installers: a second, restricted kind of account, granted access to
-- specific projects by that project's owner rather than owning any
-- themselves. email starts a row before that person has ever signed up
-- (user_id null) -- "invite by email" has to work before an account exists
-- to invite -- and the trigger below fills user_id in the moment they do.
create table if not exists project_installers (
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  user_id uuid references auth.users(id),
  invited_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, email)
);

-- security definer (+ a pinned search_path) is required here, not just good
-- practice: projects' own SELECT policy calls this function, and
-- project_installers' SELECT policy below checks back against projects
-- (to let a project's owner see who they've invited). Without security
-- definer, this function's query runs as the calling (authenticated) role,
-- which re-triggers project_installers' RLS, which re-queries projects,
-- which re-triggers projects' RLS, calling this function again -- infinite
-- recursion, surfaced as Postgres's "stack depth limit exceeded". Running
-- as the (RLS-bypassing) function owner instead reads project_installers
-- directly, breaking the cycle.
create or replace function is_installer_on(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_installers
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

-- Activates every pending invite for an email the instant that person signs
-- up. Supabase Auth's sign-up is public (anyone can create an account) --
-- that's what lets "Add Installer" work without a privileged server
-- component: an unsolicited sign-up just gets an account with nothing
-- assigned to it yet, inert until an owner has already invited that exact
-- email to a project. `security definer` is required here, not optional:
-- GoTrue's own insert into auth.users runs as the supabase_auth_admin role,
-- which has no grants on public.project_installers, so without
-- `security definer` this trigger's UPDATE fails with a permission error
-- and GoTrue aborts the entire sign-up ("Database error saving new user").
-- `set search_path` pins which schema `project_installers` resolves against
-- so that a definer-rights function can't be tricked by the caller's own
-- search_path.
create or replace function activate_pending_installer_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update project_installers set user_id = new.id
    where email = new.email and user_id is null;
  return new;
end;
$$;

drop trigger if exists trg_activate_installer_invites on auth.users;
create trigger trg_activate_installer_invites
  after insert on auth.users
  for each row execute function activate_pending_installer_invites();

-- The one write an installer needs on `points` itself (Notes/Blocked By).
-- Postgres RLS is row-level, not column-level -- there's no policy clause
-- that lets an installer UPDATE a point but only touch two of its columns
-- while an owner's own blanket policy also exists on the same table. Same
-- field-allowlist-via-RPC pattern bulk_set_points/bulk_set_install_checks
-- below already use for the same reason, just fixed to these two fields and
-- gated by is_installer_on() instead of an allowlist array. No RLS UPDATE
-- policy exists for installers on `points` at all (see below) -- this RPC
-- is the only path, and it checks authorization itself since the table-
-- level policy can't express "these two columns only."
create or replace function installer_update_point(p_point_id uuid, p_notes text, p_blocked_by text)
returns void
language plpgsql
as $$
declare
  v_project_id uuid;
begin
  select e.project_id into v_project_id
    from points p join equipment e on e.id = p.equipment_id
    where p.id = p_point_id;

  if v_project_id is null or not is_installer_on(v_project_id) then
    raise exception 'Not authorized to update this point';
  end if;

  update points set notes = coalesce(p_notes, ''), blocked_by = coalesce(p_blocked_by, '') where id = p_point_id;
end;
$$;

-- A rare, lightweight "same access as me" grant -- same pending-invite-by-
-- email shape as project_installers above, but for the one cross-cutting
-- admin_users override instead of a per-project assignment. Deliberately a
-- narrower circle than installer invites: only an existing admin can invite
-- another one (see this table's own RLS below), not any project owner --
-- handing out full-account access shouldn't be as easy as handing out
-- access to one project.
create table if not exists pending_admins (
  email text primary key,
  invited_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Same reason as activate_pending_installer_invites() above: GoTrue's insert
-- into auth.users runs as supabase_auth_admin, which has no grants on
-- public.pending_admins/admin_users, so this needs `security definer` (plus
-- a pinned search_path) or every sign-up fails with "Database error saving
-- new user", not just invited ones.
create or replace function activate_pending_admin_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from pending_admins where email = new.email) then
    insert into admin_users (user_id) values (new.id) on conflict do nothing;
    delete from pending_admins where email = new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activate_admin_invites on auth.users;
create trigger trg_activate_admin_invites
  after insert on auth.users
  for each row execute function activate_pending_admin_invites();

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

drop trigger if exists trg_issues_updated_at on issues;
create trigger trg_issues_updated_at before update on issues
  for each row execute function set_updated_at();

drop trigger if exists trg_point_attributes_updated_at on point_attributes;
create trigger trg_point_attributes_updated_at before update on point_attributes
  for each row execute function set_updated_at();

drop trigger if exists trg_point_attribute_values_updated_at on point_attribute_values;
create trigger trg_point_attribute_values_updated_at before update on point_attribute_values
  for each row execute function set_updated_at();

-- Enforces type integrity on point_attribute_values.value: unlike every
-- fixed-field column in this schema, this single column is shared across
-- all 3 attr_types, so it can't use a plain literal CHECK constraint --
-- this trigger looks up the parent attribute's attr_type instead.
create or replace function check_point_attribute_value()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select attr_type into v_type from point_attributes where id = new.point_attribute_id;
  if v_type is null then
    raise exception 'Unknown point_attribute_id %', new.point_attribute_id;
  end if;
  if v_type = 'boolean' and new.value not in ('', 'check', 'x', 'na') then
    raise exception 'Invalid boolean attribute value %', new.value;
  elsif v_type = 'number' and new.value <> '' and new.value !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'Invalid number attribute value %', new.value;
  end if;
  -- text: unconstrained.
  return new;
end;
$$;

drop trigger if exists trg_point_attribute_values_check on point_attribute_values;
create trigger trg_point_attribute_values_check before insert or update on point_attribute_values
  for each row execute function check_point_attribute_value();

-- Editing a custom attribute value has no column on points of its own to
-- fire that table's BEFORE UPDATE trigger -- this forces that re-evaluation
-- by touching the point row, which re-runs set_point_status_and_date() /
-- full_bucket() against the point's current 7 fields AND (now-updated)
-- attribute values, in either direction: completing the last unfilled
-- attribute can newly promote a point to Commissioned here, same as editing
-- one of the 7 fixed fields already does, not just revert out of it. First
-- cross-table trigger cascade in this schema.
create or replace function recompute_point_status_on_attribute_change()
returns trigger
language plpgsql
as $$
begin
  update points set updated_at = now() where id = new.point_id;
  return new;
end;
$$;

drop trigger if exists trg_point_attribute_values_revert_commissioned on point_attribute_values;
drop trigger if exists trg_point_attribute_values_recompute_status on point_attribute_values;
create trigger trg_point_attribute_values_recompute_status after insert or update on point_attribute_values
  for each row execute function recompute_point_status_on_attribute_change();

-- Keeps closed_at in sync with status, regardless of which code path
-- touched it -- same "trigger-owned, app never writes it directly" pattern
-- as points.date_commissioned in set_point_status_and_date() below. Set
-- only on the transition into closed (never overwritten while already
-- closed, so it doesn't reset on an unrelated edit) and cleared the
-- moment the issue is reopened, so it always reflects the current close,
-- not a permanent first-closed record.
create or replace function set_issue_closed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'closed' then
    if new.closed_at is null then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issues_closed_at on issues;
create trigger trg_issues_closed_at before insert or update on issues
  for each row execute function set_issue_closed_at();

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

-- ---- Not Started/In Progress/Commissioned are all fully auto-computed ----
-- (End-to-End moved to install_checks -- verified during Function Test
-- rather than tracked as its own commissioning field, so it's excluded
-- from this count.)
-- Reads the point's full completeness: the 7 fixed fields (each check/N/A),
-- plus every custom attribute assigned to the point's project (see
-- point_attribute_projects) -- Boolean the same check/N/A rule as the fixed
-- fields, Text/Number requiring an actual non-N/A value (isAttrValueNA() in
-- web/src/pointAttributes.ts has no separate "reviewed, doesn't apply" state
-- distinct from "never touched", so there's no attribute-type-safe way to
-- let N/A satisfy completeness there the way Boolean's na does -- an
-- attribute that genuinely doesn't apply to some points needs a real,
-- if trivial, value entered, or it should not have been assigned to those
-- points' project in the first place). stable, not immutable, since it
-- reads point_attribute_projects/point_attribute_values -- correct and safe
-- to call from the triggers below, which always run inside the same
-- transaction as whatever just changed.
create or replace function full_bucket(p points)
returns text
language plpgsql
stable
as $$
declare
  v_checked int;
  v_na int;
  v_project_id uuid;
begin
  v_checked := (case when p.wired = 'check' then 1 else 0 end)
             + (case when p.tagged = 'check' then 1 else 0 end)
             + (case when p.calibrate = 'check' then 1 else 0 end)
             + (case when p.function_test = 'check' then 1 else 0 end)
             + (case when p.sequence = 'check' then 1 else 0 end)
             + (case when p.alarm = 'check' then 1 else 0 end)
             + (case when p.graphics = 'check' then 1 else 0 end);
  v_na := (case when p.wired = 'na' then 1 else 0 end)
        + (case when p.tagged = 'na' then 1 else 0 end)
        + (case when p.calibrate = 'na' then 1 else 0 end)
        + (case when p.function_test = 'na' then 1 else 0 end)
        + (case when p.sequence = 'na' then 1 else 0 end)
        + (case when p.alarm = 'na' then 1 else 0 end)
        + (case when p.graphics = 'na' then 1 else 0 end);

  if v_checked < 7 - v_na then
    return case when v_checked = 0 then 'not_started' else 'in_progress' end;
  end if;

  select e.project_id into v_project_id from equipment e where e.id = p.equipment_id;

  if exists (
    select 1
    from point_attribute_projects pap
    join point_attributes pa on pa.id = pap.point_attribute_id
    left join point_attribute_values pav
      on pav.point_id = p.id and pav.point_attribute_id = pap.point_attribute_id
    where pap.project_id = v_project_id
      and (
        (pa.attr_type = 'boolean' and coalesce(pav.value, '') not in ('check', 'na'))
        or (pa.attr_type <> 'boolean' and (
          pav.value is null or btrim(pav.value) = '' or upper(btrim(pav.value)) = 'N/A'
        ))
      )
  ) then
    return 'in_progress';
  end if;

  return 'commissioned';
end;
$$;

-- Fully derived from current data -- the client never writes status/
-- date_commissioned directly (no "Mark Commissioned"/"Revert" action
-- exists). date_commissioned stamps the first time a point computes as
-- commissioned and clears the moment it no longer does, so re-entering
-- Commissioned after a later edit gets a fresh date, not the original one.
create or replace function set_point_status_and_date()
returns trigger
language plpgsql
as $$
begin
  new.status := full_bucket(new);
  if new.status = 'commissioned' then
    if new.date_commissioned is null then
      new.date_commissioned := current_date;
    end if;
  else
    new.date_commissioned := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_points_status_and_date on points;
create trigger trg_points_status_and_date before insert or update on points
  for each row execute function set_point_status_and_date();

-- One-time (idempotent-safe) recompute: existing rows' status/date_commissioned
-- were computed under the old manual-Commissioned model and won't update on
-- their own until next written. A plain UPDATE re-fires the BEFORE UPDATE
-- trigger above for every row even though no column value actually changes,
-- so this is safe to run (and re-run) without touching any other column --
-- including the first time this version of the schema runs against
-- already-commissioned rows that may no longer qualify under full_bucket()
-- (e.g. an attribute assigned since they were marked Commissioned).
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
  -- Installers never import -- not in their capability list -- and this
  -- would otherwise be callable directly against the REST endpoint by
  -- anyone holding a valid JWT regardless of whether the UI offers a
  -- button for it, so the check has to live here, not just in the absence
  -- of a menu item.
  if not (is_admin(auth.uid()) or exists (select 1 from projects where id = p_project_id and owner_id = auth.uid())) then
    raise exception 'Not authorized to import into this project';
  end if;

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
-- Transfers checklist state/notes/blocked_by, install checks, issues, and
-- custom attribute values from the old point onto the new one, then
-- removes the now-redundant old row (its data has been merged forward, so
-- keeping it around would just clutter the "show removed points" view
-- with an already-resolved entry).
create or replace function pair_reimported_point(p_old_point_id uuid, p_new_point_id uuid)
returns void
language plpgsql
as $$
declare
  v_project_id uuid;
begin
  -- Installers never reconcile a re-import -- same "callable directly
  -- regardless of UI" reasoning as import_points() above.
  select e.project_id into v_project_id
    from points p join equipment e on e.id = p.equipment_id
    where p.id = p_old_point_id;

  if v_project_id is null or not (is_admin(auth.uid()) or exists (select 1 from projects where id = v_project_id and owner_id = auth.uid())) then
    raise exception 'Not authorized to pair these points';
  end if;

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

  -- Issues have no one-row-per-point constraint (zero or many per point,
  -- unlike install_checks), so there's nothing on the new point to merge
  -- onto -- just re-point the existing rows wholesale. Keeps id, status,
  -- created_at/closed_at, everything, unlike the field-by-field copies
  -- above.
  update issues set point_id = p_new_point_id where point_id = p_old_point_id;

  -- point_attribute_values has no trigger-created row waiting on the new
  -- point the way install_checks does, and the new point *can* already
  -- have its own value for an attribute (entered before this pairing
  -- happened) -- a blind re-point would hit that row's primary key
  -- (point_id, point_attribute_id). Insert-and-skip-on-conflict instead:
  -- carries over every old value the new point doesn't already have, and
  -- leaves the new point's own value alone wherever one already exists.
  insert into point_attribute_values (point_id, point_attribute_id, value, updated_at)
    select p_new_point_id, point_attribute_id, value, updated_at
    from point_attribute_values
    where point_id = p_old_point_id
    on conflict (point_id, point_attribute_id) do nothing;

  -- Cascades to the old point's install_checks row, and any
  -- point_attribute_values rows the insert above left behind because the
  -- new point already had its own value for that attribute (issues were
  -- already re-pointed above, so none remain to cascade away here).
  delete from points where id = p_old_point_id;
end;
$$;

-- Applies the checklist grid's range-fill / paste as one transaction.
-- Field names are allowlisted before being used in dynamic SQL -- the
-- request body is still untrusted input regardless of which logged-in
-- user sent it, so this must not trust the field name it carries.
create or replace function bulk_set_points(p_updates jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_field text;
  v_point_id uuid;
  v_allowed text[] := array['wired', 'tagged', 'calibrate', 'function_test', 'sequence', 'alarm', 'graphics', 'notes', 'blocked_by'];
begin
  for v_item in select * from jsonb_array_elements(p_updates) loop
    v_field := v_item->>'field';
    v_point_id := (v_item->>'id')::uuid;
    -- These are the 7 Commissioning fields (plus notes/blocked_by) -- not in
    -- an installer's capability list, and this RPC is callable directly
    -- against the REST endpoint regardless of whether the UI offers a
    -- button for it, same reasoning as import_points()/pair_reimported_point()
    -- above. Checked per-row (there's no single project_id parameter to
    -- check once) -- one unauthorized row fails the whole batch, same
    -- all-or-nothing contract the rest of this function already has.
    if not (is_admin(auth.uid()) or exists (
      select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
      where p.id = v_point_id and pr.owner_id = auth.uid()
    )) then
      raise exception 'Not authorized to update point %', v_point_id;
    end if;
    if v_field = any(v_allowed) then
      execute format('update points set %I = $1, updated_at = now() where id = $2', v_field)
        using (v_item->>'value'), v_point_id;
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
  v_point_id uuid;
begin
  for v_item in select * from jsonb_array_elements(p_updates) loop
    v_point_id := (v_item->>'id')::uuid;
    -- Checking against a controller export isn't in an installer's
    -- capability list -- same reasoning as the other guarded RPCs above.
    if not (is_admin(auth.uid()) or exists (
      select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
      where p.id = v_point_id and pr.owner_id = auth.uid()
    )) then
      raise exception 'Not authorized to update point %', v_point_id;
    end if;
    update points
      set on_controller = (v_item->>'on_controller')::boolean
      where id = v_point_id;
  end loop;
end;
$$;

-- Upserts (point_id, point_attribute_id, value). No column-name allowlist
-- needed, unlike bulk_set_points/bulk_set_install_checks above --
-- point_attribute_id is a normal FK'd value in a fixed-shape upsert here,
-- never used in dynamic SQL, so there's no injection surface to guard.
-- Used for the grid's boolean-attribute range-fill/paste; a single cell
-- click or a text/number onBlur save goes straight through a plain
-- supabase-js .upsert() from the client instead (see web/src/api.ts), the
-- same division of labor points/commissioning fields already use.
create or replace function bulk_set_point_attribute_values(p_updates jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_updates) loop
    insert into point_attribute_values (point_id, point_attribute_id, value, updated_at)
    values (
      (v_item->>'point_id')::uuid,
      (v_item->>'point_attribute_id')::uuid,
      coalesce(v_item->>'value', ''),
      now()
    )
    on conflict (point_id, point_attribute_id)
    do update set value = excluded.value, updated_at = now();
  end loop;
end;
$$;

-- Replaces the full set of projects an attribute is assigned to, atomically
-- -- avoids the brief inconsistent-state window two separate plain
-- delete+insert calls from the client would have. Also recomputes every
-- point in every project this call touches, old assignment or new: since
-- Commissioned now factors in attribute completeness (see full_bucket()
-- above), assigning this attribute to a project can retroactively drop
-- already-commissioned points there back to In Progress (nothing has a
-- value for the new attribute yet), and un-assigning it can just as
-- immediately restore Commissioned on points that were only held back by
-- this one attribute -- neither should wait for the next unrelated edit on
-- each point to take effect.
create or replace function set_point_attribute_projects(p_attribute_id uuid, p_project_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_affected_project_ids uuid[];
begin
  select array_agg(distinct project_id) into v_affected_project_ids
  from (
    select project_id from point_attribute_projects where point_attribute_id = p_attribute_id
    union
    select unnest(p_project_ids)
  ) affected;

  delete from point_attribute_projects where point_attribute_id = p_attribute_id;
  insert into point_attribute_projects (point_attribute_id, project_id)
  select p_attribute_id, unnest(p_project_ids)
  on conflict do nothing;

  update points p set updated_at = now()
  from equipment e
  where e.id = p.equipment_id and e.project_id = any(v_affected_project_ids);
end;
$$;

-- ---- Row Level Security ----
-- Three kinds of access, from here down: a project's owner (full read/write
-- on everything under it), an admin (every project, via is_admin() --
-- add someone with one SQL Editor insert into admin_users), and a field
-- installer (read + Install-checklist-only write, on only the project(s)
-- they're explicitly invited to via project_installers). anon has none of
-- it -- every policy below requires auth.uid() is not null one way or
-- another, which is what actually locks the door now that this app has a
-- real login; the anon key still ships in the client bundle by design, it
-- just no longer unlocks anything.
--
-- `projects`/`equipment`/`points` each need SELECT to allow all three
-- (owner/admin/installer) while INSERT/UPDATE/DELETE allow only
-- owner/admin -- two separate policies per table, not one. A single "for
-- all" policy whose USING clause included the installer check would have
-- quietly let an installer DELETE a project/equipment/point too: DELETE in
-- Postgres RLS only ever consults USING, never WITH CHECK, so a WITH CHECK
-- restricted to owner/admin does NOT save you on the delete path the way
-- it does on update. `install_checks`/`issues`-and-select/insert/update
-- don't have that asymmetry (installers are meant to fully own those
-- within their assigned project), so those stay single broader policies;
-- `issues` DELETE still gets its own owner/admin-only policy, same reason.

alter table projects enable row level security;
alter table equipment enable row level security;
alter table points enable row level security;
alter table install_checks enable row level security;
alter table issues enable row level security;
alter table point_attributes enable row level security;
alter table point_attribute_projects enable row level security;
alter table point_attribute_options enable row level security;
alter table point_attribute_values enable row level security;
alter table admin_users enable row level security;
alter table project_installers enable row level security;
alter table pending_admins enable row level security;

-- projects
drop policy if exists "anon full access" on projects;
drop policy if exists "select: owner, admin, or assigned installer" on projects;
create policy "select: owner, admin, or assigned installer" on projects for select using (
  owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(id)
);
drop policy if exists "write: owner or admin only" on projects;
create policy "write: owner or admin only" on projects for all using (
  owner_id = auth.uid() or is_admin(auth.uid())
) with check (
  owner_id = auth.uid() or is_admin(auth.uid())
);

-- equipment
drop policy if exists "anon full access" on equipment;
drop policy if exists "select: owner, admin, or assigned installer" on equipment;
create policy "select: owner, admin, or assigned installer" on equipment for select using (
  exists (
    select 1 from projects pr where pr.id = equipment.project_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
);
drop policy if exists "write: owner or admin only" on equipment;
create policy "write: owner or admin only" on equipment for all using (
  exists (select 1 from projects pr where pr.id = equipment.project_id and (pr.owner_id = auth.uid() or is_admin(auth.uid())))
) with check (
  exists (select 1 from projects pr where pr.id = equipment.project_id and (pr.owner_id = auth.uid() or is_admin(auth.uid())))
);

-- points -- no installer write policy at all (see installer_update_point()
-- above for the one write -- notes/blocked_by -- an installer can make).
drop policy if exists "anon full access" on points;
drop policy if exists "select: owner, admin, or assigned installer" on points;
create policy "select: owner, admin, or assigned installer" on points for select using (
  exists (
    select 1 from equipment e join projects pr on pr.id = e.project_id
    where e.id = points.equipment_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
);
drop policy if exists "write: owner or admin only" on points;
create policy "write: owner or admin only" on points for all using (
  exists (
    select 1 from equipment e join projects pr on pr.id = e.project_id
    where e.id = points.equipment_id and (pr.owner_id = auth.uid() or is_admin(auth.uid()))
  )
) with check (
  exists (
    select 1 from equipment e join projects pr on pr.id = e.project_id
    where e.id = points.equipment_id and (pr.owner_id = auth.uid() or is_admin(auth.uid()))
  )
);

-- install_checks -- entirely installer-owned within their assigned
-- project(s), no column-level split needed the way points has, so one
-- policy for every command is correct here (unlike points/projects/
-- equipment above).
drop policy if exists "anon full access" on install_checks;
drop policy if exists "owner, admin, or assigned installer" on install_checks;
create policy "owner, admin, or assigned installer" on install_checks for all using (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = install_checks.point_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
) with check (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = install_checks.point_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
);

-- issues -- select/insert/update open to an assigned installer ("log/view
-- Issues" is in their capability list); delete is owner/admin only, same
-- DELETE-only-consults-USING reasoning as projects/equipment/points above.
drop policy if exists "anon full access" on issues;
drop policy if exists "select: owner, admin, or assigned installer" on issues;
create policy "select: owner, admin, or assigned installer" on issues for select using (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = issues.point_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
);
drop policy if exists "insert: owner, admin, or assigned installer" on issues;
create policy "insert: owner, admin, or assigned installer" on issues for insert with check (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = issues.point_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
);
drop policy if exists "update: owner, admin, or assigned installer" on issues;
create policy "update: owner, admin, or assigned installer" on issues for update using (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = issues.point_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
) with check (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = issues.point_id
      and (pr.owner_id = auth.uid() or is_admin(auth.uid()) or is_installer_on(pr.id))
  )
);
drop policy if exists "delete: owner or admin only" on issues;
create policy "delete: owner or admin only" on issues for delete using (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = issues.point_id and (pr.owner_id = auth.uid() or is_admin(auth.uid()))
  )
);

-- point_attributes / point_attribute_options -- attribute *definitions*
-- (shared vocabulary like "Fail Position"), not project data: readable/
-- writable by any authenticated user, not owner-scoped, same design intent
-- this schema already had before per-user accounts existed. No installer
-- access at all, same as point_attribute_projects/point_attribute_values
-- below -- custom attributes are outside an installer's capability list
-- entirely.
drop policy if exists "anon full access" on point_attributes;
drop policy if exists "authenticated full access" on point_attributes;
create policy "authenticated full access" on point_attributes for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "anon full access" on point_attribute_options;
drop policy if exists "authenticated full access" on point_attribute_options;
create policy "authenticated full access" on point_attribute_options for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- point_attribute_projects -- the per-project assignment (unlike the
-- definitions above, this IS project data) -- owner/admin only.
drop policy if exists "anon full access" on point_attribute_projects;
drop policy if exists "owner or admin only" on point_attribute_projects;
create policy "owner or admin only" on point_attribute_projects for all using (
  exists (select 1 from projects pr where pr.id = point_attribute_projects.project_id and (pr.owner_id = auth.uid() or is_admin(auth.uid())))
) with check (
  exists (select 1 from projects pr where pr.id = point_attribute_projects.project_id and (pr.owner_id = auth.uid() or is_admin(auth.uid())))
);

-- point_attribute_values -- the actual entered data -- owner/admin only, no
-- installer access at all.
drop policy if exists "anon full access" on point_attribute_values;
drop policy if exists "owner or admin only" on point_attribute_values;
create policy "owner or admin only" on point_attribute_values for all using (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = point_attribute_values.point_id and (pr.owner_id = auth.uid() or is_admin(auth.uid()))
  )
) with check (
  exists (
    select 1 from points p join equipment e on e.id = p.equipment_id join projects pr on pr.id = e.project_id
    where p.id = point_attribute_values.point_id and (pr.owner_id = auth.uid() or is_admin(auth.uid()))
  )
);

-- admin_users -- a user can only ever see their own row (never the full
-- admin list), which is exactly enough for is_admin() to resolve correctly
-- for every caller (see that function's own comment). No one self-promotes
-- via the app: adding an admin is a by-hand SQL Editor insert, which runs
-- as the Postgres superuser and bypasses this policy entirely.
drop policy if exists "see own row only" on admin_users;
create policy "see own row only" on admin_users for select using (user_id = auth.uid());

-- project_installers -- an installer sees their own invite rows (so
-- is_installer_on() resolves for them); a project's owner (or an admin)
-- sees every invite for their own project(s), and is the only one who can
-- create or revoke one. No update policy: user_id is filled in by
-- activate_pending_installer_invites() above, which runs in the elevated
-- context of a GoTrue sign-up, not a normal authenticated-role request.
drop policy if exists "self, or owner/admin of the project" on project_installers;
create policy "self, or owner/admin of the project" on project_installers for select using (
  user_id = auth.uid()
  or is_admin(auth.uid())
  or exists (select 1 from projects pr where pr.id = project_installers.project_id and pr.owner_id = auth.uid())
);
drop policy if exists "owner or admin invites" on project_installers;
create policy "owner or admin invites" on project_installers for insert with check (
  is_admin(auth.uid())
  or exists (select 1 from projects pr where pr.id = project_installers.project_id and pr.owner_id = auth.uid())
);
drop policy if exists "owner or admin revokes" on project_installers;
create policy "owner or admin revokes" on project_installers for delete using (
  is_admin(auth.uid())
  or exists (select 1 from projects pr where pr.id = project_installers.project_id and pr.owner_id = auth.uid())
);

-- pending_admins -- only an existing admin can see, create, or revoke a
-- pending "same access as me" invite. Narrower than project_installers'
-- owner-can-invite-to-their-own-project model on purpose (see this table's
-- own comment above).
drop policy if exists "admin only" on pending_admins;
create policy "admin only" on pending_admins for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- anon is deliberately left off every grant below now that there's a real
-- login -- these are only ever called by a signed-in user.
grant execute on function import_points(uuid, jsonb, jsonb) to authenticated;
grant execute on function bulk_set_points(jsonb) to authenticated;
grant execute on function bulk_set_install_checks(jsonb) to authenticated;
grant execute on function pair_reimported_point(uuid, uuid) to authenticated;
grant execute on function set_controller_status(jsonb) to authenticated;
grant execute on function bulk_set_point_attribute_values(jsonb) to authenticated;
grant execute on function set_point_attribute_projects(uuid, uuid[]) to authenticated;
grant execute on function installer_update_point(uuid, text, text) to authenticated;
grant execute on function is_admin(uuid) to authenticated;
grant execute on function is_installer_on(uuid) to authenticated;

-- Existing-data migration for a database that had projects before this
-- change: run once, by hand, after you've logged in at least once (so your
-- own auth.users row exists) --
--   update projects set owner_id = '<your-auth-uid>' where owner_id is null;
-- -- not automated here, since there's no way to guess who should own
-- pre-existing data.
