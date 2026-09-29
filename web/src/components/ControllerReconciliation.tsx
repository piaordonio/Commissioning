import { useState } from "react";
import { api, ImportDiffPoint } from "../api";
import { ControllerPointRow } from "../controllerImport";
import { Equipment, Point } from "../types";

// Shown after a controller check that left at least one design point
// unmatched on one side and at least one controller object unclaimed on
// the other — same reasoning as ImportReconciliation.tsx: a point missing
// from the controller and an unclaimed controller object can be the same
// physical point renumbered on-site, not an unrelated removal + addition.
// Pairing here just corrects the design point's point_number to the
// controller's real Object ID (there's no second design-point row to merge
// from, unlike a re-import pairing) and marks it confirmed. Skippable:
// "Done" finishes without pairing anything, if nothing was renumbered.
export function ControllerReconciliation({
  projectId,
  equipment,
  unmatchedDesign,
  unmatchedControllerRows,
  onDone,
}: {
  projectId: string;
  equipment: Equipment[];
  unmatchedDesign: ImportDiffPoint[];
  unmatchedControllerRows: ControllerPointRow[];
  onDone: () => void;
}) {
  const [design, setDesign] = useState(unmatchedDesign);
  const [controllerRows, setControllerRows] = useState(unmatchedControllerRows);
  const [equipmentCache, setEquipmentCache] = useState(equipment);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePair = async (row: ControllerPointRow) => {
    if (!selectedId) return;
    setPairing(true);
    setError(null);
    try {
      await api.update<Point>("points", selectedId, { point_number: row.object_id, on_controller: true });
      setDesign((list) => list.filter((p) => p.id !== selectedId));
      setControllerRows((list) => list.filter((r) => r.object_id !== row.object_id));
      setSelectedId(null);
    } catch (err: any) {
      setError(err.message ?? "Could not pair those points");
    } finally {
      setPairing(false);
    }
  };

  // A point that was missed in the original design, or added on-site
  // during a long design-to-CX gap, rather than a renumbered one — not a
  // pairing action, so it doesn't touch the selected design point at all.
  const handleAddNew = async (row: ControllerPointRow) => {
    setAddingId(row.object_id);
    setError(null);
    try {
      const { equipment: eq } = await api.addControllerObjectAsPoint(projectId, row, equipmentCache);
      setEquipmentCache((list) => (list.some((e) => e.id === eq.id) ? list : [...list, eq]));
      setControllerRows((list) => list.filter((r) => r.object_id !== row.object_id));
    } catch (err: any) {
      setError(err.message ?? "Could not add that point");
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="form">
      <p className="muted-text">
        {design.length} design point{design.length === 1 ? "" : "s"} not found on the controller, {controllerRows.length}{" "}
        controller object{controllerRows.length === 1 ? "" : "s"} not in the design list. If any of these are the same
        physical point renumbered on-site, click one on the left, then its match on the right, to correct the design
        point's number instead of leaving both flagged. If a controller object was genuinely missed in the design or
        added on-site later, use "Add as New Point" instead of pairing it.
      </p>

      {design.length > 0 && controllerRows.length > 0 && (
        <div className="toolbar">
          <span className="muted-text">
            {selectedId
              ? "Now click the controller object it matches →"
              : "Click a design point on the left, then its match on the right, to pair them."}
          </span>
        </div>
      )}

      {(design.length > 0 || controllerRows.length > 0) && (
        <div style={{ display: "flex", gap: 16 }}>
          {design.length > 0 && (
            <div style={{ flex: 1 }}>
              <div className="toolbar-label">Not found on controller</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {design.map((p) => (
                      <tr
                        key={p.id}
                        className="clickable-row"
                        style={p.id === selectedId ? { background: "#dbeafe" } : undefined}
                        onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                      >
                        <td className="mono">{p.point_number}</td>
                        <td className="truncate">{p.descriptor}</td>
                        <td className="muted-text">{p.equipment_tag}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {controllerRows.length > 0 && (
            <div style={{ flex: 1 }}>
              <div className="toolbar-label">On controller, not in design list</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {controllerRows.map((r) => (
                      <tr
                        key={r.object_id}
                        className={selectedId ? "clickable-row" : ""}
                        onClick={() => selectedId && !pairing && handlePair(r)}
                      >
                        <td className="mono">{r.object_id}</td>
                        <td className="truncate">{r.name}</td>
                        <td className="muted-text">{r.device}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={addingId !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddNew(r);
                            }}
                          >
                            {addingId === r.object_id ? "Adding…" : "+ Add as New Point"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        <div className="spacer" />
        <button type="button" className="btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
