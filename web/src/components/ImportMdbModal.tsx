import { useRef, useState } from "react";
import { api } from "../api";
import { parseAccessFile, ImportResult } from "../mdbImport";
import { Project } from "../types";

const NEW_PROJECT = "__new__";

export function ImportMdbModal({
  projects,
  defaultProjectId,
  onCancel,
  onImported,
}: {
  projects: Project[];
  defaultProjectId?: string;
  onCancel: () => void;
  onImported: () => Promise<void>;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? NEW_PROJECT);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectNumber, setNewProjectNumber] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    try {
      const result = await parseAccessFile(file);
      if (result.points.length === 0) {
        setError("No points found. Check that this is an Engtool-style database with the expected tables.");
      }
      setParsed(result);
    } catch (err: any) {
      setParsed(null);
      setError(err.message ?? "Could not read that file.");
    }
  };

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleImport = async () => {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      let targetProjectId = projectId;
      if (projectId === NEW_PROJECT) {
        if (!newProjectName.trim()) {
          setError("Name the new project before importing.");
          setImporting(false);
          return;
        }
        const project = await api.create<Project>("projects", {
          name: newProjectName.trim(),
          project_number: newProjectNumber.trim(),
        });
        targetProjectId = project.id;
      }
      await api.import(targetProjectId, parsed.equipment, parsed.points);
      await onImported();
    } catch (err: any) {
      setError(err.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const zoneCount = parsed?.equipment.filter((e) => e.equipment_type === "zone").length ?? 0;
  const panelCount = parsed?.equipment.filter((e) => e.equipment_type === "cp_panel").length ?? 0;

  return (
    <div className="form">
      {!fileName && (
        <>
          <p className="muted-text">
            Pick the Engtool Access database (.mdb or .accdb) exported from the BMS panel — the same file the legacy
            checksheet's "Select Engtool Database" dialog opens. It's read entirely in your browser; nothing is
            uploaded anywhere except the point list this produces.
          </p>
          <label>
            Access Database
            <input
              ref={fileInput}
              type="file"
              accept=".mdb,.accdb"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        </>
      )}

      {fileName && (
        <>
          <div className="toolbar">
            <span className="toolbar-label">{fileName}</span>
            {parsed && (
              <span className="count-pill">
                {parsed.equipment.length} equipment / {parsed.points.length} points
              </span>
            )}
            <div className="spacer" />
            <button type="button" className="btn-secondary" onClick={reset}>
              Choose a different file
            </button>
          </div>

          {parsed && parsed.points.length > 0 && (
            <div className="muted-text">
              {panelCount} CP panel group{panelCount === 1 ? "" : "s"} of direct points, {zoneCount} zone/VAV instance
              {zoneCount === 1 ? "" : "s"} expanded from their point-type templates.
            </div>
          )}

          <label>
            Import into project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number ? `${p.project_number} — ${p.name}` : p.name}
                </option>
              ))}
              <option value={NEW_PROJECT}>+ New Project…</option>
            </select>
          </label>

          {projectId === NEW_PROJECT && (
            <div className="form-row" style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1 }}>
                Project Name
                <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
              </label>
              <label style={{ flex: 1 }}>
                Project #
                <input value={newProjectNumber} onChange={(e) => setNewProjectNumber(e.target.value)} />
              </label>
            </div>
          )}
        </>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        <div className="spacer" />
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {parsed && parsed.points.length > 0 && (
          <button type="button" className="btn-primary" disabled={importing} onClick={handleImport}>
            {importing ? "Importing…" : `Import ${parsed.points.length} Points`}
          </button>
        )}
      </div>
    </div>
  );
}
