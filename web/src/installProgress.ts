import { CheckState, INSTALL_FIELDS, INSTALL_FIELD_WEIGHTS, InstallCheck, Point } from "./types";

/** Credit each state earns toward "done"; null excludes the field's weight from the average (N/A). */
const CREDIT: Record<CheckState, number | null> = {
  "": 0,
  x: 0,
  check: 1,
  na: null,
};

/** A point's weighted completion (0-1) across the 7 install fields -- see INSTALL_FIELD_WEIGHTS in types.ts. */
export function installProgress(check: InstallCheck | undefined): number {
  if (!check) return 0;
  let creditSum = 0;
  let weightSum = 0;
  for (const field of INSTALL_FIELDS) {
    const credit = CREDIT[check[field]];
    if (credit === null) continue;
    const weight = INSTALL_FIELD_WEIGHTS[field];
    weightSum += weight;
    creditSum += credit * weight;
  }
  return weightSum === 0 ? 1 : creditSum / weightSum;
}

export type InstallStatus = "not_started" | "in_progress" | "complete";

export const INSTALL_STATUS_LABELS: Record<InstallStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
};

// A plain bucketed read of the 7 fields, not weighted like installProgress()
// above -- mirrors set_point_status_and_date()'s counting logic in
// supabase/schema.sql (N/A never blocks completion, all-N/A reads as
// complete), but computed on read rather than persisted: unlike
// Commissioning's Status/Date Commissioned, there's no "date install
// completed" requirement driving a need to track the transition moment
// server-side, so this has nothing that needs a trigger or a stored column.
export function installStatus(check: InstallCheck | undefined): InstallStatus {
  if (!check) return "not_started";
  let checked = 0;
  let na = 0;
  for (const field of INSTALL_FIELDS) {
    if (check[field] === "check") checked++;
    else if (check[field] === "na") na++;
  }
  // Checked against "complete" first: an all-N/A point has checked === 0
  // too, and must read Complete (same vacuously-complete convention as
  // Commissioning's all-N/A edge case), not Not Started.
  if (checked === INSTALL_FIELDS.length - na) return "complete";
  return checked === 0 ? "not_started" : "in_progress";
}

/** Average weighted completion (0-1) across a set of points, e.g. every active point in a project. */
export function averageInstallProgress(points: Point[], checksByPointId: Map<string, InstallCheck>): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + installProgress(checksByPointId.get(p.id)), 0) / points.length;
}

export function buildInstallProgressByEquipment(
  points: Point[],
  checksByPointId: Map<string, InstallCheck>
): Map<string, number> {
  const byEquipment = new Map<string, Point[]>();
  for (const p of points) {
    const list = byEquipment.get(p.equipment_id);
    if (list) list.push(p);
    else byEquipment.set(p.equipment_id, [p]);
  }
  const result = new Map<string, number>();
  for (const [equipmentId, pts] of byEquipment) {
    result.set(equipmentId, Math.round(averageInstallProgress(pts, checksByPointId) * 100));
  }
  return result;
}
