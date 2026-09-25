import { supabase } from "./supabaseClient";
import { ImportEquipmentDraft, ImportPointDraft } from "./mdbImport";

function assertNoError<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export const api = {
  list: async <T>(table: "projects" | "equipment", params?: Record<string, string>): Promise<T[]> => {
    let query = supabase.from(table).select("*");
    if (params) {
      for (const [key, value] of Object.entries(params)) query = query.eq(key, value);
    }
    // Matches the old server's ORDER BY: newest project first (App.tsx relies on
    // this to find a just-created project after an import), equipment by tag.
    query = table === "projects" ? query.order("created_at", { ascending: false }) : query.order("tag");
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
    if (equipmentIds.length === 0) return [];

    const { data, error } = await supabase
      .from("points")
      .select("*")
      .in("equipment_id", equipmentIds)
      .order("point_number");
    return assertNoError(data as T[] | null, error);
  },

  // `as any`: this client isn't wired to Supabase's generated Database types
  // (no schema codegen step for a project this size), so .insert()/.update()
  // have nothing to structurally check Partial<T> against.
  create: async <T>(table: "projects" | "equipment", data: Partial<T>): Promise<T> => {
    const { data: row, error } = await supabase.from(table).insert(data as any).select().single();
    return assertNoError(row as T | null, error);
  },

  update: async <T>(table: "projects" | "equipment" | "points", id: string, data: Partial<T>): Promise<T> => {
    const { data: row, error } = await supabase.from(table).update(data as any).eq("id", id).select().single();
    return assertNoError(row as T | null, error);
  },

  remove: async (table: "projects" | "equipment", id: string): Promise<void> => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  // Applied as one Postgres transaction server-side (see bulk_set_points in
  // supabase/schema.sql) so a range-fill or paste can't land half-applied.
  bulkSetPoints: async (updates: { id: string; field: string; value: string }[]): Promise<void> => {
    const { error } = await supabase.rpc("bulk_set_points", { p_updates: updates });
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
