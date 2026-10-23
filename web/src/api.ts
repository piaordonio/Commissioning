import { supabase } from "./supabaseClient";
import { ImportEquipmentDraft, ImportPointDraft } from "./mdbImport";
import { ControllerPointRow } from "./controllerImport";
import { Equipment, InviteResult, Point } from "./types";
import { toLoginEmail } from "./username";

type ListTable = "projects" | "equipment" | "point_attributes" | "point_attribute_options" | "point_attribute_projects";
type WriteTable = "projects" | "equipment" | "points" | "issues" | "point_attributes" | "point_attribute_options";

function assertNoError<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// PostgREST embeds an .in() filter's values directly into the request URL
// (e.g. "point_id=in.(id1,id2,...)") -- for a large project, enough ids
// (a few hundred) makes that URL long enough to get rejected outright
// (400 Bad Request) by some layer in front of Postgres (a gateway/proxy
// header-size limit), well before it'd ever hit Postgres' own query
// planner. Splitting the id list into fixed-size batches and running them
// as parallel requests keeps every individual URL comfortably short
// regardless of project size, at the cost of a few more round trips. Any
// `.order()` passed via buildQuery only sorts within each batch, not the
// merged whole -- harmless here since every caller (usePointRows.ts,
// PointsReport.tsx) already re-sorts whatever it gets for display anyway.
async function listByIdsInChunks<T>(
  table: string,
  column: string,
  ids: string[],
  buildQuery: (query: any) => any = (q) => q
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(
    chunk(ids, 150).map(async (batch) => {
      const query = buildQuery(supabase.from(table).select("*").in(column, batch));
      const { data, error } = await query;
      return assertNoError(data as T[] | null, error);
    })
  );
  return results.flat();
}

