import { useRef, useState } from "react";
import { api } from "../api";
import { ParsedBackup, parseProjectBackupWorkbook } from "../backup";
import { Project } from "../types";

// Always creates a brand-new project -- never offers to restore on top of
// an existing one. Deliberately simpler than ImportMdbModal.tsx's "import
// into project" dropdown for exactly that reason: there's no destination
// to pick, so there's nothing to get wrong. Worst case after a mistaken
// restore is an extra project to delete, never a live one silently
// overwritten.
export function RestoreBackupModal({
  onCancel,
  onRestored,
}: {
  onCancel: () => void;
  onRestored: (newProjectId: string) => Promise<void>;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectNumber, setNewProjectNumber] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skippedAttributes, setSkippedAttributes] = useState<string[] | null>(null);
  const [restoredProjectId, setRestoredProjectId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    try {
      const result = await parseProjectBackupWorkbook(file);
      if (result.points.length === 0) {
        setError("No points found in this backup file.");
      }
      setParsed(result);
      if (!newProjectName.trim()) {
        // A reasonable starting point, not forced -- the field stays editable.
        setNewProjectName(file.name.replace(/\.xlsx$/i, "").replace(/ - Backup$/i, ""));
      }
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

  const handleRestore = async () => {
    if (!parsed) return;
    if (!newProjectName.trim()) {
      setError("Name the new project before restoring.");
      return;
    }
    setRestoring(true);
    setError(null);
    try {
      const project = await api.create<Project>("projects", {
        name: newProjectName.trim(),
        project_number: newProjectNumber.trim(),
      });
      const result = await api.restoreProjectBackup(project.id, parsed);
      if (result.skipped_attributes.length > 0) {
        setRestoredProjectId(project.id);
        setSkippedAttributes(result.skipped_attributes);
      } else {
        await onRestored(project.id);
      }
    } catch (err: any) {
      setError(err.message ?? "Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  if (skippedAttributes) {
    return (
      <div className="form">
        <p>
          Restored successfully, but {skippedAttributes.length} custom attribute value
          {skippedAttributes.length === 1 ? "" : "s"} couldn't be matched to an existing attribute definition in this
          account and were skipped:
        </p>
        <ul>
          {[...new Set(skippedAttributes)].map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="muted-text">
          Everything else — equipment, points, every Install/Commissioning checklist value, Notes, Blocked By, and the
          Issue Log — restored in full.
        </p>
        <div className="form-actions">
          <div className="spacer" />
          <button type="button" className="btn-primary" onClick={() => onRestored(restoredProjectId!)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="form">
      {!fileName && (
        <>
          <p className="muted-text">
            Pick a project backup file produced by "Export Backup" — this always restores into a brand-new project,
            never over an existing one.
          </p>
          <label>
            Backup File
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx"
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
                {parsed.equipment.length} equipment / {parsed.points.length} points / {parsed.issues.length} issues
              </span>
            )}
            <div className="spacer" />
            <button type="button" className="btn-secondary" onClick={reset}>
              Choose a different file
            </button>
          </div>

          <div className="form-row" style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              New Project Name
              <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              Project #
              <input value={newProjectNumber} onChange={(e) => setNewProjectNumber(e.target.value)} />
            </label>
          </div>
        </>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        <div className="spacer" />
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {parsed && parsed.points.length > 0 && (
          <button type="button" className="btn-primary" disabled={restoring} onClick={handleRestore}>
            {restoring ? "Restoring…" : `Restore ${parsed.points.length} Points`}
          </button>
        )}
      </div>
    </div>
  );
}
