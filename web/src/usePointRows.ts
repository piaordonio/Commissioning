import { useMemo } from "react";
import { Equipment, InstallCheck, Point, PointStatus } from "./types";
import { InstallStatus, installStatus } from "./installProgress";
import { resolvedPointNumber, displayPanel } from "./pointNumber";

export interface PointRowFilters {
  showRemoved: boolean;
  panelFilter: string;
  statusFilter: PointStatus | "";
  installStatusFilter: InstallStatus | "";
  search: string;
}

export interface PointGroup {
  equipmentId: string;
  items: Point[];
}

// Shared by PointsView.tsx (the desktop grid) and PointsCardList.tsx (the phone
// view) so both filter/sort/group points identically -- one source of truth for
// which rows show and in what order, rather than two independent
// implementations that happen to agree today and drift apart later.
export function usePointRows(
  points: Point[],
  equipment: Equipment[],
  installChecksByPointId: Map<string, InstallCheck>,
  filters: PointRowFilters
) {
  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment]);

  // Progress/rollups reflect the full active set regardless of the filters
  // below -- a removed point shouldn't count toward (or against) completion
  // just because it's temporarily visible for review, and a panel/status
  // filter narrowing what's *displayed* shouldn't change what's *true*.
  const activePoints = useMemo(() => points.filter((p) => p.active), [points]);
  const removedCount = points.length - activePoints.length;

  const visiblePoints = filters.showRemoved ? points : activePoints;

  const panelOptions = useMemo(
    () => Array.from(new Set(visiblePoints.map((p) => displayPanel(p.panel)))).sort((a, b) => a.localeCompare(b)),
    [visiblePoints]
  );

  // One search box covers both a point type (typing "AI" matches every
  // Analog Input, since the resolved point number already embeds that
  // token) and free text anywhere in the descriptor.
  const filteredPoints = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return visiblePoints.filter((p) => {
      if (filters.panelFilter && displayPanel(p.panel) !== filters.panelFilter) return false;
      if (filters.statusFilter && p.status !== filters.statusFilter) return false;
      if (
        filters.installStatusFilter &&
        installStatus(installChecksByPointId.get(p.id)) !== filters.installStatusFilter
      )
        return false;
      if (!query) return true;
      return resolvedPointNumber(p).toLowerCase().includes(query) || p.descriptor.toLowerCase().includes(query);
    });
  }, [
    visiblePoints,
    filters.panelFilter,
    filters.statusFilter,
    filters.installStatusFilter,
    installChecksByPointId,
    filters.search,
  ]);

  const rows = useMemo(
    () =>
      [...filteredPoints].sort((a, b) => {
        const ta = equipmentById[a.equipment_id]?.tag ?? "";
        const tb = equipmentById[b.equipment_id]?.tag ?? "";
        return ta === tb ? a.point_number.localeCompare(b.point_number) : ta.localeCompare(tb);
      }),
    [filteredPoints, equipmentById]
  );

  const groups = useMemo(() => {
    const list: PointGroup[] = [];
    for (const p of rows) {
      const last = list[list.length - 1];
      if (last && last.equipmentId === p.equipment_id) last.items.push(p);
      else list.push({ equipmentId: p.equipment_id, items: [p] });
    }
    return list;
  }, [rows]);

  return { equipmentById, activePoints, removedCount, panelOptions, rows, groups };
}
