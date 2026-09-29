import { useRef, useState } from "react";
import { api, ImportDiffPoint } from "../api";
import { ControllerPointRow, parseControllerPoints } from "../controllerImport";
import { resolvedPointNumber } from "../pointNumber";
import { ControllerReconciliation } from "./ControllerReconciliation";
import { Equipment, Point } from "../types";

export function VerifyControllerModal({
  points,
  equipment,
  onCancel,
  onDone,
}: {
  points: Point[];
  equipment: Equipment[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ControllerPointRow[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<{
    unmatchedDesign: ImportDiffPoint[];
    unmatchedControllerRows: ControllerPointRow[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseControllerPoints(text);
      if (parsed.length === 0) {
        setError("No objects found. Check that this is an EnteliWEB points list export.");
      }
      setRows(parsed);
    } catch (err: any) {
      setRows(null);
      setError(err.message ?? "Could not read that file.");
    }
  };

  const reset = () => {
    setFileName(null);
    setRows(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleCompare = async () => {
    if (!rows) return;
    setComparing(true);
    setError(null);
    try {
      const equipmentById = Object.fromEntries(equipment.map((e) => [e.id, e]));
      const byObjectId = new Map(rows.map((r) => [r.object_id, r]));
      const claimed = new Set<string>();

      const updates: { id: string; on_controller: boolean }[] = [];
      const unmatchedDesign: ImportDiffPoint[] = [];

      for (const point of points.filter((p) => p.active)) {
        const resolved = resolvedPointNumber(point);
        const match = byObjectId.get(resolved);
        if (match) {
          updates.push({ id: point.id, on_controller: true });
          claimed.add(match.object_id);
        } else {
          updates.push({ id: point.id, on_controller: false });
          unmatchedDesign.push({
            id: point.id,
            point_number: resolved,
            descriptor: point.descriptor,
            equipment_tag: equipmentById[point.equipment_id]?.tag ?? "",
          });
        }
      }

      const unmatchedControllerRows = rows.filter((r) => !claimed.has(r.object_id));

      await api.setControllerStatus(updates);

      if (unmatchedDesign.length > 0 || unmatchedControllerRows.length > 0) {
        setReconciliation({ unmatchedDesign, unmatchedControllerRows });
      } else {
        await onDone();
      }
    } catch (err: any) {
      setError(err.message ?? "Compare failed");
    } finally {
      setComparing(false);
    }
  };

  if (reconciliation) {
    return (
      <ControllerReconciliation
        unmatchedDesign={reconciliation.unmatchedDesign}
        unmatchedControllerRows={reconciliation.unmatchedControllerRows}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="form">
      {!fileName && (
        <>
          <p className="muted-text">
            Pick the "Points List" CSV export from EnteliWEB — the actual objects programmed into the controller. It's
            read entirely in your browser; nothing is uploaded anywhere. This checks the design points already in this
            project against what's really on the controller, and flags anything missing or possibly renumbered.
          </p>
          <label>
            EnteliWEB Points List (CSV)
            <input
              ref={fileInput}
              type="file"
              accept=".csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        </>
      )}

      {fileName && (
        <div className="toolbar">
          <span className="toolbar-label">{fileName}</span>
          {rows && <span className="count-pill">{rows.length} objects on controller</span>}
          <div className="spacer" />
          <button type="button" className="btn-secondary" onClick={reset}>
            Choose a different file
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        <div className="spacer" />
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {rows && rows.length > 0 && (
          <button type="button" className="btn-primary" disabled={comparing} onClick={handleCompare}>
            {comparing ? "Comparing…" : `Compare ${rows.length} Objects`}
          </button>
        )}
      </div>
    </div>
  );
}
