import { Fragment, useMemo, useState } from "react";
import { CHECK_FIELDS, CHECK_FIELD_LABELS, CheckState, Equipment, Point, POINT_STATUS_LABELS, Project } from "../types";
import { buildProgressByEquipment, averageProgress } from "../progress";
import { resolvedPointNumber, displayPanel } from "../pointNumber";
import { formatDateCommissioned } from "../formatDate";

const COMMISSIONED_BY_NAMES_KEY = "commissioning-points-commissioned-by-names";

// A per-browser convenience list, not project data (see the Commissioned
// By field itself, which is likewise never persisted to Supabase) -- so a
// tech's name typed once is remembered for the next report printed from
// this machine, without needing any backend support for it.
function loadCommissionedByNames(): string[] {
  try {
    const raw = localStorage.getItem(COMMISSIONED_BY_NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCommissionedByNames(names: string[]) {
  try {
    localStorage.setItem(COMMISSIONED_BY_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Private-browsing / blocked storage -- the dropdown still works for
    // this session, it just won't remember names for next time.
  }
}

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
  const [commissionedByNames, setCommissionedByNames] = useState<string[]>(() => loadCommissionedByNames());
  const [hideDateCommissioned, setHideDateCommissioned] = useState(false);
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
        <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={hideDateCommissioned}
            onChange={(e) => setHideDateCommissioned(e.target.checked)}
          />
          Hide Date Commissioned column
        </label>
        <div className="spacer" />
        <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Commissioned By
          <select
            value={commissionedBy}
            onChange={(e) => {
              if (e.target.value === "__add__") {
                const name = window.prompt("Add a name to the list")?.trim();
                if (!name) return;
                if (!commissionedByNames.includes(name)) {
                  const next = [...commissionedByNames, name].sort((a, b) => a.localeCompare(b));
                  setCommissionedByNames(next);
                  saveCommissionedByNames(next);
                }
                setCommissionedBy(name);
                return;
              }
              setCommissionedBy(e.target.value);
            }}
          >
            <option value="">Select…</option>
            {commissionedByNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="__add__">+ Add name…</option>
          </select>
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

      <div className="table-wrap report-table-wrap">
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
              <th className="report-col-status divider-left">Status</th>
              {!hideDateCommissioned && <th className="report-col-date divider-left">Date Comm.</th>}
              <th className="report-col-notes divider-left">Notes</th>
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
                    <td colSpan={3 + CHECK_FIELDS.length + (hideDateCommissioned ? 3 : 4)}>
                      {eq?.tag ?? g.equipmentId}
                      {eq?.location ? ` — ${eq.location}` : ""} <span className="count-pill">{g.items.length}</span>{" "}
                      <span
                        className={`progress-pill ${
                          pct > 90 ? "progress-pill-high" : pct < 10 ? "progress-pill-low" : ""
                        }`}
                      >
                        {pct}%
                      </span>
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
                      <td className="report-col-status divider-left">
                        <span className={`status-pill status-${point.status}`}>
                          {POINT_STATUS_LABELS[point.status]}
                        </span>
                      </td>
                      {!hideDateCommissioned && (
                        <td className="report-col-date divider-left">
                          {formatDateCommissioned(point.date_commissioned)}
                        </td>
                      )}
                      <td className="report-col-notes divider-left">{point.notes || "—"}</td>
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
