import { PointAttribute, PointAttributeOption, PointAttributeProject, PointAttributeValue } from "./types";

/** Attributes assigned to a given project, name-sorted for a stable column order. */
export function attributesForProject(
  allAttributes: PointAttribute[],
  links: PointAttributeProject[],
  projectId: string
): PointAttribute[] {
  const assignedIds = new Set(links.filter((l) => l.project_id === projectId).map((l) => l.point_attribute_id));
  return allAttributes.filter((a) => assignedIds.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Options for one attribute, in display order. Empty = plain free-text input, not a dropdown. */
export function optionsForAttribute(allOptions: PointAttributeOption[], attributeId: string): PointAttributeOption[] {
  return allOptions.filter((o) => o.point_attribute_id === attributeId).sort((a, b) => a.sort_order - b.sort_order);
}

/** O(1) per-(point, attribute) lookup -- two-level Map since this is sparse,
 *  unlike installChecksByPointId's flat Map (one guaranteed row per point). */
export function buildAttributeValueMap(values: PointAttributeValue[]): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  for (const v of values) {
    let inner = map.get(v.point_id);
    if (!inner) {
      inner = new Map();
      map.set(v.point_id, inner);
    }
    inner.set(v.point_attribute_id, v.value);
  }
  return map;
}

export function getAttributeValue(
  valueMap: Map<string, Map<string, string>>,
  pointId: string,
  attributeId: string
): string {
  return valueMap.get(pointId)?.get(attributeId) ?? "";
}

/** Feeds the admin list view's "# projects assigned" column. */
export function projectCountForAttribute(links: PointAttributeProject[], attributeId: string): number {
  return links.filter((l) => l.point_attribute_id === attributeId).length;
}

// Text/Number attributes have no explicit N/A state the way Boolean's
// CheckState cycle does -- an unset, whitespace-only, or literally "N/A"
// value is treated as not-yet-applicable: excluded from % Completed (see
// pointProgress() in progress.ts) and shown as N/A rather than blank, so
// adding a new attribute to a project doesn't retroactively ding every
// existing point's percentage until someone deliberately enters a real
// value for it.
export const ATTR_NA_DISPLAY = "N/A";

export function isAttrValueNA(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed.toUpperCase() === ATTR_NA_DISPLAY;
}
