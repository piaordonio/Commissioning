import { useMemo, useState } from "react";
import { CheckState, PHYSICAL_EQUIPMENT_FIELDS, PHYSICAL_EQUIPMENT_FIELD_LABELS, PhysicalEquipment, Point } from "../types";
import { SYMBOL, nextCheckState } from "../checklistCycle";
import { suggestPhysicalEquipmentGroups } from "../physicalEquipmentSuggest";

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
  points,
  installerView,
  onSetCheck,
  onCreate,
  onDelete,
}: {
  items: PhysicalEquipment[];
  // This controller/equipment group's own points -- used only to compute
  // "Suggest from names" below, not rendered directly here.
  points: Point[];
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
  const [showSuggestions, setShowSuggestions] = useState(false);
  // key -> editable name (prefilled from the suggestion, renamable before
  // creating) and whether it's checked for creation.
  const [suggestionNames, setSuggestionNames] = useState<Record<string, string>>({});
  const [suggestionChecked, setSuggestionChecked] = useState<Record<string, boolean>>({});
  const [creatingSelected, setCreatingSelected] = useState(false);

  const existingNames = useMemo(() => new Set(items.map((pe) => pe.name)), [items]);
  const suggestions = useMemo(
    () => (showSuggestions ? suggestPhysicalEquipmentGroups(points, existingNames) : []),
    [showSuggestions, points, existingNames]
  );

  const openSuggestions = () => {
    setShowSuggestions(true);
    const names: Record<string, string> = {};
    const checked: Record<string, boolean> = {};
    for (const s of suggestPhysicalEquipmentGroups(points, existingNames)) {
      names[s.key] = s.key;
      checked[s.key] = true;
    }
    setSuggestionNames(names);
    setSuggestionChecked(checked);
  };

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

  const handleCreateSelected = async () => {
    if (!onCreate) return;
    const toCreate = suggestions.filter((s) => suggestionChecked[s.key] && suggestionNames[s.key]?.trim());
    if (toCreate.length === 0) return;
    setCreatingSelected(true);
    try {
      // Sequential, not Promise.all: each call appends to the same parent
      // state list (see createPhysicalEquipment in App.tsx) -- firing them
      // concurrently would race those updates against each other.
      for (const s of toCreate) {
        await onCreate(suggestionNames[s.key].trim());
      }
      setShowSuggestions(false);
    } finally {
      setCreatingSelected(false);
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
        <>
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
            {!showSuggestions && (
              <button type="button" className="btn-secondary" onClick={openSuggestions}>
                Suggest from names
              </button>
            )}
          </form>
          {showSuggestions && (
            <div className="physical-equipment-suggestions">
              {suggestions.length === 0 ? (
                <div className="muted-text">
                  No new groupings found in this controller's point names — everything either already has an entry
                  above or doesn't follow a recognizable Building_System_Signal pattern.
                </div>
              ) : (
                <>
                  <div className="muted-text">
                    Guessed from point names (strip the building code and the signal suffix, group what's left) —
                    review before adding. Uncheck anything wrong, or edit the name.
                  </div>
                  {suggestions.map((s) => (
                    <label key={s.key} className="physical-equipment-suggestion-row">
                      <input
                        type="checkbox"
                        checked={suggestionChecked[s.key] ?? true}
                        onChange={(e) =>
                          setSuggestionChecked((prev) => ({ ...prev, [s.key]: e.target.checked }))
                        }
                      />
                      <input
                        type="text"
                        className="physical-equipment-suggestion-name"
                        value={suggestionNames[s.key] ?? s.key}
                        onChange={(e) => setSuggestionNames((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      />
                      <span className="muted-text">
                        {s.count} point{s.count === 1 ? "" : "s"} — e.g. "{s.sampleDescriptor}"
                      </span>
                    </label>
                  ))}
                  <div className="physical-equipment-suggestion-actions">
                    <button type="button" className="btn-secondary" onClick={() => setShowSuggestions(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={creatingSelected || !suggestions.some((s) => suggestionChecked[s.key])}
                      onClick={handleCreateSelected}
                    >
                      {creatingSelected ? "Adding…" : "Add Selected"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