export const api = {
  list: async <T>(table: ListTable, params?: Record<string, string>): Promise<T[]> => {
    let query = supabase.from(table).select("*");
    if (params) {
      for (const [key, value] of Object.entries(params)) query = query.eq(key, value);
    }
    // Matches the old server's ORDER BY: newest project first (App.tsx relies on
    // this to find a just-created project after an import), equipment by tag.
    // point_attribute_projects is a plain join table -- no natural order,
    // left unsorted (App.tsx only ever filters/groups it client-side).
    query =
      table === "projects"
        ? query.order("created_at", { ascending: false })
        : table === "point_attributes"
        ? query.order("name")
        : table === "point_attribute_options"
        ? query.order("sort_order")
        : table === "point_attribute_projects"
        ? query
        : query.order("tag");
    const { data, error } = await query;
    return assertNoError(data as T[] | null, error);
  },

  // points don't carry project_id directly (only equipment_id) — mirrors the
  // JOIN the old Express route did, as two round trips instead of one.
  listPoints: async <T>(projectId: string): Promise<T[]> => {
    const { data: equipmentRows, error: equipmentError } = await supabase
      .from("equipment")
      .select("id")
      .eq("project_id", projectId);
    assertNoError(equipmentRows, equipmentError);
    const equipmentIds = (equipmentRows ?? []).map((e: { id: string }) => e.id);
    return listByIdsInChunks<T>("points", "equipment_id", equipmentIds, (q) => q.order("point_number"));
  },

  // install_checks likewise don't carry project_id -- fetched by the point
  // ids the caller already has from listPoints(), one row per point (see
  // create_install_check_for_point() in supabase/schema.sql).
  listInstallChecks: async <T>(pointIds: string[]): Promise<T[]> => listByIdsInChunks<T>("install_checks", "point_id", pointIds),

  // issues, like install_checks, carry no project_id -- fetched by the
  // point ids the caller already has from listPoints(). Unlike
  // install_checks (exactly one row per point), a point can have zero or
  // many issue rows.
  listIssues: async <T>(pointIds: string[]): Promise<T[]> =>
    listByIdsInChunks<T>("issues", "point_id", pointIds, (q) => q.order("created_at")),

  // point_attribute_values, like install_checks/issues, carries no
  // project_id -- fetched by the point ids the caller already has from
  // listPoints(). Sparse like issues (zero or many rows per point), not
  // guaranteed-one-per-point like install_checks.
  listPointAttributeValues: async <T>(pointIds: string[]): Promise<T[]> =>
    listByIdsInChunks<T>("point_attribute_values", "point_id", pointIds),

  // `as any`: this client isn't wired to Supabase's generated Database types
  // (no schema codegen step for a project this size), so .insert()/.update()
  // have nothing to structurally check Partial<T> against.
  create: async <T>(table: WriteTable, data: Partial<T>): Promise<T> => {
    const { data: row, error } = await supabase.from(table).insert(data as any).select().single();
    return assertNoError(row as T | null, error);
  },

  update: async <T>(table: WriteTable, id: string, data: Partial<T>): Promise<T> => {
    const { data: row, error } = await supabase.from(table).update(data as any).eq("id", id).select().single();
    return assertNoError(row as T | null, error);
  },

  remove: async (table: WriteTable, id: string): Promise<void> => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  // Applied as one Postgres transaction server-side (see bulk_set_points in
  // supabase/schema.sql) so a range-fill or paste can't land half-applied.
  bulkSetPoints: async (updates: { id: string; field: string; value: string }[]): Promise<void> => {
    const { error } = await supabase.rpc("bulk_set_points", { p_updates: updates });
    if (error) throw new Error(error.message);
  },

  // Same shape as bulkSetPoints, targeting install_checks (see
  // bulk_set_install_checks in supabase/schema.sql). Used for both a single
  // cell click and a range-fill/paste, unlike points -- there's no plain
  // per-field update() path for install checks, since the RPC needs
  // point_id as the lookup key anyway (the id every call site already has),
  // not install_checks.id.
  bulkSetInstallChecks: async (updates: { id: string; field: string; value: string }[]): Promise<void> => {
    const { error } = await supabase.rpc("bulk_set_install_checks", { p_updates: updates });
    if (error) throw new Error(error.message);
  },

  // Plain upsert, no RPC needed -- point_attribute_id is a normal FK'd
  // value here, not a dynamic SQL column name, so there's no allowlist
  // concern the way bulk_set_points/bulk_set_install_checks have. Used for
  // a single boolean cell click and for text/number onBlur saves; the
  // bulk RPC below is reserved for the grid's range-fill/paste.
  upsertPointAttributeValue: async (pointId: string, attributeId: string, value: string): Promise<void> => {
    const { error } = await supabase
      .from("point_attribute_values")
      .upsert({ point_id: pointId, point_attribute_id: attributeId, value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  },

  // Same shape as bulkSetPoints, targeting point_attribute_values (see
  // bulk_set_point_attribute_values in supabase/schema.sql). Boolean-type
  // attribute columns only -- text/number never enter the grid's Cell
  // engine, so they never go through this path.
  bulkSetPointAttributeValues: async (
    updates: { point_id: string; point_attribute_id: string; value: string }[]
  ): Promise<void> => {
    const { error } = await supabase.rpc("bulk_set_point_attribute_values", { p_updates: updates });
    if (error) throw new Error(error.message);
  },

  // Replaces an attribute's full project-assignment set atomically (see
  // set_point_attribute_projects in supabase/schema.sql) -- the
  // AttributesAdmin checkbox list saves the whole set at once, not a diff.
  setPointAttributeProjects: async (attributeId: string, projectIds: string[]): Promise<void> => {
    const { error } = await supabase.rpc("set_point_attribute_projects", {
      p_attribute_id: attributeId,
      p_project_ids: projectIds,
    });
    if (error) throw new Error(error.message);
  },

  // The one write an installer can make on `points` itself (see
  // installer_update_point in supabase/schema.sql) -- RLS has no UPDATE
  // policy for them on this table at all, since there's no row-level way to
  // restrict that to just these two columns while an owner's own policy
  // also exists on the same table.
  installerUpdatePoint: async (pointId: string, notes: string, blockedBy: string): Promise<void> => {
    const { error } = await supabase.rpc("installer_update_point", {
      p_point_id: pointId,
      p_notes: notes,
      p_blocked_by: blockedBy,
    });
    if (error) throw new Error(error.message);
  },

  // true only for an account listed in admin_users -- see is_admin() in
  // supabase/schema.sql. Checked once after login to decide which shell to
  // render (see App.tsx), same question RLS itself answers server-side for
  // every query; this is just the client's own copy of that answer.
  isAdmin: async (userId: string): Promise<boolean> => {
    const { data, error } = await supabase.rpc("is_admin", { uid: userId });
    if (error) throw new Error(error.message);
    return !!data;
  },

  // project_installers rows for one project -- the "who's invited" list
  // behind the Add Installer screen (ProjectDashboard.tsx). RLS already
  // scopes this to a project's own owner/admin, same as everything else.
  listProjectInstallers: async <T>(projectId: string): Promise<T[]> => {
    const { data, error } = await supabase.from("project_installers").select("*").eq("project_id", projectId);
    return assertNoError(data as T[] | null, error);
  },

  // invite_installer() in supabase/schema.sql, not a plain insert: if that
  // username already has an account (signed up before being invited, or as
  // a teammate), this backfills user_id immediately instead of leaving the
  // invite permanently pending -- activate_pending_installer_invites()
  // only ever fires for a brand-new signup. Stores the same synthetic
  // address signInWithPassword/signUp use (see ../username.ts) so the
  // match on auth.users.email lines up.
  inviteInstaller: async <T>(projectId: string, username: string): Promise<T> => {
    const { data, error } = await supabase.rpc("invite_installer", {
      p_project_id: projectId,
      p_email: toLoginEmail(username),
    });
    return assertNoError(data as T | null, error);
  },

  revokeInstaller: async (projectId: string, email: string): Promise<void> => {
    const { error } = await supabase.from("project_installers").delete().eq("project_id", projectId).eq("email", email);
    if (error) throw new Error(error.message);
  },

  // "Same access as me" invites -- see pending_admins/activate_pending_admin_invites()
  // in supabase/schema.sql. RLS restricts all three of these to an existing
  // admin already (see that table's own policy), so there's no separate
  // owner-vs-admin branching needed here the way project_installers has.
  listPendingAdmins: async <T>(): Promise<T[]> => {
    const { data, error } = await supabase.from("pending_admins").select("*");
    return assertNoError(data as T[] | null, error);
  },

  // invite_admin() in supabase/schema.sql, not a plain insert: if that
  // username already has an account, this grants admin_users directly and
  // returns { activated: true } instead of a pending row nothing would
  // ever consume (activate_pending_admin_invites() only fires on signup).
  inviteAdmin: async (username: string): Promise<InviteResult> => {
    const { data, error } = await supabase.rpc("invite_admin", { p_email: toLoginEmail(username) });
    return assertNoError(data as InviteResult | null, error);
  },

  revokeAdminInvite: async (email: string): Promise<void> => {
    const { error } = await supabase.from("pending_admins").delete().eq("email", email);
    if (error) throw new Error(error.message);
  },

  // Plain teammate invites -- see pending_teammates/activate_pending_teammate_invites()
  // in supabase/schema.sql. Grants no role; just lets a username past the
  // invite-only signup gate. Same admin-only RLS shape as pending_admins.
  listPendingTeammates: async <T>(): Promise<T[]> => {
    const { data, error } = await supabase.from("pending_teammates").select("*");
    return assertNoError(data as T[] | null, error);
  },

  // invite_teammate() in supabase/schema.sql, not a plain insert: if that
  // username already has an account, it already passed the signup gate, so
  // there's nothing to grant -- returns { activated: true } and skips the
  // insert entirely instead of leaving a pending row nothing will consume.
  inviteTeammate: async (username: string): Promise<InviteResult> => {
    const { data, error } = await supabase.rpc("invite_teammate", { p_email: toLoginEmail(username) });
    return assertNoError(data as InviteResult | null, error);
  },

  revokeTeammateInvite: async (email: string): Promise<void> => {
    const { error } = await supabase.from("pending_teammates").delete().eq("email", email);
    if (error) throw new Error(error.message);
  },

  // Also one transaction server-side (import_points in supabase/schema.sql):
  // either every equipment/point row from the parsed import lands, or none
  // do. Non-destructive: matches existing equipment (by tag) and points (by
  // point_number) rather than always inserting, so re-importing an updated
  // points list updates/adds/deactivates instead of duplicating or erasing
  // checklist progress. See ImportDiff below for what the counts mean.
  import: async (
    projectId: string,
    equipment: ImportEquipmentDraft[],
    points: ImportPointDraft[]
  ): Promise<ImportDiff> => {
    const { data, error } = await supabase.rpc("import_points", {
      p_project_id: projectId,
      p_equipment: equipment,
      p_points: points,
    });
    return assertNoError(data as ImportDiff | null, error);
  },

  // Reconciliation: the user recognized that a deactivated point and a
  // newly-added point from the same import are actually the same physical
  // point, renumbered. See pair_reimported_point in supabase/schema.sql —
  // transfers checklist state onto the new point and removes the old row.
  pairReimportedPoint: async (oldPointId: string, newPointId: string): Promise<void> => {
    const { error } = await supabase.rpc("pair_reimported_point", {
      p_old_point_id: oldPointId,
      p_new_point_id: newPointId,
    });
    if (error) throw new Error(error.message);
  },

  // Persists the result of comparing design points against a controller
  // export (see pointNumber.ts/controllerImport.ts for the client-side
  // matching). One transaction (set_controller_status in supabase/schema.sql)
  // so a large project's worth of flags land atomically.
  setControllerStatus: async (updates: { id: string; on_controller: boolean }[]): Promise<void> => {
    const { error } = await supabase.rpc("set_controller_status", { p_updates: updates });
    if (error) throw new Error(error.message);
  },

  // For a controller object with no matching design point at all — a
  // point added on-site (missed in the original design, or added during a
  // long design-to-CX gap) rather than a renumbered one. Reuses equipment
  // matching this device/tag if it's already in the project (e.g. other
  // points on the same panel), otherwise creates it. No RPC: unlike a
  // re-import, there's no existing progress this could clobber, so two
  // plain inserts are enough.
  addControllerObjectAsPoint: async (
    projectId: string,
    row: ControllerPointRow,
    existingEquipment: Equipment[]
  ): Promise<{ point: Point; equipment: Equipment }> => {
    let equipment = existingEquipment.find((e) => e.tag === row.device);
    if (!equipment) {
      equipment = await api.create<Equipment>("equipment", {
        project_id: projectId,
        tag: row.device,
        equipment_type: "cp_panel",
      });
    }
    const point = await api.create<Point>("points", {
      equipment_id: equipment.id,
      panel: row.device,
      point_number: row.object_id,
      descriptor: row.name,
      active: true,
      on_controller: true,
      added_from_controller: true,
    });
    return { point, equipment };
  },
};

export interface ImportDiffPoint {
  id: string;
  point_number: string;
  descriptor: string;
  equipment_tag: string;
}

export interface ImportDiff {
  equipment_new: number;
  equipment_matched: number;
  equipment_deactivated: number;
  point_new: number;
  point_matched: number;
  point_deactivated: number;
  new_points: ImportDiffPoint[];
  deactivated_points: ImportDiffPoint[];
}
