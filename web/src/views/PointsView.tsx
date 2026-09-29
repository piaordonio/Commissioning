import { Fragment, useMemo, useRef, useState } from "react";
import {
  CHECK_FIELDS,
  CHECK_FIELD_LABELS,
  CheckField,
  CheckState,
  Equipment,
  INSTALL_FIELDS,
  INSTALL_FIELD_LABELS,
  InstallCheck,
  InstallField,
  Point,
  POINT_STATUS_LABELS,
  PointStatus,
} from "../types";
import { buildProgressByEquipment } from "../progress";
import {
  buildInstallProgressByEquipment,
  installStatus,
  InstallStatus,
  INSTALL_STATUS_LABELS,
} from "../installProgress";
import { resolvedPointNumber, displayPanel } from "../pointNumber";
import { autoFitColumnWidth } from "../textWidth";
import { formatDateCommissioned } from "../formatDate";

const BODY_FONT = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const HEADER_FONT = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const NOTES_FONT = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const SYMBOL: Record<CheckState, string> = { "": "", check: "✓", x: "✗", na: "N/A" };
const CYCLE: CheckState[] = ["", "check", "x", "na"];

function normalizeToken(raw: string): CheckState | null {
  const t = raw.trim().toLowerCase();
  if (t === "") return "";
  if (["x", "✗", "✘", "no", "fail", "n"].includes(t)) return "x";
  if (["✓", "✔", "check", "done", "yes", "y", "complete", "1", "true"].includes(t)) return "check";
  if (["n/a", "na", "not applicable"].includes(t)) return "na";
  return null;
}

// Install and Commissioning are two independent selection regions sharing
// the same row order -- a shift-click, Ctrl+C/V, or keyboard-fill always
// stays within one group's 7 columns rather than spanning both, since
// pasting install data onto commissioning cells (or vice versa) would
// never make sense.
type Group = "install" | "commissioning";
type Cell = { group: Group; r: number; c: number };

function fieldCount(group: Group): number {
  return group === "commissioning" ? CHECK_FIELDS.length : INSTALL_FIELDS.length;
}

function fieldName(cell: Cell): string {
  return cell.group === "commissioning" ? CHECK_FIELDS[cell.c] : INSTALL_FIELDS[cell.c];
}

