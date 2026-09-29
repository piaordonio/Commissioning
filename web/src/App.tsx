import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Modal } from "./components/Modal";
import { ImportMdbModal } from "./components/ImportMdbModal";
import { VerifyControllerModal } from "./components/VerifyControllerModal";
import { PointsReport } from "./components/PointsReport";
import { PointsView } from "./views/PointsView";
import { averageProgress } from "./progress";
import { resolvedPointNumber } from "./pointNumber";
import { CheckField, CheckState, Equipment, InstallCheck, InstallField, Point, Project } from "./types";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [installChecks, setInstallChecks] = useState<InstallCheck[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      return;
    }
    const [eq, pts] = await Promise.all([
      api.list<Equipment>("equipment", { project_id: id }),
      api.listPoints<Point>(id),
    ]);
    setEquipment(eq);
    setPoints(pts);
    setInstallChecks(await api.listInstallChecks<InstallCheck>(pts.map((p) => p.id)));
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

  const overallPct = useMemo(() => Math.round(averageProgress(points) * 100), [points]);
  const currentProject = projects.find((p) => p.id === projectId);

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
        {points.length > 0 && <span className="progress-pill">{overallPct}% complete</span>}
        <div className="spacer" />
        <button className="btn-danger" disabled={!projectId} onClick={() => setConfirmingDelete(true)}>
          Delete Project
        </button>
        <button className="btn-secondary" disabled={!projectId} onClick={() => setVerifying(true)}>
          Check Against Controller
        </button>
        <button className="btn-secondary" disabled={!projectId || points.length === 0} onClick={() => setPrinting(true)}>
          Print Report
        </button>
        <button className="btn-primary" onClick={() => setImporting(true)}>
          Import Access Database
        </button>
      </div>

      {error && <div className="error-banner no-print">{error}</div>}

      <div className="app-main">
        {printing && currentProject ? (
          <PointsReport project={currentProject} equipment={equipment} points={points} onBack={() => setPrinting(false)} />
        ) : (
          <PointsView
            points={points}
            equipment={equipment}
            installChecks={installChecks}
            onSetValue={setPointValue}
            onBulkSetValues={bulkSetPoints}
            onSetInstallValue={setInstallValue}
            onBulkSetInstallValues={bulkSetInstallValues}
            onUpdatePoint={updatePoint}
            onDeletePoint={deletePoint}
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
    </div>
  );
}
