import { useState } from "react";
import { api, ImportDiff, ImportDiffPoint } from "../api";

// Shown after a re-import that removed at least one point, since a removed
// point and a newly-added point can be the same physical point renumbered
// at the source — pairing them transfers checklist progress forward instead
// of leaving it stranded on an inactive row. Skippable: "Done" finishes
// without pairing anything, if nothing was actually renumbered.
export function ImportReconciliation({ diff, onDone }: { diff: ImportDiff; onDone: () => void }) {
  const [deactivated, setDeactivated] = useState(diff.deactivated_points);
  const [added, setAdded] = useState(diff.new_points);
  const [selectedOldId, setSelectedOldId] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePair = async (newPoint: ImportDiffPoint) => {
    if (!selectedOldId) return;
    setPairing(true);
    setError(null);
    try {
      await api.pairReimportedPoint(selectedOldId, newPoint.id);
      setDeactivated((list) => list.filter((p) => p.id !== selectedOldId));
      setAdded((list) => list.filter((p) => p.id !== newPoint.id));
      setSelectedOldId(null);
    } catch (err: any) {
      setError(err.message ?? "Could not pair those points");
    } finally {
      setPairing(false);
    }
  };

  return (
    <div className="form">
      <p className="muted-text">
        {diff.point_matched} point{diff.point_matched === 1 ? "" : "s"} updated, {diff.point_new} added,{" "}
        {diff.point_deactivated} removed from the design and marked inactive — their checklist progress is preserved,
        not deleted. If any of the removed points below were actually renumbered rather than removed, click one, then
        click its replacement on the right to carry its progress forward.
      </p>

      {deactivated.length > 0 && added.length > 0 && (
        <div className="toolbar">
          <span className="muted-text">
            {selectedOldId
              ? "Now click the new point it was renumbered to →"
              : "Click a removed point on the left, then its replacement on the right, to pair them."}
          </span>
        </div>
      )}

      {(deactivated.length > 0 || added.length > 0) && (
        <div style={{ display: "flex", gap: 16 }}>
          {deactivated.length > 0 && (
            <div style={{ flex: 1 }}>
              <div className="toolbar-label">Removed from this import</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {deactivated.map((p) => (
                      <tr
                        key={p.id}
                        className="clickable-row"
                        style={p.id === selectedOldId ? { background: "#dbeafe" } : undefined}
                        onClick={() => setSelectedOldId(p.id === selectedOldId ? null : p.id)}
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

          {added.length > 0 && (
            <div style={{ flex: 1 }}>
              <div className="toolbar-label">Newly added</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {added.map((p) => (
                      <tr
                        key={p.id}
                        className={selectedOldId ? "clickable-row" : ""}
                        onClick={() => selectedOldId && !pairing && handlePair(p)}
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
