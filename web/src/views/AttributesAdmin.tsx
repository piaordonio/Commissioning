import { useState } from "react";
import {
  POINT_ATTRIBUTE_TYPE_LABELS,
  PointAttribute,
  PointAttributeOption,
  PointAttributeProject,
  PointAttributeType,
  Project,
} from "../types";
import { optionsForAttribute, projectCountForAttribute } from "../pointAttributes";

// Admin screen for defining project-assignable checklist columns on top of
// the fixed 7 commissioning + 7 install fields -- same architectural slot
// as ProjectDashboard.tsx/PointsReport.tsx, a purpose-built screen with its
// own onBack rather than a modal. Attribute definitions are global (not
// project-scoped): one definition can be assigned to any number of
// projects via the checkbox list below, mirroring EnteliWEB's own
// "Point Attributes" page and its "Commissioning Sessions" checkboxes.
export function AttributesAdmin({
  pointAttributes,
  pointAttributeOptions,
  pointAttributeProjects,
  projects,
  onCreate,
  onUpdate,
  onDelete,
  onCreateOption,
  onUpdateOption,
  onDeleteOption,
  onSaveProjectAssignment,
  onBack,
}: {
  pointAttributes: PointAttribute[];
  pointAttributeOptions: PointAttributeOption[];
  pointAttributeProjects: PointAttributeProject[];
  projects: Project[];
  onCreate: (attr: Partial<PointAttribute>) => Promise<PointAttribute>;
  onUpdate: (id: string, patch: Partial<PointAttribute>) => Promise<void>;
  onDelete: (attr: PointAttribute) => Promise<void>;
  onCreateOption: (attributeId: string, value: string, sortOrder: number) => Promise<void>;
  onUpdateOption: (id: string, value: string) => Promise<void>;
  onDeleteOption: (option: PointAttributeOption) => Promise<void>;
  onSaveProjectAssignment: (attributeId: string, projectIds: string[]) => Promise<void>;
  onBack: () => void;
}) {
  const [editingAttr, setEditingAttr] = useState<PointAttribute | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [shortText, setShortText] = useState("");
  const [attrType, setAttrType] = useState<PointAttributeType>("boolean");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [newOptionValue, setNewOptionValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const startCreate = () => {
    setEditingAttr(null);
    setName("");
    setShortText("");
    setAttrType("boolean");
    setSelectedProjectIds(new Set());
    setNewOptionValue("");
    setFormError(null);
    setIsEditing(true);
  };

  const startEdit = (attr: PointAttribute) => {
    setEditingAttr(attr);
    setName(attr.name);
    setShortText(attr.short_text);
    setAttrType(attr.attr_type);
    setSelectedProjectIds(
      new Set(pointAttributeProjects.filter((l) => l.point_attribute_id === attr.id).map((l) => l.project_id))
    );
    setNewOptionValue("");
    setFormError(null);
    setIsEditing(true);
  };

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (!editingAttr) {
        // Created with zero project assignments -- the checkbox list only
        // appears once the attribute is a real row (see the guard below),
        // so a brand-new attribute is saved once here, then the form stays
        // open on the newly-created row for projects/options to follow.
        const created = await onCreate({ name: name.trim(), short_text: shortText.trim(), attr_type: attrType });
        setEditingAttr(created);
      } else {
        await onUpdate(editingAttr.id, { name: name.trim(), short_text: shortText.trim() });
        await onSaveProjectAssignment(editingAttr.id, Array.from(selectedProjectIds));
      }
    } catch (err: any) {
      setFormError(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingAttr) return;
    setSaving(true);
    try {
      await onDelete(editingAttr);
      setIsEditing(false);
    } catch (err: any) {
      setFormError(err.message ?? "Failed to delete");
      setSaving(false);
    }
  };

  const currentOptions = editingAttr ? optionsForAttribute(pointAttributeOptions, editingAttr.id) : [];

  const handleAddOption = async () => {
    if (!editingAttr || !newOptionValue.trim()) return;
    const nextSortOrder = currentOptions.length === 0 ? 0 : Math.max(...currentOptions.map((o) => o.sort_order)) + 1;
    await onCreateOption(editingAttr.id, newOptionValue.trim(), nextSortOrder);
    setNewOptionValue("");
  };

  if (isEditing) {
    return (
      <div className="view">
        <div className="toolbar">
          <button type="button" className="btn-secondary" onClick={() => setIsEditing(false)}>
            ← Back to Attributes
          </button>
          <div className="spacer" />
        </div>

        <div className="form attribute-form">
          {formError && <div className="error-banner">{formError}</div>}
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. End to End" />
          </label>
          <label>
            Short Text
            <input
              type="text"
              value={shortText}
              onChange={(e) => setShortText(e.target.value)}
              placeholder="e.g. E2E -- the abbreviated column header"
            />
          </label>
          <label>
            Type
            {editingAttr ? (
              <input type="text" value={POINT_ATTRIBUTE_TYPE_LABELS[attrType]} disabled />
            ) : (
              <select value={attrType} onChange={(e) => setAttrType(e.target.value as PointAttributeType)}>
                {(Object.keys(POINT_ATTRIBUTE_TYPE_LABELS) as PointAttributeType[]).map((t) => (
                  <option key={t} value={t}>
                    {POINT_ATTRIBUTE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </label>
          {editingAttr && (
            <p className="muted-text">
              Type can't be changed after an attribute is created -- existing values on points would no longer make
              sense under a different type.
            </p>
          )}

          {editingAttr && attrType === "text" && (
            <div className="attribute-options-editor">
              <div className="field-label">Dropdown Options</div>
              <p className="muted-text">
                No options = this attribute is a plain free-text field. Add one or more below to make it a dropdown
                instead.
              </p>
              {currentOptions.length === 0 ? (
                <div className="empty-state">No options yet -- currently plain free text.</div>
              ) : (
                <div className="attribute-options-list">
                  {currentOptions.map((opt) => (
                    <div key={opt.id} className="attribute-option-row">
                      <input
                        type="text"
                        defaultValue={opt.value}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== opt.value) onUpdateOption(opt.id, e.target.value.trim());
                        }}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        title="Delete this option"
                        aria-label="Delete option"
                        onClick={() => onDeleteOption(opt)}
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="attribute-option-add-row">
                <input
                  type="text"
                  value={newOptionValue}
                  onChange={(e) => setNewOptionValue(e.target.value)}
                  placeholder="Add an option…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddOption();
                    }
                  }}
                />
                <button type="button" className="btn-secondary" onClick={handleAddOption}>
                  Add
                </button>
              </div>
            </div>
          )}

          {editingAttr && (
            <div className="attribute-projects-editor">
              <div className="field-label">Commissioning Sessions (Projects)</div>
              <p className="muted-text">Which projects should show this attribute on their checklist.</p>
              {projects.length === 0 ? (
                <div className="empty-state">No projects yet.</div>
              ) : (
                <div className="attribute-project-checkboxes">
                  {projects.map((p) => (
                    <label key={p.id} className="attribute-project-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.has(p.id)}
                        onChange={() => toggleProject(p.id)}
                      />
                      {p.project_number ? `${p.project_number} — ${p.name}` : p.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="form-actions">
            {editingAttr && (
              <button type="button" className="btn-danger" disabled={saving} onClick={handleDelete}>
                Delete Attribute
              </button>
            )}
            <div className="spacer" />
            <button type="button" className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back to Points
        </button>
        <div className="spacer" />
        <button type="button" className="btn-primary" onClick={startCreate}>
          + Create Attribute
        </button>
      </div>

      {pointAttributes.length === 0 ? (
        <div className="empty-state">
          No custom attributes defined yet. Create one to add a project-specific column to the checklist grid,
          beyond the fixed commissioning/install fields.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Short Text</th>
              <th>Type</th>
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {pointAttributes.map((attr) => (
              <tr key={attr.id} className="clickable-row" onClick={() => startEdit(attr)}>
                <td>{attr.name}</td>
                <td>{attr.short_text}</td>
                <td>{POINT_ATTRIBUTE_TYPE_LABELS[attr.attr_type]}</td>
                <td>{projectCountForAttribute(pointAttributeProjects, attr.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
