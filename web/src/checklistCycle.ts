import { CheckState } from "./types";

// Shared between PointsView.tsx (the desktop grid, click-to-cycle) and
// PointsCardList.tsx (the phone view, tap-to-cycle) so both walk through
// exactly the same ✓ / ✗ / N/A / blank order.
export const SYMBOL: Record<CheckState, string> = { "": "", check: "✓", x: "✗", na: "N/A" };
export const CYCLE: CheckState[] = ["", "check", "x", "na"];

export function nextCheckState(current: CheckState): CheckState {
  return CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
}
