import { Fragment, useMemo, useState } from "react";
import {
  CHECK_FIELDS,
  CHECK_FIELD_LABELS,
  CheckState,
  Equipment,
  ISSUE_STATUS_LABELS,
  Issue,
  Point,
  POINT_STATUS_LABELS,
  PointStatus,
  Project,
} from "../types";
import { buildProgressByEquipment, averageProgress } from "../progress";
import { buildIssueRows } from "../issues";
import { resolvedPointNumber, displayPanel } from "../pointNumber";
import { formatDateCommissioned, formatTimestamp } from "../formatDate";

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
  issues,
  onOpenIssues,
  onBack,
}: {
  project: Project;
  equipment: Equipment[];
  points: Point[];
  issues: Issue[];
  onOpenIssues: (point: Point) => void;
  onBack: () => void;
}) {
  // "Checklist" is the handoff document this view has always been; "Issues"
  // is a second, differently-shaped report over the same project data (a
  // punch list, not a per-field grid) -- a mode toggle here instead of a
  // second print flow/header button, since both need the same project data
  // and print CSS and neither needs its own screen.
  const [reportMode, setReportMode] = useState<"checklist" | "issues">("checklist");
  const [commissionedBy, setCommissionedBy] = useState("");
  const [commissionedByNames, setCommissionedByNames] = useState<string[]>(() => loadCommissionedByNames());
  const [hideDateCommissioned, setHideDateCommissioned] = useState(false);
  // Defaults to the actionable punch list (what still needs fixing) rather
  // than a full audit trail -- this is the report you'd actually hand to a
  // sub. Checking this in pulls resolved issues back in for a closeout
  // record.
  const [includeClosedIssues, setIncludeClosedIssues] = useState(false);
  // Defaults to showing everything; a manager wanting "what's remaining"
  // unchecks Commissioned and prints just the open rows. Progress pills
  // still reflect every active point regardless of this filter -- it only
  // controls which rows are listed, not what "done" means for a panel.
  const [statusFilter, setStatusFilter] = useState<Record<PointStatus, boolean>>({
    not_started: true,
    in_progress: true,
    commissioned: true,
  });
  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const visiblePoints = useMemo(() => activePoints.filter((p) => statusFilter[p.status]), [activePoints, statusFilter]);
  const statusFilterActive = !statusFilter.not_started || !statusFilter.in_progress || !statusFilter.commissioned;
  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment]);
  const progressByEquipment = useMemo(() => buildProgressByEquipment(activePoints), [activePoints]);
  const overallPct = Math.round(averageProgress(activePoints) * 100);

  const groups = useMemo(() => {
    const sorted = [...visiblePoints].sort((a, b) => {
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
  }, [visiblePoints, equipmentById]);

  const issueRows = useMemo(
    () => buildIssueRows(issues, activePoints, equipmentById, { includeClosed: includeClosedIssues }),
    [issues, activePoints, equipmentById, includeClosedIssues]
  );

  const issueGroups = useMemo(() => {
    const sorted = [...issueRows].sort((a, b) => {
      const ta = a.equipment?.tag ?? "";
      const tb = b.equipment?.tag ?? "";
      if (ta !== tb) return ta.localeCompare(tb);
      const pa = a.point.point_number.localeCompare(b.point.point_number);
      // Newest issue first within a point, same as the Issues modal's own list.
      return pa !== 0 ? pa : b.issue.created_at.localeCompare(a.issue.created_at);
    });
    const list: { equipmentId: string; items: typeof issueRows }[] = [];
    for (const row of sorted) {
      const equipmentId = row.point.equipment_id;
      const last = list[list.length - 1];
      if (last && last.equipmentId === equipmentId) last.items.push(row);
      else list.push({ equipmentId, items: [row] });
    }
    return list;
  }, [issueRows]);

  return (
    <div className="view">
      <div className="toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back to Grid
        </button>
        <div className="report-mode-toggle">
          <button
            type="button"
            className={`btn-secondary ${reportMode === "checklist" ? "btn-mode-active" : ""}`}
            onClick={() => setReportMode("checklist")}
          >
            Checklist
          </button>
          <button
            type="button"
            className={`btn-secondary ${reportMode === "issues" ? "btn-mode-active" : ""}`}
            onClick={() => setReportMode("issues")}
          >
            Issues
          </button>
        </div>
        {reportMode === "checklist" ? (
          <>
            <div className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>Status</span>
              {(Object.keys(POINT_STATUS_LABELS) as PointStatus[]).map((s) => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={statusFilter[s]}
                    onChange={(e) => setStatusFilter((prev) => ({ ...prev, [s]: e.target.checked }))}
                  />
                  {POINT_STATUS_LABELS[s]}
                </label>
              ))}
            </div>
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
              <button
                type="button"
                className="icon-btn"
                title="Edit selected name"
                aria-label="Edit selected name"
                disabled={!commissionedBy}
                onClick={() => {
                  const edited = window.prompt("Edit name", commissionedBy)?.trim();
                  if (!edited || edited === commissionedBy) return;
                  const next = commissionedByNames
                    .filter((n) => n !== commissionedBy)
                    .concat(edited)
                    .sort((a, b) => a.localeCompare(b));
                  setCommissionedByNames(next);
                  saveCommissionedByNames(next);
                  setCommissionedBy(edited);
                }}
              >
                ✎
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Remove selected name from the list"
                aria-label="Remove selected name from the list"
                disabled={!commissionedBy}
                onClick={() => {
                  if (!window.confirm(`Remove "${commissionedBy}" from this browser's name list?`)) return;
                  const next = commissionedByNames.filter((n) => n !== commissionedBy);
                  setCommissionedByNames(next);
                  saveCommissionedByNames(next);
                  setCommissionedBy("");
                }}
              >
                🗑
              </button>
            </label>
          </>
        ) : (
          <>
            <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeClosedIssues}
                onChange={(e) => setIncludeClosedIssues(e.target.checked)}
              />
              Include closed issues
            </label>
            <div className="spacer" />
          </>
        )}
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
          {reportMode === "checklist" ? (
            <>
              <span>
                {statusFilterActive
                  ? `${visiblePoints.length} of ${activePoints.length} points shown`
                  : `${activePoints.length} points`}
                , {overallPct}% complete
              </span>
              <span>
                Commissioned By:{" "}
                {commissionedBy ? commissionedBy : <span className="signoff-blank">{" ".repeat(20)}</span>}
              </span>
            </>
          ) : (
            <span>
              {issueRows.length} issue{issueRows.length === 1 ? "" : "s"}
              {includeClosedIssues ? "" : " open"} across{" "}
              {new Set(issueRows.map((r) => r.point.id)).size} point
              {new Set(issueRows.map((r) => r.point.id)).size === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {reportMode === "checklist" ? (
        groups.length === 0 ? (
          <div className="empty-state">No points match the selected status filter.</div>
        ) : (
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
                          {eq?.location ? ` — ${eq.location}` : ""}{" "}
                          <span className="count-pill">{g.items.length}</span>{" "}
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
        )
      ) : issueGroups.length === 0 ? (
        <div className="empty-state">
          {includeClosedIssues
            ? "No issues logged on any active point."
            : 'No open issues. Check "Include closed issues" for a full history.'}
        </div>
      ) : (
        <div className="table-wrap report-table-wrap">
          <table className="data-table report-table">
            <thead>
              <tr>
                <th className="report-col-panel">Panel</th>
                <th className="report-col-point">Point #</th>
                <th className="checklist-name-col">Descriptor</th>
                <th className="report-col-issue-desc divider-left">Issue</th>
                <th className="report-col-issue-desc">Recommended Action</th>
                <th className="report-col-status divider-left">Status</th>
                <th className="report-col-date divider-left">Date Created</th>
                <th className="report-col-date divider-left">Date Closed</th>
                <th className="report-col-issue-desc divider-left">Notes</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {issueGroups.map((g) => {
                const eq = equipmentById[g.equipmentId];
                return (
                  <Fragment key={g.equipmentId}>
                    <tr className="table-group-header">
                      <td colSpan={10}>
                        {eq?.tag ?? g.equipmentId}
                        {eq?.location ? ` — ${eq.location}` : ""}{" "}
                        <span className="issue-count-pill">
                          {g.items.length} issue{g.items.length === 1 ? "" : "s"}
                        </span>
                      </td>
                    </tr>
                    {g.items.map(({ issue, point }) => (
                      <tr key={issue.id}>
                        <td className="report-col-panel">{displayPanel(point.panel)}</td>
                        <td className="report-col-point">{resolvedPointNumber(point)}</td>
                        <td className="truncate checklist-name-col" title={point.descriptor}>
                          {point.descriptor}
                        </td>
                        <td className="report-col-issue-desc divider-left">{issue.description}</td>
                        <td className="report-col-issue-desc">{issue.recommended_action || "—"}</td>
                        <td className="report-col-status divider-left">
                          <span className={`status-pill status-${issue.status}`}>
                            {ISSUE_STATUS_LABELS[issue.status]}
                          </span>
                        </td>
                        <td className="report-col-date divider-left">{formatTimestamp(issue.created_at)}</td>
                        <td className="report-col-date divider-left">
                          {issue.closed_at ? formatTimestamp(issue.closed_at) : "—"}
                        </td>
                        <td className="report-col-issue-desc divider-left">{issue.notes || "—"}</td>
                        <td className="no-print">
                          <button
                            type="button"
                            className="icon-btn"
                            title="Edit this point's issue log"
                            aria-label="Edit issue log"
                            onClick={() => onOpenIssues(point)}
                          >
                            ✎
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
