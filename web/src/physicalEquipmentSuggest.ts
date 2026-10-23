import { Point } from "./types";

// Derives a candidate physical-equipment name from a point descriptor like
// "RCGG_BLR_P2_FB" -- strip the leading building code (first underscore
// segment) and the trailing signal/IO code (last segment: FB, AL, A, C,
// SPD, SPT, DP, S, RT, ...), and group by whatever's left in the middle
// ("BLR_P2" here). Validated against 21 real descriptors from a live
// project: it correctly separated BLR/BLR_P2/BLR_P3/BLR_P4 (the boiler
// itself vs. three distinct pumps), HWS/HWS_P3/HWS_P4, and DHWH/DHWH_P13
// (the heater itself vs. its own pump) into the physically-correct
// groups, rather than lumping everything under one "BLR" or "HWS" bucket.
// Not infallible -- a descriptor with fewer than 3 segments has no
// reliable system vs. signal split, and any naming convention this wasn't
// tested against can produce a nonsense key -- which is exactly why this
// only ever *suggests* groups for review (see PhysicalEquipmentChecklist.tsx),
// never creates them unreviewed.
function suggestedKeyFor(descriptor: string): string | null {
  const parts = descriptor.split("_").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length <= 2) return parts.slice(1).join("_") || null;
  const key = parts.slice(1, -1).join("_");
  return key || null;
}

export interface PhysicalEquipmentSuggestion {
  key: string;
  count: number;
  sampleDescriptor: string;
}

// Scoped to one equipment/controller's own points (the caller passes
// g.items for that group, not the whole project) -- suggestions are
// per-controller, matching how physical_equipment itself is scoped.
// existingNames excludes keys that already have a physical_equipment row
// under this controller, so re-opening "Suggest from names" after adding
// some doesn't re-suggest them.
export function suggestPhysicalEquipmentGroups(
  points: Point[],
  existingNames: Set<string>
): PhysicalEquipmentSuggestion[] {
  const byKey = new Map<string, Point[]>();
  for (const p of points) {
    const key = suggestedKeyFor(p.descriptor);
    if (!key || existingNames.has(key)) continue;
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }
  return Array.from(byKey.entries())
    .map(([key, pts]) => ({ key, count: pts.length, sampleDescriptor: pts[0].descriptor }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
