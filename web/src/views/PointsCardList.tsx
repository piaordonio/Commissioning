import { useMemo, useState } from "react";
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
import { formatDateCommissioned } from "../formatDate";
import { SYMBOL, nextCheckState } from "../checklistCycle";
import { usePointRows } from "../usePointRows";
import { buildOpenIssueCountByEquipment, groupIssuesByPointId, openIssueCount } from "../issues";
import { attributesForProject, buildAttributeValueMap, getAttributeValue, optionsForAttribute } from "../pointAttributes";

// The phone-width counterpart to PointsView.tsx -- same data and handler
// shapes, entirely different markup. PointsView.tsx's grid is real <table>
// semantics (colSpan tricks, sticky columns, a selection engine keyed to
// visual row/column indices) that doesn't translate to a phone width via CSS
// alone, so this is a second purpose-built view instead, the same way
// PointsReport.tsx already exists instead of a print stylesheet grafted onto
// the grid. No selection state, no keyboard shortcuts, no bulk-fill --
// confirmed the field workflow here is single point at a time, tap to cycle.
export function PointsCardList({
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
  onSetInstallValue,
  onUpdatePoint,
  onDeletePoint,
  onOpenIssues,
  onSetAttributeValue,
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
  onSetInstallValue: (pointId: string, field: InstallField, value: CheckState) => void;
  onUpdatePoint: (point: Point, patch: Partial<Point>) => void;
  onDeletePoint: (point: Point) => void;
  onOpenIssues: (point: Point) => void;
  onSetAttributeValue: (pointId: string, attributeId: string, value: string) => void;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [panelFilter, setPanelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<PointStatus | "">("");
  const [installStatusFilter, setInstallStatusFilter] = useState<InstallStatus | "">("");
  const [search, setSearch] = useState("");
  const [showInstall, setShowInstall] = useState(true);
  const [showCommissioning, setShowCommissioning] = useState(true);
  // Collapsed by default, same reasoning as the header's Actions toggle and
  // each point card -- the filters aren't needed to check off a point
  // you've already found, only to narrow the list down to it.
  const [showFilters, setShowFilters] = useState(false);
  // Collapsed by default, same reasoning as the header's Actions toggle --
  // with many points on a job, showing just name + status flags per card
  // lets you scan the list quickly and expand only the one you're actually
  // standing at, rather than scrolling past a full checklist for every
  // point. Independent per point (not an accordion), so more than one can
  // be open if you're working two points at once.
  const [expandedPointIds, setExpandedPointIds] = useState<Set<string>>(new Set());
  const togglePoint = (id: string) => {
    setExpandedPointIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const installChecksByPointId = useMemo(
    () => new Map(installChecks.map((ic) => [ic.point_id, ic])),
    [installChecks]
  );
  const issuesByPointId = useMemo(() => groupIssuesByPointId(issues), [issues]);

  const attrs = useMemo(
    () => attributesForProject(pointAttributes, pointAttributeProjects, projectId),
    [pointAttributes, pointAttributeProjects, projectId]
  );
  const booleanAttrs = useMemo(() => attrs.filter((a) => a.attr_type === "boolean"), [attrs]);
  const textNumberAttrs = useMemo(() => attrs.filter((a) => a.attr_type !== "boolean"), [attrs]);
  const attrValueMap = useMemo(() => buildAttributeValueMap(pointAttributeValues), [pointAttributeValues]);

  const { equipmentById, activePoints, removedCount, panelOptions, rows, groups } = usePointRows(
    points,
    equipment,
    installChecksByPointId,
    { showRemoved, panelFilter, statusFilter, installStatusFilter, search }
  );

  const progressByEquipment = useMemo(() => buildProgressByEquipment(activePoints), [activePoints]);
  const installProgressByEquipment = useMemo(
    () => buildInstallProgressByEquipment(activePoints, installChecksByPointId),
    [activePoints, installChecksByPointId]
  );
  const openIssueCountByEquipment = useMemo(
    () => buildOpenIssueCountByEquipment(activePoints, issuesByPointId),
    [activePoints, issuesByPointId]
  );

  const cycleInstall = (point: Point, field: InstallField) => {
    const ic = installChecksByPointId.get(point.id);
    onSetInstallValue(point.id, field, nextCheckState(ic ? ic[field] : ""));
  };
  const cycleCommissioning = (point: Point, field: CheckField) => {
    onSetValue(point.id, field, nextCheckState(point[field]));
  };
  const cycleAttribute = (point: Point, attr: PointAttribute) => {
    const current = getAttributeValue(attrValueMap, point.id, attr.id) as CheckState;
    onSetAttributeValue(point.id, attr.id, nextCheckState(current));
  };

  const activeFilterCount = [panelFilter, statusFilter, installStatusFilter, search].filter(Boolean).length;

  return (
    <div className="view mobile-view">
      <button
        type="button"
        className="btn-secondary mobile-filters-toggle"
        onClick={() => setShowFilters((v) => !v)}
      >
        {showFilters
          ? "Hide Filters ▲"
          : `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""} ▾`}
      </button>
      {showFilters && (
        <div className="mobile-toolbar">
          <div className="mobile-columns-toggle">
            <span>Columns</span>
            <label className="mobile-checkbox-row">
              <input type="checkbox" checked={showInstall} onChange={(e) => setShowInstall(e.target.checked)} />
              Install
            </label>
            <label className="mobile-checkbox-row">
              <input
                type="checkbox"
                checked={showCommissioning}
                onChange={(e) => setShowCommissioning(e.target.checked)}
              />
              Commissioning
            </label>
          </div>
          <select value={panelFilter} onChange={(e) => setPanelFilter(e.target.value)}>
            <option value="">All Panels</option>
            {panelOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PointStatus | "")}>
            <option value="">All Cx Status</option>
            {(Object.keys(POINT_STATUS_LABELS) as PointStatus[]).map((s) => (
              <option key={s} value={s}>
                {POINT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={installStatusFilter}
            onChange={(e) => setInstallStatusFilter(e.target.value as InstallStatus | "")}
          >
            <option value="">All Install Statuses</option>
            {(Object.keys(INSTALL_STATUS_LABELS) as InstallStatus[]).map((s) => (
              <option key={s} value={s}>
                {INSTALL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search type (AI/AO/BI/BO) or descriptor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {removedCount > 0 && (
            <label className="mobile-checkbox-row">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
              Show {removedCount} removed point{removedCount === 1 ? "" : "s"}
            </label>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          {points.length === 0
            ? "No points yet. Import an Access database to get started."
            : "No points match this filter."}
        </div>
      ) : (
        <div className="mobile-card-scroll">
          {groups.map((g) => {
            const eq = equipmentById[g.equipmentId];
            const pct = progressByEquipment.get(g.equipmentId) ?? 0;
            const installPct = installProgressByEquipment.get(g.equipmentId) ?? 0;
            return (
              <div key={g.equipmentId} className="mobile-equipment-group">
                <div className="mobile-equipment-header">
                  <span>
                    {eq?.tag ?? g.equipmentId}
                    {eq?.location ? ` — ${eq.location}` : ""}
                  </span>
                  <span className="count-pill">{g.items.length}</span>
                  <span
                    className={`progress-pill ${
                      installPct > 90 ? "progress-pill-high" : installPct < 10 ? "progress-pill-low" : ""
                    }`}
                  >
                    Install {installPct}%
                  </span>
                  <span
                    className={`progress-pill ${pct > 90 ? "progress-pill-high" : pct < 10 ? "progress-pill-low" : ""}`}
                  >
                    Commissioning {pct}%
                  </span>
                  {(openIssueCountByEquipment.get(g.equipmentId) ?? 0) > 0 && (
                    <span className="issue-count-pill">
                      <span className="issue-icon">!</span> {openIssueCountByEquipment.get(g.equipmentId)} open issue
                      {openIssueCountByEquipment.get(g.equipmentId) === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {g.items.map((point) => {
                  const ic = installChecksByPointId.get(point.id);
                  const isExpanded = expandedPointIds.has(point.id);
                  return (
                    <div
                      key={point.id}
                      className="mobile-point-card"
                      style={point.active ? undefined : { opacity: 0.55 }}
                    >
                      <div className="mobile-point-header">
                        <div className="mobile-point-title">
                          <span className="mono">{resolvedPointNumber(point)}</span>
                          <span className="muted-text">{displayPanel(point.panel)}</span>
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Delete point"
                          onClick={() => onDeletePoint(point)}
                        >
                          🗑
                        </button>
                      </div>

                      <button
                        type="button"
                        className="mobile-point-summary"
                        aria-expanded={isExpanded}
                        onClick={() => togglePoint(point.id)}
                      >
                        <div className="mobile-point-summary-main">
                          <div className="mobile-point-descriptor">
                            {point.descriptor}
                            {!point.active && <span className="muted-text"> (removed)</span>}
                          </div>
                          <div className="mobile-point-status-row">
                            {showInstall && (
                              <span className={`status-pill status-${installStatus(ic)}`}>
                                Install: {INSTALL_STATUS_LABELS[installStatus(ic)]}
                              </span>
                            )}
                            {showCommissioning && (
                              <span className={`status-pill status-${point.status}`}>
                                Commissioning: {POINT_STATUS_LABELS[point.status]}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="mobile-point-chevron" aria-hidden="true">
                          {isExpanded ? "▲" : "▾"}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="mobile-point-body">
                          {(point.on_controller === false ||
                            point.added_from_controller ||
                            (showCommissioning && point.date_commissioned)) && (
                            <div className="mobile-point-status-row">
                              {showCommissioning && point.date_commissioned && (
                                <span className="muted-text">
                                  Commissioned {formatDateCommissioned(point.date_commissioned)}
                                </span>
                              )}
                              {point.on_controller === false && (
                                <span className="controller-missing-pill">Not on Controller</span>
                              )}
                              {point.added_from_controller && (
                                <span className="controller-added-pill">Added from Controller</span>
                              )}
                            </div>
                          )}
                          {showInstall && (
                            <div className="mobile-field-group">
                              <div className="mobile-field-group-label column-group-install">Install</div>
                              {INSTALL_FIELDS.map((field) => {
                                const v = ic ? ic[field] : "";
                                return (
                                  <button
                                    type="button"
                                    key={field}
                                    className={`mobile-field-row mobile-field-row-${v || "empty"}`}
                                    onClick={() => cycleInstall(point, field)}
                                  >
                                    <span>{INSTALL_FIELD_LABELS[field]}</span>
                                    <span className={`mobile-field-value checklist-${v || "empty"}`}>
                                      {SYMBOL[v] || "—"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {showCommissioning && (
                            <div className="mobile-field-group">
                              <div className="mobile-field-group-label column-group-commissioning">
                                Commissioning
                              </div>
                              {CHECK_FIELDS.map((field) => {
                                const v = point[field];
                                return (
                                  <button
                                    type="button"
                                    key={field}
                                    className={`mobile-field-row mobile-field-row-${v || "empty"}`}
                                    onClick={() => cycleCommissioning(point, field)}
                                  >
                                    <span>{CHECK_FIELD_LABELS[field]}</span>
                                    <span className={`mobile-field-value checklist-${v || "empty"}`}>
                                      {SYMBOL[v] || "—"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {attrs.length > 0 && (
                            <div className="mobile-field-group">
                              <div className="mobile-field-group-label column-group-attributes">Attributes</div>
                              {booleanAttrs.map((attr) => {
                                const v = getAttributeValue(attrValueMap, point.id, attr.id) as CheckState;
                                return (
                                  <button
                                    type="button"
                                    key={attr.id}
                                    className={`mobile-field-row mobile-field-row-${v || "empty"}`}
                                    onClick={() => cycleAttribute(point, attr)}
                                  >
                                    <span>{attr.short_text || attr.name}</span>
                                    <span className={`mobile-field-value checklist-${v || "empty"}`}>
                                      {SYMBOL[v] || "—"}
                                    </span>
                                  </button>
                                );
                              })}
                              {textNumberAttrs.map((attr) => {
                                const value = getAttributeValue(attrValueMap, point.id, attr.id);
                                const options = optionsForAttribute(pointAttributeOptions, attr.id);
                                return (
                                  <label key={attr.id} className="mobile-text-field">
                                    {attr.short_text || attr.name}
                                    {options.length > 0 ? (
                                      <select
                                        className="mobile-input"
                                        value={value}
                                        onChange={(e) => onSetAttributeValue(point.id, attr.id, e.target.value)}
                                      >
                                        <option value="">—</option>
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
                                        className="mobile-input"
                                        type={attr.attr_type === "number" ? "number" : "text"}
                                        defaultValue={value}
                                        placeholder="—"
                                        onBlur={(e) => {
                                          if (e.target.value !== value) onSetAttributeValue(point.id, attr.id, e.target.value);
                                        }}
                                      />
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          <label className="mobile-text-field">
                            Notes
                            <input
                              className="mobile-input"
                              defaultValue={point.notes}
                              placeholder="—"
                              onBlur={(e) => {
                                if (e.target.value !== point.notes) onUpdatePoint(point, { notes: e.target.value });
                              }}
                            />
                          </label>
                          <label className="mobile-text-field">
                            Blocked By
                            <div className="mobile-input-row">
                              <input
                                className={`mobile-input ${point.blocked_by ? "checklist-blocked" : ""}`}
                                defaultValue={point.blocked_by}
                                placeholder="—"
                                onBlur={(e) => {
                                  if (e.target.value !== point.blocked_by)
                                    onUpdatePoint(point, { blocked_by: e.target.value });
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
                                        : "No open issues — tap to add one"
                                    }
                                    aria-label="Issues"
                                    onClick={() => onOpenIssues(point)}
                                  >
                                    {openCount > 0 ? `! ${openCount}` : "⚑"}
                                  </button>
                                );
                              })()}
                            </div>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
