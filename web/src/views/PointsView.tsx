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
  Issue,
  Point,
  PointAttribute,
  PointAttributeOption,
  PointAttributeProject,
  PointAttributeValue,
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
import { formatDateCommissioned, MONTH_ABBR } from "../formatDate";
import { SYMBOL, nextCheckState } from "../checklistCycle";
import { usePointRows } from "../usePointRows";
import { buildOpenIssueCountByEquipment, groupIssuesByPointId, openIssueCount } from "../issues";
import { attributesForProject, buildAttributeValueMap, getAttributeValue, optionsForAttribute, isAttrValueNA, ATTR_NA_DISPLAY } from "../pointAttributes";

const BODY_FONT = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const HEADER_FONT = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const NOTES_FONT = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
// stays within one group's columns rather than spanning both, since
// pasting install data onto commissioning cells (or vice versa) would
// never make sense. "attributes" is a third such region, added for
// boolean-type custom attributes -- see booleanAttributes below; text/number
// attributes never enter this Cell/selection engine at all (plain onBlur
// inputs, like Notes/Blocked By). fieldCount/fieldName for this group are
// component-body closures (not the module-level functions install/
// commissioning use), since the attribute list isn't known until render --
// see their definitions below, right after booleanAttributes.
type Group = "install" | "commissioning" | "attributes";
type Cell = { group: Group; r: number; c: number };

