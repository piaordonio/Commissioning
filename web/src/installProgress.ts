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
    const avg = pts.reduce((sum, p) => sum + installProgress(checksByPointId.get(p.id)), 0) / pts.length;
    result.set(equipmentId, Math.round(avg * 100));
  }
  return result;
}
