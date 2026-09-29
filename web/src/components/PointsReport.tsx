import { Fragment, useMemo } from "react";
import { CHECK_FIELDS, CHECK_FIELD_LABELS, CheckState, Equipment, Point, Project } from "../types";
import { buildProgressByEquipment, averageProgress } from "../progress";
import { resolvedPointNumber } from "../pointNumber";

const SYMBOL: Record<CheckState, string> = { "": "", check: "✓", x: "✗", na: "N/A" };

// A clean, print-focused view of the points list to hand off/print — not
// the interactive grid with a print stylesheet grafted on, since the
// grid's selection/keyboard-nav/clipboard logic has nothing to do with a
// printout. Always active points only (regardless of the grid's "show
// removed" toggle), and deliberately leaves out the Controller and delete
// columns — this is a handoff document, not the working view.
export function PointsReport({
  project,
  equipment,
  points,
  onBack,
}: {
  project: Project;
  equipment: Equipment[];
  points: Point[];
  onBack: () => void;
}) {
  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment]);
  const progressByEquipment = useMemo(() => buildProgressByEquipment(activePoints), [activePoints]);
  const overallPct = Math.round(averageProgress(activePoints) * 100);

  const groups = useMemo(() => {
    const sorted = [...activePoints].sort((a, b) => {
      const ta = equipmentById[a.equipment_id]?.tag ?? "";
      const tb = equipmentById[b.equipment_id]?.tag ?? "";
      return ta === tb ? a.point_number.localeCompare(b.point_number) : ta.localeCompare(tb);
    });
    const list: { equipmentId: string; items: Point[] }[] = [];
    for (const p of sorted) {
      const last = list[list.length - 1];
      if (last && last.equipmentId === p.equipment_id) last.items.push(p);
      else list.push({ equipmentId: p.equipment_id, items: [p] });
    }
    return list;
  }, [activePoints, equipmentById]);

  return (
    <div className="view">
      <div className="toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back to Grid
        </button>
        <div className="spacer" />
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="report-header">
        <h2>{project.project_number ? `${project.project_number} — ${project.name}` : project.name}</h2>
        <div className="muted-text">
          Generated {new Date().toLocaleDateString()} — {activePoints.length} points, {overallPct}% complete
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Panel</th>
              <th>Point #</th>
              <th>Descriptor</th>
              {CHECK_FIELDS.map((f) => (
                <th key={f} className="checklist-item-header">
                  {CHECK_FIELD_LABELS[f]}
                </th>
              ))}
              <th>Notes</th>
              <th>Blocked By</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const eq = equipmentById[g.equipmentId];
              const pct = progressByEquipment.get(g.equipmentId) ?? 0;
              return (
                <Fragment key={g.equipmentId}>
                  <tr className="table-group-header">
                    <td colSpan={3 + CHECK_FIELDS.length + 2}>
                      {eq?.tag ?? g.equipmentId}
                      {eq?.location ? ` — ${eq.location}` : ""} <span className="count-pill">{g.items.length}</span>{" "}
                      <span className="progress-pill">{pct}%</span>
                    </td>
                  </tr>
                  {g.items.map((point) => (
                    <tr key={point.id}>
                      <td>{point.panel}</td>
                      <td>{resolvedPointNumber(point)}</td>
                      <td className="truncate checklist-name-col" title={point.descriptor}>
                        {point.descriptor}
                      </td>
                      {CHECK_FIELDS.map((field) => (
                        <td key={field} className={`checklist-cell checklist-${point[field] || "empty"}`}>
                          {SYMBOL[point[field]]}
                        </td>
                      ))}
                      <td>{point.notes || "—"}</td>
                      <td>{point.blocked_by || "—"}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