export function PointsView({
  points,
  equipment,
  installChecks,
  onSetValue,
  onBulkSetValues,
  onSetInstallValue,
  onBulkSetInstallValues,
  onUpdateInstallNotes,
  onUpdatePoint,
  onDeletePoint,
}: {
  points: Point[];
  equipment: Equipment[];
  installChecks: InstallCheck[];
  onSetValue: (pointId: string, field: CheckField, value: CheckState) => void;
  onBulkSetValues: (updates: { id: string; field: string; value: string }[]) => void;
  onSetInstallValue: (pointId: string, field: InstallField, value: CheckState) => void;
  onBulkSetInstallValues: (updates: { id: string; field: string; value: string }[]) => void;
  onUpdateInstallNotes: (pointId: string, notes: string) => void;
  onUpdatePoint: (point: Point, patch: Partial<Point>) => void;
  onDeletePoint: (point: Point) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<CheckState[][] | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [panelFilter, setPanelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<PointStatus | "">("");
  const [installStatusFilter, setInstallStatusFilter] = useState<InstallStatus | "">("");
  const [search, setSearch] = useState("");
  const [showInstall, setShowInstall] = useState(true);
  const [showCommissioning, setShowCommissioning] = useState(true);

  const installChecksByPointId = useMemo(
    () => new Map(installChecks.map((ic) => [ic.point_id, ic])),
    [installChecks]
  );

  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment]);

  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const removedCount = points.length - activePoints.length;
  const checkedPoints = useMemo(() => activePoints.filter((p) => p.on_controller !== null), [activePoints]);
  const onControllerCount = useMemo(() => checkedPoints.filter((p) => p.on_controller).length, [checkedPoints]);
  const statusCounts = useMemo(() => {
    const counts = { not_started: 0, in_progress: 0, commissioned: 0 };
    for (const p of activePoints) counts[p.status]++;
    return counts;
  }, [activePoints]);
  // Progress reflects the current design regardless of the toggle below —
  // a removed point shouldn't count toward (or against) completion just
  // because it's temporarily visible for review.
  const progressByEquipment = useMemo(() => buildProgressByEquipment(activePoints), [activePoints]);
  const installProgressByEquipment = useMemo(
    () => buildInstallProgressByEquipment(activePoints, installChecksByPointId),
    [activePoints, installChecksByPointId]
  );

  const visiblePoints = showRemoved ? points : activePoints;

  const panelOptions = useMemo(
    () => Array.from(new Set(visiblePoints.map((p) => displayPanel(p.panel)))).sort((a, b) => a.localeCompare(b)),
    [visiblePoints]
  );

  // One search box covers both a point type (typing "AI" matches every
  // Analog Input, since the resolved point number already embeds that
  // token) and free text anywhere in the descriptor.
  const filteredPoints = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visiblePoints.filter((p) => {
      if (panelFilter && displayPanel(p.panel) !== panelFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (installStatusFilter && installStatus(installChecksByPointId.get(p.id)) !== installStatusFilter) return false;
      if (!query) return true;
      return resolvedPointNumber(p).toLowerCase().includes(query) || p.descriptor.toLowerCase().includes(query);
    });
  }, [visiblePoints, panelFilter, statusFilter, installStatusFilter, installChecksByPointId, search]);

  const rows = useMemo(
    () =>
      [...filteredPoints].sort((a, b) => {
        const ta = equipmentById[a.equipment_id]?.tag ?? "";
        const tb = equipmentById[b.equipment_id]?.tag ?? "";
        return ta === tb ? a.point_number.localeCompare(b.point_number) : ta.localeCompare(tb);
      }),
    [filteredPoints, equipmentById]
  );

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [rows]);

  // Sized to fit exactly what's currently visible -- not a fixed guess --
  // so these four columns take only as much room as their content needs
  // instead of stretching to fill whatever's left in a wide window (the
  // same failure mode the check columns and print report both had).
  const panelColWidth = useMemo(
    () => autoFitColumnWidth(rows.map((p) => displayPanel(p.panel)), "Panel", BODY_FONT, HEADER_FONT),
    [rows]
  );
  const pointColWidth = useMemo(
    () => autoFitColumnWidth(rows.map((p) => resolvedPointNumber(p)), "Point #", BODY_FONT, HEADER_FONT),
    [rows]
  );
  const descColWidth = useMemo(
    () => autoFitColumnWidth(rows.map((p) => p.descriptor), "Descriptor", BODY_FONT, HEADER_FONT),
    [rows]
  );
  const notesColWidth = useMemo(
    () => autoFitColumnWidth(rows.map((p) => p.notes || "—"), "Notes", NOTES_FONT, HEADER_FONT),
    [rows]
  );

  const groups = useMemo(() => {
    const list: { equipmentId: string; items: Point[] }[] = [];
    for (const p of rows) {
      const last = list[list.length - 1];
      if (last && last.equipmentId === p.equipment_id) last.items.push(p);
      else list.push({ equipmentId: p.equipment_id, items: [p] });
    }
    return list;
  }, [rows]);

  const getValue = (cell: Cell): CheckState => {
    if (cell.group === "commissioning") return rows[cell.r][CHECK_FIELDS[cell.c]];
    const ic = installChecksByPointId.get(rows[cell.r].id);
    return ic ? ic[INSTALL_FIELDS[cell.c]] : "";
  };

  const bounds = () => {
    if (!anchor || !focus || anchor.group !== focus.group) return null;
    return {
      group: anchor.group,
      rMin: Math.min(anchor.r, focus.r),
      rMax: Math.max(anchor.r, focus.r),
      cMin: Math.min(anchor.c, focus.c),
      cMax: Math.max(anchor.c, focus.c),
    };
  };

  const inSelection = (cell: Cell) => {
    const b = bounds();
    return (
      !!b && b.group === cell.group && cell.r >= b.rMin && cell.r <= b.rMax && cell.c >= b.cMin && cell.c <= b.cMax
    );
  };

  // Shift-clicking into the other group starts a fresh selection there
  // rather than trying to extend across two unrelated field lists.
  const selectCell = (cell: Cell, extend: boolean) => {
    if (extend && anchor && anchor.group === cell.group) setFocus(cell);
    else {
      setAnchor(cell);
      setFocus(cell);
    }
    containerRef.current?.focus();
  };

  const cycleCell = (cell: Cell) => {
    const current = getValue(cell);
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const pointId = rows[cell.r].id;
    if (cell.group === "commissioning") onSetValue(pointId, CHECK_FIELDS[cell.c], next);
    else onSetInstallValue(pointId, INSTALL_FIELDS[cell.c], next);
  };

  const handleCellClick = (cell: Cell, e: React.MouseEvent) => {
    if (e.shiftKey && anchor && anchor.group === cell.group) {
      selectCell(cell, true);
    } else {
      selectCell(cell, false);
      cycleCell(cell);
    }
  };

  const setRange = (state: CheckState) => {
    const b = bounds();
    if (!b) return;
    const updates: { id: string; field: string; value: string }[] = [];
    for (let r = b.rMin; r <= b.rMax; r++) {
      for (let c = b.cMin; c <= b.cMax; c++) {
        updates.push({ id: rows[r].id, field: fieldName({ group: b.group, r, c }), value: state });
      }
    }
    if (b.group === "commissioning") onBulkSetValues(updates);
    else onBulkSetInstallValues(updates);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Notes/Blocked By are plain <input>s inside this same container, so
    // their keydown events bubble up here too -- without this guard,
    // typing c/x/n/0, Backspace/Delete, arrow keys, or Ctrl+C/V into them
    // gets hijacked as a checklist-grid shortcut instead of editing the
    // text (e.g. Backspace calling preventDefault() and clearing the
    // selected cell range instead of deleting a character).
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (!anchor || !focus) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      const b = bounds()!;
      const grid: CheckState[][] = [];
      for (let r = b.rMin; r <= b.rMax; r++) {
        const row: CheckState[] = [];
        for (let c = b.cMin; c <= b.cMax; c++) row.push(getValue({ group: b.group, r, c }));
        grid.push(row);
      }
      clipboardRef.current = grid;
      const text = grid.map((row) => row.map((v) => SYMBOL[v]).join("\t")).join("\n");
      navigator.clipboard?.writeText(text).catch(() => {});
      return;
    }

    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      const b = bounds()!;
      const dispatch = b.group === "commissioning" ? onBulkSetValues : onBulkSetInstallValues;
      const paste = (grid: (CheckState | null)[][]) => {
        const updates: { id: string; field: string; value: string }[] = [];
        if (grid.length === 1 && grid[0].length === 1 && (b.rMax > b.rMin || b.cMax > b.cMin)) {
          const v = grid[0][0];
          if (v === null) return;
          for (let r = b.rMin; r <= b.rMax; r++)
            for (let c = b.cMin; c <= b.cMax; c++)
              updates.push({ id: rows[r].id, field: fieldName({ group: b.group, r, c }), value: v });
        } else {
          for (let i = 0; i < grid.length; i++) {
            const r = b.rMin + i;
            if (r >= rows.length) break;
            for (let j = 0; j < grid[i].length; j++) {
              const c = b.cMin + j;
              if (c >= fieldCount(b.group)) break;
              const v = grid[i][j];
              if (v === null) continue;
              updates.push({ id: rows[r].id, field: fieldName({ group: b.group, r, c }), value: v });
            }
          }
        }
        if (updates.length) dispatch(updates);
      };

      navigator.clipboard
        ?.readText()
        .then((text) => {
          const grid = text
            .replace(/\r/g, "")
            .split("\n")
            .filter((line, idx, arr) => line !== "" || idx < arr.length - 1)
            .map((line) => line.split("\t").map(normalizeToken));
          if (grid.length) paste(grid);
          else if (clipboardRef.current) paste(clipboardRef.current);
        })
        .catch(() => {
          if (clipboardRef.current) paste(clipboardRef.current);
        });
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setRange("");
      return;
    }

    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      const base = e.shiftKey ? focus : anchor;
      const r = Math.min(rows.length - 1, Math.max(0, base.r + dr));
      const c = Math.min(fieldCount(base.group) - 1, Math.max(0, base.c + dc));
      selectCell({ group: base.group, r, c }, e.shiftKey);
      return;
    }

    const direct: Record<string, CheckState> = { c: "check", x: "x", n: "na", "0": "", " ": "" };
    if (direct[e.key.toLowerCase()] !== undefined) {
      e.preventDefault();
      setRange(direct[e.key.toLowerCase()]);
    }
  };

  return (
    <div className="view">
      <div className="toolbar">
        <span className="toolbar-label">
          {activePoints.length} point{activePoints.length === 1 ? "" : "s"} across{" "}
          {new Set(activePoints.map((p) => p.equipment_id)).size} equipment
        </span>
        {checkedPoints.length > 0 && (
          <span className="toolbar-label">
            {onControllerCount} of {checkedPoints.length} confirmed on controller
          </span>
        )}
        <span className="toolbar-label">
          {statusCounts.commissioned} Commissioned, {statusCounts.in_progress} In Progress,{" "}
          {statusCounts.not_started} Not Started
        </span>
        <div className="spacer" />
        {removedCount > 0 && (
          <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
            Show {removedCount} removed point{removedCount === 1 ? "" : "s"}
          </label>
        )}
      </div>
      <div className="toolbar">
        <div className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>Columns</span>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={showInstall} onChange={(e) => setShowInstall(e.target.checked)} />
            Install
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={showCommissioning}
              onChange={(e) => setShowCommissioning(e.target.checked)}
            />
            Commissioning
          </label>
        </div>
        <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Panel
          <select value={panelFilter} onChange={(e) => setPanelFilter(e.target.value)}>
            <option value="">All Panels</option>
            {panelOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PointStatus | "")}>
            <option value="">All Statuses</option>
            {(Object.keys(POINT_STATUS_LABELS) as PointStatus[]).map((s) => (
              <option key={s} value={s}>
                {POINT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Install Status
          <select
            value={installStatusFilter}
            onChange={(e) => setInstallStatusFilter(e.target.value as InstallStatus | "")}
          >
            <option value="">All Statuses</option>
            {(Object.keys(INSTALL_STATUS_LABELS) as InstallStatus[]).map((s) => (
              <option key={s} value={s}>
                {INSTALL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          placeholder="Search type (AI/AO/BI/BO) or descriptor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <div className="spacer" />
        <span className="muted-text">
          Click a cell to cycle ✓ / ✗ / N/A. Shift-click to select a range, then Ctrl/Cmd+C / V to copy-paste, or type
          c / x / n / 0 to fill. Notes and Blocked By are editable directly.
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          {points.length === 0
            ? "No points yet. Import an Access database to get started."
            : "No points match this filter."}
        </div>
      ) : (
        <div className="table-wrap checklist-wrap" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown}>
          <table className="data-table checklist-table">
            <thead>
              <tr>
                <th className="checklist-sticky-col" style={{ width: panelColWidth }}></th>
                <th style={{ width: pointColWidth }}></th>
                <th style={{ width: descColWidth }}></th>
                {showInstall && (
                  <th colSpan={INSTALL_FIELDS.length + 2} className="column-group-header column-group-install">
                    Install
                  </th>
                )}
                {showCommissioning && (
                  <th colSpan={CHECK_FIELDS.length + 2} className="column-group-header column-group-commissioning">
                    Commissioning
                  </th>
                )}
                <th colSpan={4}></th>
              </tr>
              <tr>
                <th className="checklist-sticky-col" style={{ width: panelColWidth }}>
                  Panel
                </th>
                <th style={{ width: pointColWidth }}>Point #</th>
                <th style={{ width: descColWidth }}>Descriptor</th>
                {showInstall && (
                  <>
                    {INSTALL_FIELDS.map((f) => (
                      <th key={`install-${f}`} className="checklist-item-header">
                        {INSTALL_FIELD_LABELS[f]}
                      </th>
                    ))}
                    <th className="divider-left">Status</th>
                    <th className="divider-left">Notes</th>
                  </>
                )}
                {showCommissioning && (
                  <>
                    {CHECK_FIELDS.map((f, i) => (
                      <th
                        key={`commissioning-${f}`}
                        className={`checklist-item-header ${i === 0 && showInstall ? "divider-left" : ""}`}
                      >
                        {CHECK_FIELD_LABELS[f]}
                      </th>
                    ))}
                    <th className="divider-left">Status</th>
                    <th className="divider-left">Date Commissioned</th>
                  </>
                )}
                <th className="divider-left" style={{ width: notesColWidth }}>
                  Notes
                </th>
                <th>Blocked By</th>
                <th>Controller</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const eq = equipmentById[g.equipmentId];
                const pct = progressByEquipment.get(g.equipmentId) ?? 0;
                const installPct = installProgressByEquipment.get(g.equipmentId) ?? 0;
                const visibleFieldCols =
                  (showInstall ? INSTALL_FIELDS.length + 2 : 0) + (showCommissioning ? CHECK_FIELDS.length + 2 : 0);
                return (
                  <Fragment key={g.equipmentId}>
                    <tr className="table-group-header">
                      <td colSpan={3 + visibleFieldCols + 4}>
                        {eq?.tag ?? g.equipmentId}
                        {eq?.location ? ` — ${eq.location}` : ""}{" "}
                        <span className="count-pill">{g.items.length}</span>{" "}
                        <span
                          className={`progress-pill ${
                            installPct > 90 ? "progress-pill-high" : installPct < 10 ? "progress-pill-low" : ""
                          }`}
                        >
                          Install {installPct}%
                        </span>{" "}
                        <span
                          className={`progress-pill ${
                            pct > 90 ? "progress-pill-high" : pct < 10 ? "progress-pill-low" : ""
                          }`}
                        >
                          Commissioning {pct}%
                        </span>
                      </td>
                    </tr>
                    {g.items.map((point) => {
                      const r = rowIndexById.get(point.id)!;
                      return (
                        <tr key={point.id} style={point.active ? undefined : { opacity: 0.55 }}>
                          <td className="checklist-sticky-col">{displayPanel(point.panel)}</td>
                          <td>
                            {resolvedPointNumber(point)}
                            {!point.active && <span className="muted-text"> (removed)</span>}
                          </td>
                          <td>{point.descriptor}</td>
                          {showInstall && (
                            <>
                              {INSTALL_FIELDS.map((field, c) => {
                                const cell: Cell = { group: "install", r, c };
                                const v = getValue(cell);
                                return (
                                  <td
                                    key={`install-${field}`}
                                    className={`checklist-cell checklist-${v || "empty"} ${
                                      inSelection(cell) ? "checklist-selected" : ""
                                    }`}
                                    onClick={(e) => handleCellClick(cell, e)}
                                  >
                                    {SYMBOL[v]}
                                  </td>
                                );
                              })}
                              <td className="divider-left">
                                <span className={`status-pill status-${installStatus(installChecksByPointId.get(point.id))}`}>
                                  {INSTALL_STATUS_LABELS[installStatus(installChecksByPointId.get(point.id))]}
                                </span>
                              </td>
                              <td className="divider-left checklist-text-col">
                                <input
                                  key={`${point.id}-install-notes`}
                                  className="checklist-inline-input"
                                  defaultValue={installChecksByPointId.get(point.id)?.notes ?? ""}
                                  placeholder="—"
                                  onBlur={(e) => {
                                    const current = installChecksByPointId.get(point.id)?.notes ?? "";
                                    if (e.target.value !== current) onUpdateInstallNotes(point.id, e.target.value);
                                  }}
                                />
                              </td>
                            </>
                          )}
                          {showCommissioning && (
                            <>
                              {CHECK_FIELDS.map((field, c) => {
                                const cell: Cell = { group: "commissioning", r, c };
                                const v = point[field];
                                return (
                                  <td
                                    key={`commissioning-${field}`}
                                    className={`checklist-cell checklist-${v || "empty"} ${
                                      c === 0 && showInstall ? "divider-left" : ""
                                    } ${inSelection(cell) ? "checklist-selected" : ""}`}
                                    onClick={(e) => handleCellClick(cell, e)}
                                  >
                                    {SYMBOL[v]}
                                  </td>
                                );
                              })}
                              <td className="divider-left">
                                <span className={`status-pill status-${point.status}`}>
                                  {POINT_STATUS_LABELS[point.status]}
                                </span>
                              </td>
                              <td className="divider-left">{formatDateCommissioned(point.date_commissioned)}</td>
                            </>
                          )}
                          <td className="divider-left checklist-text-col checklist-notes-col">
                            <input
                              key={`${point.id}-notes`}
                              className="checklist-inline-input"
                              defaultValue={point.notes}
                              placeholder="—"
                              onBlur={(e) => {
                                if (e.target.value !== point.notes) onUpdatePoint(point, { notes: e.target.value });
                              }}
                            />
                          </td>
                          <td className={`checklist-text-col ${point.blocked_by ? "checklist-blocked" : ""}`}>
                            <input
                              key={`${point.id}-blocked`}
                              className="checklist-inline-input"
                              defaultValue={point.blocked_by}
                              placeholder="—"
                              onBlur={(e) => {
                                if (e.target.value !== point.blocked_by) onUpdatePoint(point, { blocked_by: e.target.value });
                              }}
                            />
                          </td>
                          <td>
                            {point.on_controller === false && (
                              <span className="controller-missing-pill">Not on Controller</span>
                            )}
                            {point.added_from_controller && (
                              <span className="controller-added-pill">Added from Controller</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Delete point"
                              aria-label="Delete point"
                              onClick={() => onDeletePoint(point)}
                            >
                              🗑
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
