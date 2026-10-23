import { useMemo, useState } from "react";
import {
  Equipment,
  INSTALL_FIELDS,
  INSTALL_FIELD_LABELS,
  InstallCheck,
  ISSUE_PRIORITY_LABELS,
  Issue,
  IssueStatus,
  Point,
  PointAttribute,
  PointAttributeProject,
  PointAttributeValue,
  POINT_STATUS_LABELS,
  ProjectInstaller,
} from "../types";
import { averageProgress, buildProgressByEquipment } from "../progress";
import {
  averageInstallProgress,
  buildInstallProgressByEquipment,
  installFieldPercent,
  installStatus,
  InstallStatus,
  INSTALL_STATUS_LABELS,
} from "../installProgress";
import { buildActiveIssueRows, buildOpenIssueCountByEquipment, groupIssuesByPointId, openIssueCount } from "../issues";
import { attributesForProject, buildAttributeValueMap } from "../pointAttributes";
import { PointGroup, usePointRows } from "../usePointRows";
import { resolvedPointNumber } from "../pointNumber";
import { fromLoginEmail } from "../username";

// A project-wide rollup, not a narrowed working view like the grid/mobile
// card list -- same architectural slot as PointsReport.tsx, a purpose-built
// screen rather than a responsive reflow of one of the others. Reuses
// usePointRows() (showRemoved: false, no other filters) instead of
// reinventing equipment-grouping a third time.
export function ProjectDashboard({
  projectId,
  points,
  equipment,
  installChecks,
  issues,
  pointAttributes,
  pointAttributeProjects,
  pointAttributeValues,
  projectInstallers,
  onSetIssueStatus,
  onOpenIssues,
  onInviteInstaller,
  onRevokeInstaller,
  onBack,
  installerView = false,
}: {
  projectId: string;
  points: Point[];
  equipment: Equipment[];
  installChecks: InstallCheck[];
  issues: Issue[];
  pointAttributes: PointAttribute[];
  pointAttributeProjects: PointAttributeProject[];
  pointAttributeValues: PointAttributeValue[];
  projectInstallers: ProjectInstaller[];
  onSetIssueStatus: (issueId: string, status: IssueStatus) => void;
  onOpenIssues: (point: Point) => void;
  onInviteInstaller: (email: string) => Promise<void>;
  onRevokeInstaller: (email: string) => void;
  onBack: () => void;
  // Same restriction as the points grid/cards: an installer sees this same
  // Dashboard, just with every Commissioning-specific number swapped for
  // its Install counterpart -- the two-column equipment breakdown groups
  // by Install completion instead of Commissioning status, and per-point
  // status pills show Install status instead of Commissioning status. The
  // Installers panel itself (inviting other installers) also only makes
  // sense for an owner/admin, so it's hidden too.
  installerView?: boolean;
}) {
  // Collapsed by default -- same reasoning as every other rarely-needed
  // toolbar section in this app (Actions ▾, Filters ▾): inviting an
  // installer is a once-in-a-while admin action, not something that should
  // eat vertical space above the project rollup every time you open it.
  const [showInstallers, setShowInstallers] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      await onInviteInstaller(inviteUsername.trim());
      setInviteUsername("");
    } catch (err: any) {
      setInviteError(err.message ?? "Failed to invite installer");
    } finally {
      setInviting(false);
    }
  };
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

  const projectAttrs = useMemo(
    () => attributesForProject(pointAttributes, pointAttributeProjects, projectId),
    [pointAttributes, pointAttributeProjects, projectId]
  );
  const attrValueMap = useMemo(() => buildAttributeValueMap(pointAttributeValues), [pointAttributeValues]);

  const overallPct = Math.round(averageProgress(activePoints, projectAttrs, attrValueMap) * 100);
  const overallInstallPct = Math.round(averageInstallProgress(activePoints, installChecksByPointId) * 100);
  // One tile per Install field -- which specific activity (piping vs. end-
  // to-end checkout, say) is actually lagging, not just the blended
  // overallInstallPct average above.
  const installFieldPercents = useMemo(
    () => INSTALL_FIELDS.map((field) => ({ field, pct: installFieldPercent(activePoints, installChecksByPointId, field) })),
    [activePoints, installChecksByPointId]
  );
  const progressByEquipment = useMemo(
    () => buildProgressByEquipment(activePoints, projectAttrs, attrValueMap),
    [activePoints, projectAttrs, attrValueMap]
  );
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
        if (a.issue.priority !== b.issue.priority) return a.issue.priority === "urgent" ? -1 : 1;
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

  // Installer counterpart to the Commissioning split above -- same exact-
  // match-against-status shape, just keyed by each point's Install status
  // instead. Only computed/rendered when installerView, but cheap enough
  // not to bother gating the computation itself.
  const installCompleteGroups = groups.filter((g) =>
    g.items.every((p) => installStatus(installChecksByPointId.get(p.id)) === "complete")
  );
  const installIncompleteGroups = groups.filter(
    (g) => !g.items.every((p) => installStatus(installChecksByPointId.get(p.id)) === "complete")
  );

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

  // Install-status counterpart to pointStatusCounts above.
  const pointInstallStatusCounts = (pts: Point[]) => {
    const counts: Record<InstallStatus, number> = { not_started: 0, in_progress: 0, complete: 0 };
    for (const p of pts) counts[installStatus(installChecksByPointId.get(p.id))]++;
    return counts;
  };
  const installIncompleteStatusCounts = useMemo(
    () => pointInstallStatusCounts(installIncompleteGroups.flatMap((g) => g.items)),
    [installIncompleteGroups, installChecksByPointId]
  );
  const installCompleteStatusCounts = useMemo(
    () => pointInstallStatusCounts(installCompleteGroups.flatMap((g) => g.items)),
    [installCompleteGroups, installChecksByPointId]
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
          {!installerView && (
            <span className={`progress-pill ${pct > 90 ? "progress-pill-high" : pct < 10 ? "progress-pill-low" : ""}`}>
              Commissioning {pct}%
            </span>
          )}
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
                  <span>{resolvedPointNumber(point)}</span>
                  <span className="dashboard-point-descriptor">{point.descriptor}</span>
                  {installerView ? (
                    <span className={`status-pill status-${installStatus(installChecksByPointId.get(point.id))}`}>
                      {INSTALL_STATUS_LABELS[installStatus(installChecksByPointId.get(point.id))]}
                    </span>
                  ) : (
                    <span className={`status-pill status-${point.status}`}>{POINT_STATUS_LABELS[point.status]}</span>
                  )}
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
        {!installerView && (
          <button type="button" className="btn-secondary" onClick={() => setShowInstallers((v) => !v)}>
            {showInstallers ? "Hide Installers ▲" : `Installers (${projectInstallers.length}) ▾`}
          </button>
        )}
      </div>

      {!installerView && showInstallers && (
        <div className="dashboard-installers">
          <form className="form-row" style={{ display: "flex", gap: 8 }} onSubmit={handleInvite}>
            <input
              type="text"
              placeholder="username"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-primary" disabled={inviting}>
              {inviting ? "Inviting…" : "Invite"}
            </button>
          </form>
          {inviteError && <div className="error-banner">{inviteError}</div>}
          {projectInstallers.length === 0 ? (
            <div className="muted-text">No installers invited to this project yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <tbody>
                  {projectInstallers.map((pi) => (
                    <tr key={pi.email}>
                      <td>{fromLoginEmail(pi.email)}</td>
                      <td>
                        <span className={`status-pill ${pi.user_id ? "status-commissioned" : "status-not_started"}`}>
                          {pi.user_id ? "Active" : "Pending"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Revoke access"
                          aria-label="Revoke access"
                          onClick={() => {
                            if (window.confirm(`Remove ${fromLoginEmail(pi.email)}'s access to this project?`))
                              onRevokeInstaller(pi.email);
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="dashboard-summary">
        <span className="toolbar-label">
          {installerView
            ? `${installCompleteGroups.length} of ${groups.length} equipment installed`
            : `${commissionedGroups.length} of ${groups.length} equipment commissioned`}
        </span>
        <span className="progress-pill">Install {overallInstallPct}%</span>
        {!installerView && <span className="progress-pill">Commissioning {overallPct}%</span>}
        {activeIssueRows.length > 0 && (
          <span className="issue-count-pill">
            <span className="issue-icon">!</span> {activeIssueRows.length} open issue
            {activeIssueRows.length === 1 ? "" : "s"} project-wide
          </span>
        )}
      </div>

      {groups.length > 0 && (
        <div className="install-field-tiles-section">
          <div className="section-label">Install Progress by Activity</div>
          <div className="install-field-tiles">
            {installFieldPercents.map(({ field, pct }) => (
              <div key={field} className="install-field-tile">
                <div className="install-field-tile-label">{INSTALL_FIELD_LABELS[field]}</div>
                <div className={`install-field-tile-pct ${pct > 90 ? "progress-pill-high" : pct < 10 ? "progress-pill-low" : ""}`}>
                  {pct}%
                </div>
                <div className="install-field-tile-track">
                  <div
                    className={`install-field-tile-fill ${pct > 90 ? "install-field-tile-fill-high" : pct < 10 ? "install-field-tile-fill-low" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">No points yet.</div>
      ) : (
        <div className="dashboard-columns">
          {installerView ? (
            <>
              <div className="dashboard-column">
                <div className="dashboard-column-header">
                  Install Incomplete ({installIncompleteGroups.length})
                  {installIncompleteGroups.length > 0 && (
                    <span className="dashboard-column-header-detail">
                      — {installIncompleteStatusCounts.complete} Complete,{" "}
                      {installIncompleteStatusCounts.in_progress} In Progress,{" "}
                      {installIncompleteStatusCounts.not_started} Not Started
                    </span>
                  )}
                </div>
                {installIncompleteGroups.length === 0 ? (
                  <div className="empty-state">Every device is fully installed.</div>
                ) : (
                  installIncompleteGroups.map(renderEquipmentRow)
                )}
              </div>
              <div className="dashboard-column">
                <div className="dashboard-column-header">
                  Install Complete ({installCompleteGroups.length})
                  {installCompleteGroups.length > 0 && (
                    <span className="dashboard-column-header-detail">
                      — {installCompleteStatusCounts.complete} points installed
                    </span>
                  )}
                </div>
                {installCompleteGroups.length === 0 ? (
                  <div className="empty-state">No devices fully installed yet.</div>
                ) : (
                  installCompleteGroups.map(renderEquipmentRow)
                )}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
          <div className="dashboard-column dashboard-issues-panel">
            <div className="dashboard-column-header">Active Issues ({sortedActiveIssueRows.length})</div>
            {sortedActiveIssueRows.length === 0 ? (
              <div className="empty-state">No open issues.</div>
            ) : (
              sortedActiveIssueRows.map(({ issue, point, equipment: eq }) => (
                <div key={issue.id} className="dashboard-issue-row">
                  <button type="button" className="dashboard-issue-row-main" onClick={() => onOpenIssues(point)}>
                    <span>
                      {resolvedPointNumber(point)} {point.descriptor}
                      {issue.priority === "urgent" && (
                        <span className="status-pill priority-urgent">{ISSUE_PRIORITY_LABELS.urgent}</span>
                      )}
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
