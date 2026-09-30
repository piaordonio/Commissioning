import { Equipment, Issue, Point } from "./types";

/** Groups issues by the point they belong to, for O(1) per-point lookups. */
export function groupIssuesByPointId(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = map.get(issue.point_id);
    if (list) list.push(issue);
    else map.set(issue.point_id, [issue]);
  }
  return map;
}

/** True if this point has at least one open issue -- drives the Blocked By flag. */
export function hasOpenIssue(issuesForPoint: Issue[] | undefined): boolean {
  return !!issuesForPoint?.some((i) => i.status === "open");
}

export function openIssueCount(issuesForPoint: Issue[] | undefined): number {
  return issuesForPoint?.filter((i) => i.status === "open").length ?? 0;
}

/** Open-issue count per equipment -- feeds the equipment-group-header badge
 *  (grid + mobile) and the Dashboard's commissioned/not-commissioned rollups. */
export function buildOpenIssueCountByEquipment(
  points: Point[],
  issuesByPointId: Map<string, Issue[]>
): Map<string, number> {
  const result = new Map<string, number>();
  for (const p of points) {
    const count = openIssueCount(issuesByPointId.get(p.id));
    if (count === 0) continue;
    result.set(p.equipment_id, (result.get(p.equipment_id) ?? 0) + count);
  }
  return result;
}

export interface ActiveIssueRow {
  issue: Issue;
  point: Point;
  equipment: Equipment | undefined;
}

/** Every open issue project-wide, resolved to its point + equipment -- feeds
 *  the Dashboard's Active Issues panel. Only active (non-removed) points are
 *  included, same "removed shouldn't clutter the live view" convention the
 *  rest of the app already applies. */
export function buildActiveIssueRows(
  issues: Issue[],
  points: Point[],
  equipmentById: Record<string, Equipment>
): ActiveIssueRow[] {
  return buildIssueRows(issues, points, equipmentById, { includeClosed: false });
}

/** Same shape as buildActiveIssueRows, generalized for the Issues report --
 *  which needs the option to include resolved issues too (a closeout audit
 *  trail, not just the live punch list). */
export function buildIssueRows(
  issues: Issue[],
  points: Point[],
  equipmentById: Record<string, Equipment>,
  { includeClosed }: { includeClosed: boolean }
): ActiveIssueRow[] {
  const pointsById = new Map(points.map((p) => [p.id, p]));
  const rows: ActiveIssueRow[] = [];
  for (const issue of issues) {
    if (issue.status !== "open" && !includeClosed) continue;
    const point = pointsById.get(issue.point_id);
    if (!point || !point.active) continue;
    rows.push({ issue, point, equipment: equipmentById[point.equipment_id] });
  }
  return rows;
}
