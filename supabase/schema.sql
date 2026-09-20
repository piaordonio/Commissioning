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
  sequence text not null default '' check (sequence in ('', 'check', 'x', 'na')),
  alarm text not null default '' check (alarm in ('', 'check', 'x', 'na')),
  graphics text not null default '' check (graphics in ('', 'check', 'x', 'na')),
  notes text not null default '',
  blocked_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_equipment_project on equipment(project_id);
create index if not exists idx_points_equipment on points(equipment_id);

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

-- ---- RPCs for the two operations that need to be all-or-nothing ----
-- (a Postgres function runs inside the calling transaction, so either of
-- these fully succeeds or fully rolls back — same guarantee the old
-- Express server got from explicit BEGIN/COMMIT/ROLLBACK.)

-- Bulk-inserts equipment + points from a parsed Engtool import, mapping the
-- client-generated tempIds in p_points to the real ids just assigned to
-- p_equipment. See web/src/mdbImport.ts for what builds these arrays.
create or replace function import_points(p_project_id uuid, p_equipment jsonb, p_points jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_equipment_count int := 0;
  v_point_count int := 0;
  v_item jsonb;
  v_new_id uuid;
begin
  create temporary table if not exists _import_id_map (temp_id text primary key, real_id uuid) on commit drop;

  for v_item in select * from jsonb_array_elements(p_equipment) loop
    insert into equipment (project_id, tag, equipment_type, location)
    values (
      p_project_id,
      v_item->>'tag',
      coalesce(v_item->>'equipment_type', ''),
      coalesce(v_item->>'location', '')
    )
    returning id into v_new_id;

    insert into _import_id_map (temp_id, real_id) values (v_item->>'tempId', v_new_id);
    v_equipment_count := v_equipment_count + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(p_points) loop
    insert into points (equipment_id, panel, ip_op, analog_digital, point_number, descriptor)
    select m.real_id,
           coalesce(v_item->>'panel', ''),
           coalesce(v_item->>'ip_op', ''),
           coalesce(v_item->>'analog_digital', ''),
           v_item->>'point_number',
           coalesce(v_item->>'descriptor', '')
    from _import_id_map m
    where m.temp_id = v_item->>'equipmentTempId';

    if found then
      v_point_count := v_point_count + 1;
    end if;
  end loop;

  drop table if exists _import_id_map;

  return jsonb_build_object('equipment_count', v_equipment_count, 'point_count', v_point_count);
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
  v_allowed text[] := array['wired', 'tagged', 'end_to_end', 'calibrate', 'sequence', 'alarm', 'graphics', 'notes', 'blocked_by'];
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

drop policy if exists "anon full access" on projects;
create policy "anon full access" on projects for all using (true) with check (true);

drop policy if exists "anon full access" on equipment;
create policy "anon full access" on equipment for all using (true) with check (true);

drop policy if exists "anon full access" on points;
create policy "anon full access" on points for all using (true) with check (true);

grant execute on function import_points(uuid, jsonb, jsonb) to anon, authenticated;
grant execute on function bulk_set_points(jsonb) to anon, authenticated;
