import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Modal } from "./components/Modal";
import { ImportMdbModal } from "./components/ImportMdbModal";
import { PointsView } from "./views/PointsView";
import { averageProgress } from "./progress";
import { CheckField, CheckState, Equipment, Point, Project } from "./types";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const refreshProjects = async () => {
    const list = await api.list<Project>("projects");
    setProjects(list);
    return list;
  };

  const refreshProjectData = async (id: string) => {
    if (!id) {
      setEquipment([]);
      setPoints([]);
      return;
    }
    const [eq, pts] = await Promise.all([
      api.list<Equipment>("equipment", { project_id: id }),
      api.listPoints<Point>(id),
    ]);
    setEquipment(eq);
    setPoints(pts);
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

  const overallPct = useMemo(() => Math.round(averageProgress(points) * 100), [points]);

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="app-shell">
      <div className="app-header">
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
        <button className="btn-primary" onClick={() => setImporting(true)}>
          Import Access Database
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="app-main">
        <PointsView
          points={points}
          equipment={equipment}
          onSetValue={setPointValue}
          onBulkSetValues={bulkSetPoints}
          onUpdatePoint={updatePoint}
        />
      </div>

      {importing && (
        <Modal title="Import Access Database" onClose={() => setImporting(false)}>
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
