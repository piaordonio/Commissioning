import { CHECK_FIELDS, CheckState, Point } from "./types";

/** Credit each state earns toward "done"; null excludes the field from the average (N/A). */
const CREDIT: Record<CheckState, number | null> = {
  "": 0,
  x: 0,
  check: 1,
  na: null,
};

/** A point's completion (0-1) across its 7 checklist fields, equally weighted. */
export function pointProgress(point: Point): number {
  let creditSum = 0;
  let applicable = 0;
  for (const field of CHECK_FIELDS) {
    const credit = CREDIT[point[field]];
    if (credit === null) continue;
    applicable++;
    creditSum += credit;
  }
  return applicable === 0 ? 1 : creditSum / applicable;
}

/** Average completion (0-1) across a set of points, e.g. all points under one equipment or one project. */
export function averageProgress(points: Point[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + pointProgress(p), 0) / points.length;
}

export function buildProgressByEquipment(points: Point[]): Map<string, number> {
  const byEquipment = new Map<string, Point[]>();
  for (const p of points) {
    const list = byEquipment.get(p.equipment_id);
    if (list) list.push(p);
    else byEquipment.set(p.equipment_id, [p]);
  }
  const result = new Map<string, number>();
  for (const [equipmentId, pts] of byEquipment) {
    result.set(equipmentId, Math.round(averageProgress(pts) * 100));
  }
  return result;
}