export function PointsView({
  projectId,
  points,
  equipment,
  installChecks,
  issues,
  pointAttributes,
  pointAttributeOptions,
  pointAttributeProjects,
  pointAttributeValues,
  onSetValue,
  onBulkSetValues,
  onSetInstallValue,
  onBulkSetInstallValues,
  onUpdatePoint,
  onDeletePoint,
  onOpenIssues,
  onSetAttributeValue,
  onBulkSetAttributeValues,
  onSetStatus,
}: {
  projectId: string;
  points: Point[];
  equipment: Equipment[];
  installChecks: InstallCheck[];
  issues: Issue[];
  pointAttributes: PointAttribute[];
  pointAttributeOptions: PointAttributeOption[];
  pointAttributeProjects: PointAttributeProject[];
  pointAttributeValues: PointAttributeValue[];
  onSetValue: (pointId: string, field: CheckField, value: CheckState) => void;
  onBulkSetValues: (updates: { id: string; field: string; value: string }[]) => void;
  onSetInstallValue: (pointId: string, field: InstallField, value: CheckState) => void;
  onBulkSetInstallValues: (updates: { id: string; field: string; value: string }[]) => void;
  onUpdatePoint: (point: Point, patch: Partial<Point>) => void;
  onDeletePoint: (point: Point) => void;
  onOpenIssues: (point: Point) => void;
  onSetAttributeValue: (pointId: string, attributeId: string, value: string) => void;
  onBulkSetAttributeValues: (updates: { point_id: string; point_attribute_id: string; value: string }[]) => void;
  onSetStatus: (pointId: string, status: PointStatus) => void;
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
  const [showAttributes, setShowAttributes] = useState(true);

  const installChecksByPointId = useMemo(
    () => new Map(installChecks.map((ic) => [ic.point_id, ic])),
    [installChecks]
  );
  const issuesByPointId = useMemo(() => groupIssuesByPointId(issues), [issues]);

  // Boolean-type attributes join the Cell/selection engine below as the
  // "attributes" group (full click-to-cycle/shift-click/bulk-fill/paste);
  // text/number attributes never do -- plain onBlur inputs instead,
  // rendered separately after the boolean block. fieldCount/fieldName are
  // closures (not the module-level functions install/commissioning use)
  // since this list isn't known at compile time the way CHECK_FIELDS/
  // INSTALL_FIELDS are.
  const projectAttrs = useMemo(
    () => attributesForProject(pointAttributes, pointAttributeProjects, projectId),
    [pointAttributes, pointAttributeProjects, projectId]
  );
  const booleanAttributes = useMemo(() => projectAttrs.filter((a) => a.attr_type === "boolean"), [projectAttrs]);
  const textNumberAttributes = useMemo(() => projectAttrs.filter((a) => a.attr_type !== "boolean"), [projectAttrs]);
  const attrValueMap = useMemo(() => buildAttributeValueMap(pointAttributeValues), [pointAttributeValues]);

  const fieldCount = (group: Group): number =>
    group === "commissioning" ? CHECK_FIELDS.length : group === "install" ? INSTALL_FIELDS.length : booleanAttributes.length;
  const fieldName = (cell: Cell): string =>
    cell.group === "commissioning"
      ? CHECK_FIELDS[cell.c]
      : cell.group === "install"
      ? INSTALL_FIELDS[cell.c]
      : booleanAttributes[cell.c].id;

  const { equipmentById, activePoints, removedCount, panelOptions, rows, groups } = usePointRows(
    points,
    equipment,
    installChecksByPointId,
    { showRemoved, panelFilter, statusFilter, installStatusFilter, search }
  );

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
  const progressByEquipment = useMemo(
    () => buildProgressByEquipment(activePoints, projectAttrs, attrValueMap),
    [activePoints, projectAttrs, attrValueMap]
  );
  const installProgressByEquipment = useMemo(
    () => buildInstallProgressByEquipment(activePoints, installChecksByPointId),
    [activePoints, installChecksByPointId]
  );
  const openIssueCountByEquipment = useMemo(
    () => buildOpenIssueCountByEquipment(activePoints, issuesByPointId),
    [activePoints, issuesByPointId]
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

  // Sized from the date values only (headerLabel "" excludes "Date
  // Commissioned" itself, which wraps onto its own lines instead -- see
  // .checklist-item-header-attr's reuse below). Every month abbreviation is
  // measured as a same-day/year candidate, not just rows that currently
  // have a date, so the column doesn't later reflow/clip the first time a
  // point is marked Commissioned in a wider month like "Sep".
  const dateCommissionedColWidth = useMemo(
    () =>
      autoFitColumnWidth(
        [...rows.map((p) => formatDateCommissioned(p.date_commissioned)), ...MONTH_ABBR.map((m) => `${m}-01-2026`)],
        "",
        BODY_FONT,
        HEADER_FONT
      ),
    [rows]
  );

  // Each text/number attribute gets its own auto-fit width (same technique
  // as Notes above), not the generic .checklist-text-col floor -- these
  // tend to hold short values (a reading, a single word), so a shared wide
  // column would waste far more space than Notes' free-text does. Measures
  // every currently-assigned dropdown option too, not just values already
  // in use, so picking a longer option later doesn't clip/reflow the column.
  const textNumberAttrColWidths = useMemo(() => {
    const map = new Map<string, number>();
    for (const attr of textNumberAttributes) {
      const options = optionsForAttribute(pointAttributeOptions, attr.id);
      const candidates = [
        ...rows.map((p) => getAttributeValue(attrValueMap, p.id, attr.id) || ATTR_NA_DISPLAY),
        ...options.map((o) => o.value),
      ];
      map.set(attr.id, autoFitColumnWidth(candidates, attr.short_text || attr.name, NOTES_FONT, HEADER_FONT));
    }
    return map;
  }, [textNumberAttributes, rows, attrValueMap, pointAttributeOptions]);

  const getValue = (cell: Cell): CheckState => {
    if (cell.group === "commissioning") return rows[cell.r][CHECK_FIELDS[cell.c]];
    if (cell.group === "attributes")
      return getAttributeValue(attrValueMap, rows[cell.r].id, booleanAttributes[cell.c].id) as CheckState;
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
    const next = nextCheckState(getValue(cell));
    const pointId = rows[cell.r].id;
    if (cell.group === "commissioning") onSetValue(pointId, CHECK_FIELDS[cell.c], next);
    else if (cell.group === "attributes") onSetAttributeValue(pointId, booleanAttributes[cell.c].id, next);
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
    if (b.group === "attributes") {
      const updates: { point_id: string; point_attribute_id: string; value: string }[] = [];
      for (let r = b.rMin; r <= b.rMax; r++)
        for (let c = b.cMin; c <= b.cMax; c++)
          updates.push({ point_id: rows[r].id, point_attribute_id: booleanAttributes[c].id, value: state });
      onBulkSetAttributeValues(updates);
      return;
    }
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
      // Shared grid-walk (single-value fill-the-whole-selection vs. a real
      // multi-cell paste clipped to the selection/row bounds) -- the only
      // thing that differs per group is the shape of the resulting update
      // objects (a real column name for install/commissioning vs. an
      // attribute id for attributes), not how the grid itself is walked.
      const pastedCells = (grid: (CheckState | null)[][]): { r: number; c: number; value: CheckState }[] => {
        const cells: { r: number; c: number; value: CheckState }[] = [];
        if (grid.length === 1 && grid[0].length === 1 && (b.rMax > b.rMin || b.cMax > b.cMin)) {
          const v = grid[0][0];
          if (v === null) return cells;
          for (let r = b.rMin; r <= b.rMax; r++) for (let c = b.cMin; c <= b.cMax; c++) cells.push({ r, c, value: v });
        } else {
          for (let i = 0; i < grid.length; i++) {
            const r = b.rMin + i;
            if (r >= rows.length) break;
            for (let j = 0; j < grid[i].length; j++) {
              const c = b.cMin + j;
              if (c >= fieldCount(b.group)) break;
              const v = grid[i][j];
              if (v === null) continue;
              cells.push({ r, c, value: v });
            }
          }
        }
        return cells;
      };
      const paste = (grid: (CheckState | null)[][]) => {
        const cells = pastedCells(grid);
        if (!cells.length) return;
        if (b.group === "attributes") {
          onBulkSetAttributeValues(
            cells.map(({ r, c, value }) => ({ point_id: rows[r].id, point_attribute_id: booleanAttributes[c].id, value }))
          );
          return;
        }
        const dispatch = b.group === "commissioning" ? onBulkSetValues : onBulkSetInstallValues;
        dispatch(cells.map(({ r, c, value }) => ({ id: rows[r].id, field: fieldName({ group: b.group, r, c }), value })));
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
          {projectAttrs.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={showAttributes}
                onChange={(e) => setShowAttributes(e.target.checked)}
              />
              Attributes
            </label>
          )}
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
            <option value="">All Cx Status</option>
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
                  <th colSpan={INSTALL_FIELDS.length + 1} className="column-group-header column-group-install">
                    Install
                  </th>
                )}
                {showCommissioning &&
                  (showAttributes && projectAttrs.length > 0 ? (
                    <>
                      <th colSpan={CHECK_FIELDS.length} className="column-group-header column-group-commissioning">
                        Commissioning
                      </th>
                      <th colSpan={projectAttrs.length} className="column-group-header column-group-attributes"></th>
                      <th colSpan={2} className="column-group-header column-group-commissioning">
                        Commissioning
                      </th>
                    </>
                  ) : (
                    <th colSpan={CHECK_FIELDS.length + 2} className="column-group-header column-group-commissioning">
                      Commissioning
                    </th>
                  ))}
                {!showCommissioning && showAttributes && projectAttrs.length > 0 && (
                  <th colSpan={projectAttrs.length} className="column-group-header column-group-attributes"></th>
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
                  </>
                )}
                {showAttributes && projectAttrs.length > 0 && (
                  <>
                    {booleanAttributes.map((a, i) => (
                      <th key={`attr-${a.id}`} className={`checklist-item-header ${i === 0 ? "divider-left" : ""}`}>
                        {a.short_text || a.name}
                      </th>
                    ))}
                    {textNumberAttributes.map((a, i) => (
                      <th
                        key={`attr-${a.id}`}
                        className={`checklist-item-header-attr ${
                          i === 0 && booleanAttributes.length === 0 ? "divider-left" : ""
                        }`}
                        style={{ width: textNumberAttrColWidths.get(a.id) }}
                      >
                        {a.short_text || a.name}
                      </th>
                    ))}
                  </>
                )}
                {showCommissioning && (
                  <>
                    <th className="divider-left">Status</th>
                    <th
                      className="divider-left checklist-item-header-attr"
                      style={{ width: dateCommissionedColWidth }}
                    >
                      Date Commissioned
                    </th>
                  </>
                )}
                <th className="divider-left" style={{ width: notesColWidth }}>
                  Notes
                </th>
                <th className="divider-left">Blocked By</th>
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
                  (showInstall ? INSTALL_FIELDS.length + 1 : 0) +
                  (showCommissioning ? CHECK_FIELDS.length + 2 : 0) +
                  (showAttributes ? projectAttrs.length : 0);
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
                        {(openIssueCountByEquipment.get(g.equipmentId) ?? 0) > 0 && (
                          <>
                            {" "}
                            <span className="issue-count-pill">
                              <span className="issue-icon">!</span> {openIssueCountByEquipment.get(g.equipmentId)}{" "}
                              open issue{openIssueCountByEquipment.get(g.equipmentId) === 1 ? "" : "s"}
                            </span>
                          </>
                        )}
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
                            </>
                          )}
                          {showAttributes && projectAttrs.length > 0 && (
                            <>
                              {booleanAttributes.map((attr, c) => {
                                const cell: Cell = { group: "attributes", r, c };
                                const v = getValue(cell);
                                return (
                                  <td
                                    key={`attr-${attr.id}`}
                                    className={`checklist-cell checklist-${v || "empty"} ${
                                      c === 0 ? "divider-left" : ""
                                    } ${inSelection(cell) ? "checklist-selected" : ""}`}
                                    onClick={(e) => handleCellClick(cell, e)}
                                  >
                                    {SYMBOL[v]}
                                  </td>
                                );
                              })}
                              {textNumberAttributes.map((attr, i) => {
                                const value = getAttributeValue(attrValueMap, point.id, attr.id);
                                const options = optionsForAttribute(pointAttributeOptions, attr.id);
                                return (
                                  <td
                                    key={`attr-${attr.id}`}
                                    className={`checklist-text-col checklist-attr-col ${
                                      i === 0 && booleanAttributes.length === 0 ? "divider-left" : ""
                                    } ${value !== value.trim() ? "attr-stray-whitespace" : ""}`}
                                  >
                                    {options.length > 0 ? (
                                      <select
                                        className={`checklist-inline-input ${isAttrValueNA(value) ? "attr-value-na" : ""}`}
                                        value={value}
                                        onChange={(e) => onSetAttributeValue(point.id, attr.id, e.target.value)}
                                      >
                                        <option value="">{ATTR_NA_DISPLAY}</option>
                                        {!options.some((o) => o.value === value) && value && (
                                          <option value={value}>{value}</option>
                                        )}
                                        {options.map((o) => (
                                          <option key={o.id} value={o.value}>
                                            {o.value}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        key={`${point.id}-attr-${attr.id}`}
                                        className={`checklist-inline-input ${isAttrValueNA(value) ? "attr-value-na" : ""}`}
                                        type="text"
                                        inputMode={attr.attr_type === "number" ? "decimal" : "text"}
                                        defaultValue={isAttrValueNA(value) ? ATTR_NA_DISPLAY : value}
                                        onBlur={(e) => {
                                          const normalized = isAttrValueNA(e.target.value) ? "" : e.target.value;
                                          if (normalized !== value) onSetAttributeValue(point.id, attr.id, normalized);
                                        }}
                                      />
                                    )}
                                  </td>
                                );
                              })}
                            </>
                          )}
                          {showCommissioning && (
                            <>
                              <td className="divider-left status-cell">
                                <span className={`status-pill status-${point.status}`}>
                                  {POINT_STATUS_LABELS[point.status]}
                                </span>
                                <button
                                  type="button"
                                  className="btn-secondary mark-commissioned-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSetStatus(point.id, point.status === "commissioned" ? "in_progress" : "commissioned");
                                  }}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  {point.status === "commissioned" ? "Revert" : "Mark Commissioned"}
                                </button>
                              </td>
                              <td className="divider-left" style={{ width: dateCommissionedColWidth }}>
                                {formatDateCommissioned(point.date_commissioned)}
                              </td>
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
                          <td
                            className={`divider-left checklist-text-col ${
                              point.blocked_by ? "checklist-blocked" : ""
                            }`}
                          >
                            <input
                              key={`${point.id}-blocked`}
                              className="checklist-inline-input"
                              defaultValue={point.blocked_by}
                              placeholder="—"
                              onBlur={(e) => {
                                if (e.target.value !== point.blocked_by) onUpdatePoint(point, { blocked_by: e.target.value });
                              }}
                            />
                            {(() => {
                              const openCount = openIssueCount(issuesByPointId.get(point.id));
                              return (
                                <button
                                  type="button"
                                  className={`icon-btn issue-flag ${openCount > 0 ? "issue-flag-active" : ""}`}
                                  title={
                                    openCount > 0
                                      ? `${openCount} open issue${openCount === 1 ? "" : "s"}`
                                      : "No open issues — click to add one"
                                  }
                                  aria-label="Issues"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenIssues(point);
                                  }}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  {openCount > 0 ? (
                                    <>
                                      <span className="issue-icon">!</span> {openCount}
                                    </>
                                  ) : (
                                    "⚑"
                                  )}
                                </button>
                              );
                            })()}
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
