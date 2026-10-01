import { CHECK_FIELDS, CheckState, Point, PointAttribute } from "./types";
import { isAttrValueNA } from "./pointAttributes";

/** Credit each state earns toward "done"; null excludes the field from the average (N/A). */
const CREDIT: Record<CheckState, number | null> = {
  "": 0,
  x: 0,
  check: 1,
  na: null,
};

// A point's completion (0-1) across its 7 checklist fields plus any custom
// attributes assigned to its project, equally weighted -- Commissioning
// only, not Install (the Attributes column group sits next to Commissioning
// in the grid, not Install). Boolean attributes reuse CREDIT exactly like
// the 7 fixed fields. Text/Number attributes are excluded from the
// denominator entirely while unset (isAttrValueNA -- empty, whitespace-only,
// or literally "N/A", the default display for a never-touched cell), same
// treatment N/A already gets everywhere else in this app; once a real value
// is entered they're always full credit, since there's no partial-credit
// concept for free text or a number. This no longer gates points.status --
// see set_point_status_and_date() in supabase/schema.sql for why
// "Commissioned" is a manual action instead.
export function pointProgress(
  point: Point,
  attrs: PointAttribute[],
  attrValueMap: Map<string, Map<string, string>>
): number {
  let creditSum = 0;
  let applicable = 0;
  for (const field of CHECK_FIELDS) {
    const credit = CREDIT[point[field]];
    if (credit === null) continue;
    applicable++;
    creditSum += credit;
  }
  for (const attr of attrs) {
    const raw = attrValueMap.get(point.id)?.get(attr.id) ?? "";
    if (attr.attr_type === "boolean") {
      const credit = CREDIT[raw as CheckState];
      if (credit === null) continue;
      applicable++;
      creditSum += credit;
    } else {
      if (isAttrValueNA(raw)) continue;
      applicable++;
      creditSum += 1;
    }
  }
  return applicable === 0 ? 1 : creditSum / applicable;
}

/** Average completion (0-1) across a set of points, e.g. all points under one equipment or one project. */
export function averageProgress(
  points: Point[],
  attrs: PointAttribute[],
  attrValueMap: Map<string, Map<string, string>>
): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + pointProgress(p, attrs, attrValueMap), 0) / points.length;
}

export function buildProgressByEquipment(
  points: Point[],
  attrs: PointAttribute[],
  attrValueMap: Map<string, Map<string, string>>
): Map<string, number> {
  const byEquipment = new Map<string, Point[]>();
  for (const p of points) {
    const list = byEquipment.get(p.equipment_id);
    if (list) list.push(p);
    else byEquipment.set(p.equipment_id, [p]);
  }
  const result = new Map<string, number>();
  for (const [equipmentId, pts] of byEquipment) {
    result.set(equipmentId, Math.round(averageProgress(pts, attrs, attrValueMap) * 100));
  }
  return result;
}
