import { Fragment, useMemo, useRef, useState } from "react";
import { CHECK_FIELDS, CHECK_FIELD_LABELS, CheckField, CheckState, Equipment, Point } from "../types";
import { buildProgressByEquipment } from "../progress";

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

type Cell = { r: number; c: number };

export function PointsView({
  points,
  equipment,
  onSetValue,
  onBulkSetValues,
  onUpdatePoint,
}: {
  points: Point[];
  equipment: Equipment[];
  onSetValue: (pointId: string, field: CheckField, value: CheckState) => void;
  onBulkSetValues: (updates: { id: string; field: string; value: string }[]) => void;
  onUpdatePoint: (point: Point, patch: Partial<Point>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<CheckState[][] | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment]);

  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const removedCount = points.length - activePoints.length;
  // Progress reflects the current design regardless of the toggle below —
  // a removed point shouldn't count toward (or against) completion just
  // because it's temporarily visible for review.
  const progressByEquipment = useMemo(() => buildProgressByEquipment(activePoints), [activePoints]);

  const visiblePoints = showRemoved ? points : activePoints;

  const rows = useMemo(
    () =>
      [...visiblePoints].sort((a, b) => {
        const ta = equipmentById[a.equipment_id]?.tag ?? "";
        const tb = equipmentById[b.equipment_id]?.tag ?? "";
        return ta === tb ? a.point_number.localeCompare(b.point_number) : ta.localeCompare(tb);
      }),
    [visiblePoints, equipmentById]
  );

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [rows]);

  const groups = useMemo(() => {
    const list: { equipmentId: string; items: Point[] }[] = [];
    for (const p of rows) {
      const last = list[list.length - 1];
      if (last && last.equipmentId === p.equipment_id) last.items.push(p);
      else list.push({ equipmentId: p.equipment_id, items: [p] });
    }
    return list;
  }, [rows]);

  const getValue = (r: number, c: number): CheckState => rows[r][CHECK_FIELDS[c]];

  const bounds = () => {
    if (!anchor || !focus) return null;
    return {
      rMin: Math.min(anchor.r, focus.r),
      rMax: Math.max(anchor.r, focus.r),
      cMin: Math.min(anchor.c, focus.c),
      cMax: Math.max(anchor.c, focus.c),
    };
  };

  const inSelection = (r: number, c: number) => {
    const b = bounds();
    return !!b && r >= b.rMin && r <= b.rMax && c >= b.cMin && c <= b.cMax;
  };

  const selectCell = (r: number, c: number, extend: boolean) => {
    if (extend && anchor) setFocus({ r, c });
    else {
      setAnchor({ r, c });
      setFocus({ r, c });
    }
    containerRef.current?.focus();
  };

  const cycleCell = (r: number, c: number) => {
    const current = getValue(r, c);
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    onSetValue(rows[r].id, CHECK_FIELDS[c], next);
  };

  const handleCellClick = (r: number, c: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor) {
      selectCell(r, c, true);
    } else {
      selectCell(r, c, false);
      cycleCell(r, c);
    }
  };

  const setRange = (state: CheckState) => {
    const b = bounds();
    if (!b) return;
    const updates: { id: string; field: string; value: string }[] = [];
    for (let r = b.rMin; r <= b.rMax; r++) {
      for (let c = b.cMin; c <= b.cMax; c++) {
        updates.push({ id: rows[r].id, field: CHECK_FIELDS[c], value: state });
      }
    }
    onBulkSetValues(updates);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!anchor || !focus) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      const b = bounds()!;
      const grid: CheckState[][] = [];
      for (let r = b.rMin; r <= b.rMax; r++) {
        const row: CheckState[] = [];
        for (let c = b.cMin; c <= b.cMax; c++) row.push(getValue(r, c));
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
      const paste = (grid: (CheckState | null)[][]) => {
        const updates: { id: string; field: string; value: string }[] = [];
        if (grid.length === 1 && grid[0].length === 1 && (b.rMax > b.rMin || b.cMax > b.cMin)) {
          const v = grid[0][0];
          if (v === null) return;
          for (let r = b.rMin; r <= b.rMax; r++)
            for (let c = b.cMin; c <= b.cMax; c++) updates.push({ id: rows[r].id, field: CHECK_FIELDS[c], value: v });
        } else {
          for (let i = 0; i < grid.length; i++) {
            const r = b.rMin + i;
            if (r >= rows.length) break;
            for (let j = 0; j < grid[i].length; j++) {
              const c = b.cMin + j;
              if (c >= CHECK_FIELDS.length) break;
              const v = grid[i][j];
              if (v === null) continue;
              updates.push({ id: rows[r].id, field: CHECK_FIELDS[c], value: v });
            }
          }
        }
        if (updates.length) onBulkSetValues(updates);
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
      const c = Math.min(CHECK_FIELDS.length - 1, Math.max(0, base.c + dc));
      selectCell(r, c, e.shiftKey);
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
        <div className="spacer" />
        {removedCount > 0 && (
          <label className="toolbar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
            Show {removedCount} removed point{removedCount === 1 ? "" : "s"}
          </label>
        )}
      </div>
      <div className="toolbar">
        <span className="muted-text">
          Click a cell to cycle ✓ / ✗ / N/A. Shift-click to select a range, then Ctrl/Cmd+C / V to copy-paste, or type
          c / x / n / 0 to fill. Notes and Blocked By are editable directly.
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">No points yet. Import an Access database to get started.</div>
      ) : (
        <div className="table-wrap checklist-wrap" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown}>
          <table className="data-table checklist-table">
            <thead>
              <tr>
                <th className="checklist-sticky-col">Point #</th>
                <th>Panel</th>
                <th>IP/OP</th>
                <th>A/D</th>
                <th>Descriptor</th>
                {CHECK_FIELDS.map((f) => (
                  <th key={f} className="checklist-item-header">
                    {CHECK_FIELD_LABELS[f]}
                  </th>
                ))}
                <th>Notes</th>
                <th>Blocked By</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const eq = equipmentById[g.equipmentId];
                const pct = progressByEquipment.get(g.equipmentId) ?? 0;
                return (
                  <Fragment key={g.equipmentId}>
                    <tr className="table-group-header">
                      <td colSpan={5 + CHECK_FIELDS.length + 2}>
                        {eq?.tag ?? g.equipmentId}
                        {eq?.location ? ` — ${eq.location}` : ""}{" "}
                        <span className="count-pill">{g.items.length}</span>{" "}
                        <span className="progress-pill">{pct}%</span>
                      </td>
                    </tr>
                    {g.items.map((point) => {
                      const r = rowIndexById.get(point.id)!;
                      return (
                        <tr key={point.id} style={point.active ? undefined : { opacity: 0.55 }}>
                          <td className="mono checklist-sticky-col">
                            {point.point_number}
                            {!point.active && <span className="muted-text"> (removed)</span>}
                          </td>
                          <td>{point.panel}</td>
                          <td>{point.ip_op}</td>
                          <td>{point.analog_digital}</td>
                          <td className="truncate checklist-name-col" title={point.descriptor}>
                            {point.descriptor}
                          </td>
                          {CHECK_FIELDS.map((field, c) => {
                            const v = point[field];
                            return (
                              <td
                                key={field}
                                className={`checklist-cell checklist-${v || "empty"} ${
                                  inSelection(r, c) ? "checklist-selected" : ""
                                }`}
                                onClick={(e) => handleCellClick(r, c, e)}
                              >
                                {SYMBOL[v]}
                              </td>
                            );
                          })}
                          <td className="checklist-text-col">
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
