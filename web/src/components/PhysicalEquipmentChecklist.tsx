import { useState } from "react";
import { CheckState, PHYSICAL_EQUIPMENT_FIELDS, PHYSICAL_EQUIPMENT_FIELD_LABELS, PhysicalEquipment } from "../types";
import { SYMBOL, nextCheckState } from "../checklistCycle";

// The prerequisite gate on point-level Install work, shown right under an
// equipment/controller group's own header -- one controller commonly
// serves 2-3 separate physical units (a supply fan, a heating coil), each
// needing its own Space Ready/Equipment Installed/Ducted-Piped sign-off
// before a tech starts piping/pulling wire to that controller's points.
// Shared between PointsCardList.tsx and PointsView.tsx rather than
// duplicated, since the behavior (and RLS/RPC backing it) is identical in
// both -- only the surrounding layout differs.
export function PhysicalEquipmentChecklist({
  items,
  installerView,
  onSetCheck,
  onCreate,
  onDelete,
}: {
  items: PhysicalEquipment[];
  installerView: boolean;
  onSetCheck: (id: string, field: (typeof PHYSICAL_EQUIPMENT_FIELDS)[number], value: CheckState) => void;
  // Creating/deleting a physical equipment row is owner/admin only -- RLS
  // would reject an installer's attempt anyway, so these are simply absent
  // (not just disabled) when installerView is true.
  onCreate?: (name: string) => Promise<void>;
  onDelete?: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !onCreate) return;
    setAdding(true);
    try {
      await onCreate(newName.trim());
      setNewName("");
    } finally {
      setAdding(false);
    }
  };

  if (items.length === 0 && installerView) return null;

  return (
    <div className="physical-equipment-section">
      {items.map((pe) => (
        <div key={pe.id} className="physical-equipment-row">
          <span className="physical-equipment-name">{pe.name}</span>
          {PHYSICAL_EQUIPMENT_FIELDS.map((field) => {
            const v = pe[field];
            return (
              <button
                type="button"
                key={field}
                className={`physical-equipment-cell physical-equipment-cell-${v || "empty"}`}
                onClick={() => onSetCheck(pe.id, field, nextCheckState(v))}
                title={PHYSICAL_EQUIPMENT_FIELD_LABELS[field]}
              >
                <span className="physical-equipment-cell-label">{PHYSICAL_EQUIPMENT_FIELD_LABELS[field]}</span>
                <span className="physical-equipment-cell-value">{SYMBOL[v] || "—"}</span>
              </button>
            );
          })}
          {!installerView && onDelete && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove physical equipment"
              title="Remove"
              onClick={() => {
                if (window.confirm(`Remove "${pe.name}"?`)) onDelete(pe.id);
              }}
            >
              🗑
            </button>
          )}
        </div>
      ))}
      {!installerView && onCreate && (
        <form className="physical-equipment-add-row" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="+ Add equipment (e.g. Supply Fan)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={adding || !newName.trim()}>
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
      )}
    </div>
  );
}
