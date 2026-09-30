import { useMemo, useState } from "react";
import { Equipment, InstallCheck, Issue, IssueStatus, Point, POINT_STATUS_LABELS } from "../types";
import { averageProgress, buildProgressByEquipment } from "../progress";
import { averageInstallProgress, buildInstallProgressByEquipment } from "../installProgress";
import { buildActiveIssueRows, buildOpenIssueCountByEquipment, groupIssuesByPointId, openIssueCount } from "../issues";
import { PointGroup, usePointRows } from "../usePointRows";
import { resolvedPointNumber } from "../pointNumber";

// A project-wide rollup, not a narrowed working view like the grid/mobile
// card list -- same architectural slot as PointsReport.tsx, a purpose-built
// screen rather than a responsive reflow of one of the others. Reuses
// usePointRows() (showRemoved: false, no other filters) instead of
// reinventing equipment-grouping a third time.
export function ProjectDashboard({
  points,
  equipment,
  installChecks,
  issues,
  onSetIssueStatus,
  onOpenIssues,
  onBack,
}: {
  points: Point[];
  equipment: Equipment[];
  installChecks: InstallCheck[];
  issues: Issue[];
  onSetIssueStatus: (issueId: string, status: IssueStatus) => void;
  onOpenIssues: (point: Point) => void;
  onBack: () => void;
}) {
  // Independent per-equipment expand, same Set-based pattern PointsCardList.tsx
  // already uses for its per-point cards.
  const [expandedEquipmentIds, setExpandedEquipmentIds] = useState<Set<string>>(new Set());
  const toggleEquipment = (id: string) => {
    setExpandedEquipmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const installChecksByPointId = useMemo(
    () => new Map(installChecks.map((ic) => [ic.point_id, ic])),
    [installChecks]
  );
  const issuesByPointId = useMemo(() => groupIssuesByPointId(issues), [issues]);

  const { equipmentById, activePoints, groups } = usePointRows(points, equipment, installChecksByPointId, {
    showRemoved: false,
    panelFilter: "",
    statusFilter: "",
    installStatusFilter: "",
    search: "",
  });

  const overallPct = Math.round(averageProgress(activePoints) * 100);
  const overallInstallPct = Math.round(averageInstallProgress(activePoints, installChecksByPointId) * 100);
  const progressByEquipment = useMemo(() => buildProgressByEquipment(activePoints), [activePoints]);
  const installProgressByEquipment = useMemo(
    () => buildInstallProgressByEquipment(activePoints, installChecksByPointId),
    [activePoints, installChecksByPointId]
  );
  const openIssueCountByEquipment = useMemo(
    () => buildOpenIssueCountByEquipment(activePoints, issuesByPointId),
    [activePoints, issuesByPointId]
  );
  const activeIssueRows = useMemo(
    () => buildActiveIssueRows(issues, activePoints, equipmentById),
    [issues, activePoints, equipmentById]
  );
  const sortedActiveIssueRows = useMemo(
    () =>
      [...activeIssueRows].sort((a, b) => {
        const ta = a.equipment?.tag ?? "";
        const tb = b.equipment?.tag ?? "";
        return ta === tb ? a.point.point_number.localeCompare(b.point.point_number) : ta.localeCompare(tb);
      }),
    [activeIssueRows]
  );

  // Exact check against status, not a rounded percentage -- a
  // 99%-but-not-100% device shouldn't land in "Commissioned".
  const commissionedGroups = groups.filter((g) => g.items.every((p) => p.status === "commissioned"));
  const notCommissionedGroups = groups.filter((g) => !g.items.every((p) => p.status === "commissioned"));

  // Same per-point status breakdown the grid's toolbar already shows, but
  // scoped to each column rather than one project-wide line -- "Not
  // Commissioned" groups equipment that isn't fully done, but its
  // individual points can still be a mix of all three statuses; this says
  // how close. "Commissioned" is tautologically all-commissioned at the
  // point level (every point in a fully-commissioned equipment group is
  // commissioned by the same exact check used to sort it into this
  // column), so its line mainly confirms the point count.
  const pointStatusCounts = (pts: Point[]) => {
    const counts = { not_started: 0, in_progress: 0, commissioned: 0 };
    for (const p of pts) counts[p.status]++;
    return counts;
  };
  const notCommissionedStatusCounts = useMemo(
    () => pointStatusCounts(notCommissionedGroups.flatMap((g) => g.items)),
    [notCommissionedGroups]
  );
  const commissionedStatusCounts = useMemo(
    () => pointStatusCounts(commissionedGroups.flatMap((g) => g.items)),
    [commissionedGroups]
  );

  const renderEquipmentRow = (g: PointGroup) => {
    const eq = equipmentById[g.equipmentId];
    const pct = progressByEquipment.get(g.equipmentId) ?? 0;
    const installPct = installProgressByEquipment.get(g.equipmentId) ?? 0;
    const issueCount = openIssueCountByEquipment.get(g.equipmentId) ?? 0;
    const isExpanded = expandedEquipmentIds.has(g.equipmentId);
    return (
      <div key={g.equipmentId} className="dashboard-equipment-row-wrap">
        <button
          type="button"
          className="dashboard-equipment-row"
          aria-expanded={isExpanded}
          onClick={() => toggleEquipment(g.equipmentId)}
        >
          <span className="dashboard-equipment-tag">
            {eq?.tag ?? g.equipmentId}
            {eq?.location ? ` — ${eq.location}` : ""}
          </span>
          <span className="count-pill">{g.items.length}</span>
          <span
            className={`progress-pill ${
              installPct > 90 ? "progress-pill-high" : installPct < 10 ? "progress-pill-low" : ""
            }`}
          >
            Install {installPct}%
          </span>
          <span className={`progress-pill ${pct > 90 ? "progress-pill-high" : pct < 10 ? "progress-pill-low" : ""}`}>
            Commissioning {pct}%
          </span>
          {issueCount > 0 && (
            <span className="issue-count-pill">
              <span className="issue-icon">!</span> {issueCount} open issue{issueCount === 1 ? "" : "s"}
            </span>
          )}
          <span className="mobile-point-chevron" aria-hidden="true">
            {isExpanded ? "▲" : "▾"}
          </span>
        </button>
        {isExpanded && (
          <div className="dashboard-equipment-points">
            {g.items.map((point) => {
              const openCount = openIssueCount(issuesByPointId.get(point.id));
              return (
                <div key={point.id} className="dashboard-point-row">
                  <span className="mono">{resolvedPointNumber(point)}</span>
                  <span className="dashboard-point-descriptor">{point.descriptor}</span>
                  <span className={`status-pill status-${point.status}`}>{POINT_STATUS_LABELS[point.status]}</span>
                  <button
                    type="button"
                    className={`icon-btn issue-flag ${openCount > 0 ? "issue-flag-active" : ""}`}
                    title={
                      openCount > 0
                        ? `${openCount} open issue${openCount === 1 ? "" : "s"}`
                        : "No open issues — click to add one"
                    }
                    aria-label="Issues"
                    onClick={() => onOpenIssues(point)}
                  >
                    {openCount > 0 ? `! ${openCount}` : "⚑"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="view dashboard-view">
      <div className="toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back to Points
        </button>
        <div className="spacer" />
      </div>

      <div className="dashboard-summary">
        <span className="toolbar-label">
          {commissionedGroups.length} of {groups.length} equipment commissioned
        </span>
        <span className="progress-pill">Install {overallInstallPct}%</span>
        <span className="progress-pill">Commissioning {overallPct}%</span>
        {activeIssueRows.length > 0 && (
          <span className="issue-count-pill">
            <span className="issue-icon">!</span> {activeIssueRows.length} open issue
            {activeIssueRows.length === 1 ? "" : "s"} project-wide
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">No points yet.</div>
      ) : (
        <div className="dashboard-columns">
          <div className="dashboard-column">
            <div className="dashboard-column-header">
              Not Commissioned ({notCommissionedGroups.length})
              {notCommissionedGroups.length > 0 && (
                <span className="dashboard-column-header-detail">
                  — {notCommissionedStatusCounts.commissioned} Commissioned,{" "}
                  {notCommissionedStatusCounts.in_progress} In Progress,{" "}
                  {notCommissionedStatusCounts.not_started} Not Started
                </span>
              )}
            </div>
            {notCommissionedGroups.length === 0 ? (
              <div className="empty-state">Every device is fully commissioned.</div>
            ) : (
              notCommissionedGroups.map(renderEquipmentRow)
            )}
          </div>
          <div className="dashboard-column">
            <div className="dashboard-column-header">
              Commissioned ({commissionedGroups.length})
              {commissionedGroups.length > 0 && (
                <span className="dashboard-column-header-detail">
                  — {commissionedStatusCounts.commissioned} points commissioned
                </span>
              )}
            </div>
            {commissionedGroups.length === 0 ? (
              <div className="empty-state">No devices fully commissioned yet.</div>
            ) : (
              commissionedGroups.map(renderEquipmentRow)
            )}
          </div>
          <div className="dashboard-column dashboard-issues-panel">
            <div className="dashboard-column-header">Active Issues ({sortedActiveIssueRows.length})</div>
            {sortedActiveIssueRows.length === 0 ? (
              <div className="empty-state">No open issues.</div>
            ) : (
              sortedActiveIssueRows.map(({ issue, point, equipment: eq }) => (
                <div key={issue.id} className="dashboard-issue-row">
                  <button type="button" className="dashboard-issue-row-main" onClick={() => onOpenIssues(point)}>
                    <span>
                      <span className="mono">{resolvedPointNumber(point)}</span> {point.descriptor}
                    </span>
                    <span className="muted-text">{eq?.tag ?? ""}</span>
                    <div className="issue-description">{issue.description}</div>
                    {issue.recommended_action && (
                      <div className="issue-recommended-action">
                        <span className="muted-text">Recommended: </span>
                        {issue.recommended_action}
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onSetIssueStatus(issue.id, "closed")}
                  >
                    Close
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* A "Commissioning Activity" trend chart (points/issues over time) is
          explicitly out of scope for this pass -- a natural follow-up, not
          built now. */}
    </div>
  );
}
