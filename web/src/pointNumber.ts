import { Point } from "./types";

// Direct CP-panel points carry a raw "IP"/"OP" token in their point number
// (from the source Access data) plus a separate Analog/Digital field; fold
// the two into the single token techs actually use (AI/BI/AO/BO) instead of
// showing them as separate columns. Zone-expanded points have no
// analog_digital value (see mdbImport.ts) and pass through unchanged.
//
// This is also the matching key against EnteliWEB's own "Object ID" export
// (e.g. "20300.AI83") — see controllerImport.ts — since EnteliWEB already
// uses the resolved AI/BI/AO/BO form.
export function resolvedPointNumber(p: Pick<Point, "point_number" | "analog_digital">): string {
  const ad = p.analog_digital.trim().toLowerCase();
  const isAnalog = ad.startsWith("a");
  const isDigital = ad.startsWith("d");
  if (!isAnalog && !isDigital) return p.point_number;
  if (p.point_number.includes("IP")) return p.point_number.replace("IP", isAnalog ? "AI" : "BI");
  if (p.point_number.includes("OP")) return p.point_number.replace("OP", isAnalog ? "AO" : "BO");
  return p.point_number;
}

// Some source designs split one physical CP panel's points across multiple
// "Points List T" groupings, distinguished only by a trailing ".1" / ".2" on
// the panel number (e.g. "20300.1", "20300.2") -- useful for keeping the
// design source organized, but just noise once it's on a checklist next to
// the actual point number. Display-only, same reasoning as
// resolvedPointNumber: the underlying panel/tag values are left untouched
// since matching and grouping still rely on them being distinct.
export function displayPanel(panel: string): string {
  return panel.replace(/\.\d+$/, "");
}
