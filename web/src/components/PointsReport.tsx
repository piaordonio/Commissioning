import { Fragment, useMemo, useState } from "react";
import { CHECK_FIELDS, CHECK_FIELD_LABELS, CheckState, Equipment, Point, Project } from "../types";
import { buildProgressByEquipment, averageProgress } from "../progress";
import { resolvedPointNumber, displayPanel } from "../pointNumber";

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
  const [commissionedBy, setCommissionedBy] = useState("");
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
        <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Commissioned By
          <input value={commissionedBy} onChange={(e) => setCommissionedBy(e.target.value)} placeholder="Name" />
        </label>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="report-header">
        <div className="report-title-row">
          <img className="report-logo" src="/ainsworth-logo.jpg" alt="Ainsworth" />
          <h2>{project.project_number ? `${project.project_number} — ${project.name}` : project.name}</h2>
        </div>
        <div className="report-meta-bar">
          <span>
            Generated{" "}
            {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </span>
          <span>
            {activePoints.length} points, {overallPct}% complete
          </span>
          <span>
            Commissioned By:{" "}
            {commissionedBy ? commissionedBy : <span className="signoff-blank">{" ".repeat(20)}</span>}
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table report-table">
          <thead>
            <tr>
              <th className="report-col-panel">Panel</th>
              <th className="report-col-point">Point #</th>
              <th className="checklist-name-col">Descriptor</th>
              {CHECK_FIELDS.map((f) => (
                <th key={f} className="checklist-item-header">
                  {CHECK_FIELD_LABELS[f]}
                </th>
              ))}
              <th className="report-col-notes">Notes</th>
              <th className="report-col-blocked">Blocked By</th>
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
                      <td className="report-col-panel">{displayPanel(point.panel)}</td>
                      <td className="report-col-point">{resolvedPointNumber(point)}</td>
                      <td className="truncate checklist-name-col" title={point.descriptor}>
                        {point.descriptor}
                      </td>
                      {CHECK_FIELDS.map((field) => (
                        <td key={field} className={`checklist-cell checklist-${point[field] || "empty"}`}>
                          {SYMBOL[point[field]]}
                        </td>
                      ))}
                      <td className="report-col-notes">{point.notes || "—"}</td>
                      <td className="report-col-blocked">{point.blocked_by || "—"}</td>
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
