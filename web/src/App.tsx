import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Modal } from "./components/Modal";
import { ImportMdbModal } from "./components/ImportMdbModal";
import { VerifyControllerModal } from "./components/VerifyControllerModal";
import { PointsReport } from "./components/PointsReport";
import { PointsView } from "./views/PointsView";
import { PointsCardList } from "./views/PointsCardList";
import { ProjectDashboard } from "./views/ProjectDashboard";
import { IssuesModal } from "./components/IssuesModal";
import { averageProgress } from "./progress";
import { averageInstallProgress } from "./installProgress";
import { resolvedPointNumber } from "./pointNumber";
import { useIsNarrowViewport } from "./useIsNarrowViewport";
import { CheckField, CheckState, Equipment, InstallCheck, InstallField, Issue, IssueStatus, Point, Project } from "./types";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [installChecks, setInstallChecks] = useState<InstallCheck[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [issuesModalPointId, setIssuesModalPointId] = useState<string | null>(null);
  // Collapsed by default on a narrow header -- these are desk-oriented
  // actions (importing an .mdb, checking against a controller export,
  // printing) rarely needed mid-field-check, so they start out of the way
  // rather than eating vertical space above the checklist.
  const [showActions, setShowActions] = useState(false);

  const refreshProjects = async () => {
    const list = await api.list<Project>("projects");
    setProjects(list);
    return list;
  };

  const refreshProjectData = async (id: string) => {
    if (!id) {
      setEquipment([]);
      setPoints([]);
      setInstallChecks([]);
      setIssues([]);
      return;
    }
    const [eq, pts] = await Promise.all([
      api.list<Equipment>("equipment", { project_id: id }),
      api.listPoints<Point>(id),
    ]);
    setEquipment(eq);
    setPoints(pts);
    const pointIds = pts.map((p) => p.id);
    const [checks, iss] = await Promise.all([
      api.listInstallChecks<InstallCheck>(pointIds),
      api.listIssues<Issue>(pointIds),
    ]);
    setInstallChecks(checks);
    setIssues(iss);
  };

  useEffect(() => {
    (async () => {
      try {
        const list = await refreshProjects();
        const firstId = list[0]?.id ?? "";
        setProjectId(firstId);
        await refreshProjectData(firstId);
      } catch (err: any) {
        setError(err.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const changeProject = async (id: string) => {
    setProjectId(id);
    setError(null);
    try {
      await refreshProjectData(id);
    } catch (err: any) {
      setError(err.message ?? "Failed to load");
    }
  };

  const refreshAll = () => refreshProjectData(projectId).catch(() => {});

  const setPointValue = (pointId: string, field: CheckField, value: CheckState) => {
    setPoints((list) => list.map((p) => (p.id === pointId ? { ...p, [field]: value } : p)));
    api.update<Point>("points", pointId, { [field]: value }).catch(() => refreshAll());
  };

  const bulkSetPoints = (updates: { id: string; field: string; value: string }[]) => {
    setPoints((list) => {
      const byId = new Map(list.map((p) => [p.id, p]));
      for (const u of updates) {
        const p = byId.get(u.id);
        if (p) byId.set(u.id, { ...p, [u.field]: u.value });
      }
      return Array.from(byId.values());
    });
    api.bulkSetPoints(updates).catch(() => refreshAll());
  };

  const updatePoint = (point: Point, patch: Partial<Point>) => {
    setPoints((list) => list.map((p) => (p.id === point.id ? { ...p, ...patch } : p)));
    api.update<Point>("points", point.id, patch).catch(() => refreshAll());
  };

  const setInstallValue = (pointId: string, field: InstallField, value: CheckState) => {
    setInstallChecks((list) => list.map((ic) => (ic.point_id === pointId ? { ...ic, [field]: value } : ic)));
    api.bulkSetInstallChecks([{ id: pointId, field, value }]).catch(() => refreshAll());
  };

  const bulkSetInstallValues = (updates: { id: string; field: string; value: string }[]) => {
    setInstallChecks((list) => {
      const byPointId = new Map(list.map((ic) => [ic.point_id, ic]));
      for (const u of updates) {
        const ic = byPointId.get(u.id);
        if (ic) byPointId.set(u.id, { ...ic, [u.field]: u.value });
      }
      return Array.from(byPointId.values());
    });
    api.bulkSetInstallChecks(updates).catch(() => refreshAll());
  };

  // Not optimistic, unlike the setters above -- this codebase has no
  // client-side temp-id convention (every api.create call site, e.g.
  // addControllerObjectAsPoint, awaits the real row first), so this waits
  // for the created row too rather than inventing one.
  const addIssue = async (pointId: string, description: string, recommendedAction: string) => {
    try {
      const created = await api.create<Issue>("issues", {
        point_id: pointId,
        description,
        recommended_action: recommendedAction,
      });
      setIssues((list) => [...list, created]);
    } catch (err: any) {
      setError(err.message ?? "Failed to add issue");
    }
  };

  const setIssueStatus = (issueId: string, status: IssueStatus) => {
    setIssues((list) => list.map((i) => (i.id === issueId ? { ...i, status } : i)));
    api.update<Issue>("issues", issueId, { status }).catch(() => refreshAll());
  };

  const deletePoint = async (point: Point) => {
    const label = `${resolvedPointNumber(point)}${point.descriptor ? ` — ${point.descriptor}` : ""}`;
    if (!window.confirm(`Delete point ${label}? This cannot be undone.`)) return;
    setPoints((list) => list.filter((p) => p.id !== point.id));
    try {
      await api.remove("points", point.id);
    } catch (err: any) {
      setError(err.message ?? "Failed to delete point");
      refreshAll();
    }
  };

  // A removed/inactive point shouldn't drag these down (or prop them up) --
  // same reasoning PointsView.tsx already applies to its own per-equipment
  // pills, e.g. a renumbered-and-reimported point sitting inactive at 0%
  // shouldn't make an otherwise-100%-complete project read as less than 100%.
  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const overallPct = useMemo(() => Math.round(averageProgress(activePoints) * 100), [activePoints]);
  const installChecksByPointId = useMemo(
    () => new Map(installChecks.map((ic) => [ic.point_id, ic])),
    [installChecks]
  );
  const overallInstallPct = useMemo(
    () => Math.round(averageInstallProgress(activePoints, installChecksByPointId) * 100),
    [activePoints, installChecksByPointId]
  );
  const currentProject = projects.find((p) => p.id === projectId);
  const isNarrowViewport = useIsNarrowViewport(480);

  const deleteProject = async () => {
    if (!projectId) return;
    setDeleting(true);
    try {
      await api.remove("projects", projectId);
      const list = await refreshProjects();
      const nextId = list[0]?.id ?? "";
      setProjectId(nextId);
      await refreshProjectData(nextId);
      setConfirmingDelete(false);
    } catch (err: any) {
      setError(err.message ?? "Failed to delete project");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="app-shell">
      <div className="app-header no-print">
        <div className="app-title">
          <span className="app-logo">◎</span> Commissioning Points
        </div>
        <select className="project-filter" value={projectId} onChange={(e) => changeProject(e.target.value)}>
          {projects.length === 0 && <option value="">No projects yet</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_number ? `${p.project_number} — ${p.name}` : p.name}
            </option>
          ))}
        </select>
        {activePoints.length > 0 && (
          <>
            <span className="progress-pill">Install {overallInstallPct}%</span>
            <span className="progress-pill">Commissioning {overallPct}%</span>
          </>
        )}
        {/* Outside .app-actions-group and never collapsed at narrow widths,
            unlike the desk-bound actions below -- this is a frequently-
            consulted read view, the same tier as switching to the card
            list, not a rare action worth hiding behind "Actions ▾". */}
        <button
          type="button"
          className="btn-secondary"
          disabled={!projectId}
          onClick={() => setShowDashboard(true)}
        >
          Dashboard
        </button>
        <div className="spacer" />
        {isNarrowViewport && (
          <button
            type="button"
            className="btn-secondary mobile-actions-toggle"
            onClick={() => setShowActions((v) => !v)}
          >
            {showActions ? "Hide Actions ▲" : "Actions ▾"}
          </button>
        )}
        <div className={`app-actions-group ${isNarrowViewport && !showActions ? "app-actions-group-collapsed" : ""}`}>
          <button className="btn-danger" disabled={!projectId} onClick={() => setConfirmingDelete(true)}>
            Delete Project
          </button>
          <button className="btn-secondary" disabled={!projectId} onClick={() => setVerifying(true)}>
            Check Against Controller
          </button>
          <button
            className="btn-secondary"
            disabled={!projectId || points.length === 0}
            onClick={() => setPrinting(true)}
          >
            Print Report
          </button>
          <button className="btn-primary" onClick={() => setImporting(true)}>
            Import Access Database
          </button>
        </div>
      </div>

      {error && <div className="error-banner no-print">{error}</div>}

      <div className="app-main">
        {printing && currentProject ? (
          <PointsReport
            project={currentProject}
            equipment={equipment}
            points={points}
            issues={issues}
            onBack={() => setPrinting(false)}
          />
        ) : showDashboard ? (
          <ProjectDashboard
            points={points}
            equipment={equipment}
            installChecks={installChecks}
            issues={issues}
            onSetIssueStatus={setIssueStatus}
            onOpenIssues={(point) => setIssuesModalPointId(point.id)}
            onBack={() => setShowDashboard(false)}
          />
        ) : isNarrowViewport ? (
          <PointsCardList
            points={points}
            equipment={equipment}
            installChecks={installChecks}
            issues={issues}
            onSetValue={setPointValue}
            onSetInstallValue={setInstallValue}
            onUpdatePoint={updatePoint}
            onDeletePoint={deletePoint}
            onOpenIssues={(point) => setIssuesModalPointId(point.id)}
          />
        ) : (
          <PointsView
            points={points}
            equipment={equipment}
            installChecks={installChecks}
            issues={issues}
            onSetValue={setPointValue}
            onBulkSetValues={bulkSetPoints}
            onSetInstallValue={setInstallValue}
            onBulkSetInstallValues={bulkSetInstallValues}
            onUpdatePoint={updatePoint}
            onDeletePoint={deletePoint}
            onOpenIssues={(point) => setIssuesModalPointId(point.id)}
          />
        )}
      </div>

      {confirmingDelete && currentProject && (
        <Modal title="Delete Project" onClose={() => setConfirmingDelete(false)}>
          <p>
            Permanently delete{" "}
            <strong>
              {currentProject.project_number ? `${currentProject.project_number} — ${currentProject.name}` : currentProject.name}
            </strong>
            ? This removes all {equipment.length} equipment and {points.length} points under it, including every
            checklist mark, note, and blocked-by entry. This cannot be undone.
          </p>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-actions">
            <div className="spacer" />
            <button className="btn-secondary" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button className="btn-danger" disabled={deleting} onClick={deleteProject}>
              {deleting ? "Deleting…" : "Delete Project"}
            </button>
          </div>
        </Modal>
      )}

      {verifying && (
        <Modal
          title="Check Against Controller"
          onClose={async () => {
            setVerifying(false);
            // Closing via the X (rather than "Done" below) skipped this
            // refresh before -- any point/equipment added or paired during
            // the reconciliation screen was already saved, but the app's
            // in-memory state (and anything printed from it) stayed stale
            // until the next full reload. Always refresh on close now.
            await refreshProjectData(projectId);
          }}
        >
          <VerifyControllerModal
            projectId={projectId}
            points={points}
            equipment={equipment}
            onCancel={() => setVerifying(false)}
            onDone={async () => {
              setVerifying(false);
              await refreshProjectData(projectId);
            }}
          />
        </Modal>
      )}

      {importing && (
        <Modal
          title="Import Access Database"
          onClose={async () => {
            setImporting(false);
            // Closing via the X (rather than completing the reconciliation
            // screen's own "Done") skipped this refresh before -- an import
            // that deactivated at least one point pauses on that screen, and
            // dismissing it without clicking Done left the app's in-memory
            // points/equipment stale even though the import itself had
            // already been saved to Supabase. Always refresh on close now.
            const list = await refreshProjects();
            const target = projectId && list.some((p) => p.id === projectId) ? projectId : list[0]?.id ?? "";
            setProjectId(target);
            await refreshProjectData(target);
          }}
        >
          <ImportMdbModal
            projects={projects}
            defaultProjectId={projectId || undefined}
            onCancel={() => setImporting(false)}
            onImported={async () => {
              const list = await refreshProjects();
              setImporting(false);
              // Projects are returned newest-first, so if the import created a
              // new project it's list[0]; otherwise stay on the current one.
              const target = projectId && list.some((p) => p.id === projectId) ? projectId : list[0]?.id ?? "";
              setProjectId(target);
              await refreshProjectData(target);
            }}
          />
        </Modal>
      )}

      {issuesModalPointId &&
        (() => {
          const point = points.find((p) => p.id === issuesModalPointId);
          if (!point) return null;
          const eq = equipment.find((e) => e.id === point.equipment_id);
          return (
            <Modal
              title={`Issues — ${resolvedPointNumber(point)}`}
              onClose={() => setIssuesModalPointId(null)}
            >
              <IssuesModal
                point={point}
                equipmentTag={eq?.tag ?? ""}
                issues={issues.filter((i) => i.point_id === point.id)}
                onAdd={addIssue}
                onSetStatus={setIssueStatus}
              />
            </Modal>
          );
        })()}
    </div>
  );
}
