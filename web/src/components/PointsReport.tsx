import { Fragment, useMemo, useState } from "react";
import {
  CHECK_FIELDS,
  CHECK_FIELD_LABELS,
  CheckState,
  Equipment,
  INSTALL_FIELDS,
  INSTALL_FIELD_LABELS,
  InstallCheck,
  ISSUE_STATUS_LABELS,
  Issue,
  Point,
  POINT_STATUS_LABELS,
  PointAttribute,
  PointAttributeProject,
  PointAttributeValue,
  PointStatus,
  Project,
} from "../types";
import { buildProgressByEquipment, averageProgress } from "../progress";
import {
  averageInstallProgress,
  buildInstallProgressByEquipment,
  installStatus,
  InstallStatus,
  INSTALL_STATUS_LABELS,
} from "../installProgress";
import { buildIssueRows, groupIssuesByPointId, openIssueCount } from "../issues";
import { attributesForProject, buildAttributeValueMap, getAttributeValue, isAttrValueNA, ATTR_NA_DISPLAY } from "../pointAttributes";
import { resolvedPointNumber, displayPanel } from "../pointNumber";
import { formatDateCommissioned, formatTimestamp } from "../formatDate";
import { exportCommissioningXlsx, exportInstallXlsx, exportIssuesXlsx } from "../exportXlsx";

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
  installChecks,
  issues,
  pointAttributes,
  pointAttributeProjects,
  pointAttributeValues,
  onOpenIssues,
  onBack,
}: {
  project: Project;
  equipment: Equipment[];
  points: Point[];
  installChecks: InstallCheck[];
  issues: Issue[];
  pointAttributes: PointAttribute[];
  pointAttributeProjects: PointAttributeProject[];
  pointAttributeValues: PointAttributeValue[];
  onOpenIssues: (point: Point) => void;
  onBack: () => void;
}) {
  // "Commissioning" and "Install" are the two handoff checklists the live
  // grid already shows side by side (see "Two checklists, one grid" in
  // README.md); "Issues" is a third, differently-shaped report over the
  // same project data (a punch list, not a per-field grid) -- one mode
  // toggle here instead of three separate print flows/header buttons,
  // since all three need the same project data and print CSS and none
  // needs its own screen.
  const [reportMode, setReportMode] = useState<"commissioning" | "install" | "issues">("commissioning");
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
  // Mirrors statusFilter above, but keyed by InstallStatus for the Install
  // mode's own status filter -- a manager wanting "what's remaining" on
  // Install unchecks Complete independently of whatever the Commissioning
  // filter is set to.
  const [installStatusFilter, setInstallStatusFilter] = useState<Record<InstallStatus, boolean>>({
    not_started: true,
    in_progress: true,
    complete: true,
  });
  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const visiblePoints = useMemo(() => activePoints.filter((p) => statusFilter[p.status]), [activePoints, statusFilter]);
  const statusFilterActive = !statusFilter.not_started || !statusFilter.in_progress || !statusFilter.commissioned;
  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment]);

  const installChecksByPointId = useMemo(
    () => new Map(installChecks.map((ic) => [ic.point_id, ic])),
    [installChecks]
  );
  const installVisiblePoints = useMemo(
    () => activePoints.filter((p) => installStatusFilter[installStatus(installChecksByPointId.get(p.id))]),
    [activePoints, installChecksByPointId, installStatusFilter]
  );
  const installStatusFilterActive =
    !installStatusFilter.not_started || !installStatusFilter.in_progress || !installStatusFilter.complete;
  const installProgressByEquipment = useMemo(
    () => buildInstallProgressByEquipment(activePoints, installChecksByPointId),
    [activePoints, installChecksByPointId]
  );
  const overallInstallPct = Math.round(averageInstallProgress(activePoints, installChecksByPointId) * 100);
  const installGroups = useMemo(() => {
    const sorted = [...installVisiblePoints].sort((a, b) => {
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
  }, [installVisiblePoints, equipmentById]);

  // Custom attribute columns, printed after the fixed checklist fields --
  // every attribute assigned to this project, unconditionally (not only
  // ones with data among the visible points), matching EnteliWEB's own
  // unconditional column behavior. Computed before progressByEquipment/
  // overallPct below since both now factor attributes into % Completed too.
  const attrs = useMemo(
    () => attributesForProject(pointAttributes, pointAttributeProjects, project.id),
    [pointAttributes, pointAttributeProjects, project.id]
  );
  const attrValueMap = useMemo(() => buildAttributeValueMap(pointAttributeValues), [pointAttributeValues]);

  const progressByEquipment = useMemo(
    () => buildProgressByEquipment(activePoints, attrs, attrValueMap),
    [activePoints, attrs, attrValueMap]
  );
  const overallPct = Math.round(averageProgress(activePoints, attrs, attrValueMap) * 100);

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

  // Checklist mode's own flag, separate from the Issues-mode punch list above
  // -- a supervisor reading just the Checklist table still gets a visual cue
  // that a point needs issue-log attention, same "!" the live grid/mobile
  // view already show next to Blocked By.
  const issuesByPointId = useMemo(() => groupIssuesByPointId(issues), [issues]);

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

  // Writes the same data the on-screen/printed table is showing right now
  // (same filters, same grouping, same colors) into an .xlsx workbook --
  // see exportXlsx.ts, which mirrors this component's three render branches
  // cell by cell rather than flattening them into a plain data dump.
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const handleExportXlsx = async () => {
    setExportingXlsx(true);
    try {
      const generatedLabel = `Generated ${new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`;
      if (reportMode === "commissioning") {
        await exportCommissioningXlsx({
          project,
          groups,
          equipmentById,
          progressByEquipment,
          attrs,
          attrValueMap,
          issuesByPointId,
          hideDateCommissioned,
          generatedLabel,
          pointsShownLabel: `${
            statusFilterActive ? `${visiblePoints.length} of ${activePoints.length} points shown` : `${activePoints.length} points`
          }, ${overallPct}% complete`,
          commissionedBy,
        });
      } else if (reportMode === "install") {
        await exportInstallXlsx({
          project,
          groups: installGroups,
          equipmentById,
          installProgressByEquipment,
          installChecksByPointId,
          issuesByPointId,
          generatedLabel,
          pointsShownLabel: `${
            installStatusFilterActive
              ? `${installVisiblePoints.length} of ${activePoints.length} points shown`
              : `${activePoints.length} points`
          }, ${overallInstallPct}% complete`,
        });
      } else {
        await exportIssuesXlsx({
          project,
          groups: issueGroups,
          equipmentById,
          generatedLabel,
          issuesCountLabel: `${issueRows.length} issue${issueRows.length === 1 ? "" : "s"}${
            includeClosedIssues ? "" : " open"
          } across ${new Set(issueRows.map((r) => r.point.id)).size} point${
            new Set(issueRows.map((r) => r.point.id)).size === 1 ? "" : "s"
          }`,
        });
      }
    } finally {
      setExportingXlsx(false);
    }
  };

  return (
    <div className="view">
      <div className="toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back to Grid
        </button>
        <div className="report-mode-toggle">
          <button
            type="button"
            className={`btn-secondary ${reportMode === "install" ? "btn-mode-active" : ""}`}
            onClick={() => setReportMode("install")}
          >
            Install
          </button>
          <button
            type="button"
            className={`btn-secondary ${reportMode === "commissioning" ? "btn-mode-active" : ""}`}
            onClick={() => setReportMode("commissioning")}
          >
            Commissioning
          </button>
          <button
            type="button"
            className={`btn-secondary ${reportMode === "issues" ? "btn-mode-active" : ""}`}
            onClick={() => setReportMode("issues")}
          >
            Issues
          </button>
        </div>
        {reportMode === "commissioning" ? (
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
        ) : reportMode === "install" ? (
          <>
            <div className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>Status</span>
              {(Object.keys(INSTALL_STATUS_LABELS) as InstallStatus[]).map((s) => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={installStatusFilter[s]}
                    onChange={(e) => setInstallStatusFilter((prev) => ({ ...prev, [s]: e.target.checked }))}
                  />
                  {INSTALL_STATUS_LABELS[s]}
                </label>
              ))}
            </div>
            <div className="spacer" />
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
        <button type="button" className="btn-secondary" disabled={exportingXlsx} onClick={handleExportXlsx}>
          {exportingXlsx ? "Exporting…" : "Export XLS"}
        </button>
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
          {reportMode === "commissioning" ? (
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
          ) : reportMode === "install" ? (
            <span>
              {installStatusFilterActive
                ? `${installVisiblePoints.length} of ${activePoints.length} points shown`
                : `${activePoints.length} points`}
              , {overallInstallPct}% complete
            </span>
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

      {reportMode === "commissioning" ? (
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
                  {attrs.map((a) => (
                    <th
                      key={a.id}
                      className={a.attr_type === "boolean" ? "checklist-item-header" : "report-col-attr-text"}
                    >
                      {a.short_text || a.name}
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
                        <td colSpan={3 + CHECK_FIELDS.length + attrs.length + (hideDateCommissioned ? 3 : 4)}>
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
                          {attrs.map((a) => {
                            const value = getAttributeValue(attrValueMap, point.id, a.id);
                            return a.attr_type === "boolean" ? (
                              <td key={a.id} className={`checklist-cell checklist-${value || "empty"}`}>
                                {SYMBOL[value as CheckState]}
                              </td>
                            ) : (
                              <td
                                key={a.id}
                                className={`report-col-attr-text truncate ${isAttrValueNA(value) ? "attr-value-na" : ""}`}
                                title={value}
                              >
                                {isAttrValueNA(value) ? ATTR_NA_DISPLAY : value}
                              </td>
                            );
                          })}
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
                          <td className="report-col-blocked">
                            {(() => {
                              const openCount = openIssueCount(issuesByPointId.get(point.id));
                              return (
                                openCount > 0 && (
                                  <span className="issue-count-pill-danger">
                                    <span className="issue-icon">!</span> {openCount} open issue
                                    {openCount === 1 ? "" : "s"}
                                  </span>
                                )
                              );
                            })()}{" "}
                            {point.blocked_by || "—"}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : reportMode === "install" ? (
        installGroups.length === 0 ? (
          <div className="empty-state">No points match the selected status filter.</div>
        ) : (
          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th className="report-col-panel">Panel</th>
                  <th className="report-col-point">Point #</th>
                  <th className="checklist-name-col">Descriptor</th>
                  {INSTALL_FIELDS.map((f) => (
                    <th key={f} className="checklist-item-header">
                      {INSTALL_FIELD_LABELS[f]}
                    </th>
                  ))}
                  <th className="report-col-status divider-left">Status</th>
                  <th className="report-col-notes divider-left">Notes</th>
                  <th className="report-col-blocked">Blocked By</th>
                </tr>
              </thead>
              <tbody>
                {installGroups.map((g) => {
                  const eq = equipmentById[g.equipmentId];
                  const pct = installProgressByEquipment.get(g.equipmentId) ?? 0;
                  return (
                    <Fragment key={g.equipmentId}>
                      <tr className="table-group-header">
                        <td colSpan={3 + INSTALL_FIELDS.length + 3}>
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
                      {g.items.map((point) => {
                        const check = installChecksByPointId.get(point.id);
                        const status = installStatus(check);
                        return (
                          <tr key={point.id}>
                            <td className="report-col-panel">{displayPanel(point.panel)}</td>
                            <td className="report-col-point">{resolvedPointNumber(point)}</td>
                            <td className="truncate checklist-name-col" title={point.descriptor}>
                              {point.descriptor}
                            </td>
                            {INSTALL_FIELDS.map((field) => {
                              const value = check ? check[field] : "";
                              return (
                                <td key={field} className={`checklist-cell checklist-${value || "empty"}`}>
                                  {SYMBOL[value]}
                                </td>
                              );
                            })}
                            <td className="report-col-status divider-left">
                              <span className={`status-pill status-${status}`}>{INSTALL_STATUS_LABELS[status]}</span>
                            </td>
                            <td className="report-col-notes divider-left">{point.notes || "—"}</td>
                            <td className="report-col-blocked">
                              {(() => {
                                const openCount = openIssueCount(issuesByPointId.get(point.id));
                                return (
                                  openCount > 0 && (
                                    <span className="issue-count-pill-danger">
                                      <span className="issue-icon">!</span> {openCount} open issue
                                      {openCount === 1 ? "" : "s"}
                                    </span>
                                  )
                                );
                              })()}{" "}
                              {point.blocked_by || "—"}
                            </td>
                          </tr>
                        );
                      })}
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
