export type CheckState = "" | "check" | "x" | "na";

// End-to-End lives under Install (see INSTALL_FIELDS below), not here --
// it's verified during Function Test rather than tracked as its own
// commissioning field.
export const CHECK_FIELDS = [
  "wired",
  "tagged",
  "calibrate",
  "function_test",
  "sequence",
  "alarm",
  "graphics",
] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];

export const CHECK_FIELD_LABELS: Record<CheckField, string> = {
  wired: "Wired",
  tagged: "Tagged",
  calibrate: "Calibrate",
  function_test: "Function Test",
  sequence: "Sequence",
  alarm: "Alarm",
  graphics: "Graphics",
};

// The installer's own checksheet, tracked separately from the commissioning
// checklist above -- installers are often still pulling/mounting/terminating
// while someone else is commissioning a different point, and this list is
// weighted rather than equally-weighted (installProgress() in
// web/src/installProgress.ts uses INSTALL_FIELD_WEIGHTS, not a plain
// count-of-checked like pointProgress()). "Tagged" here is the installer's
// own self-attested tag, independent of the Commissioning "Tagged" field
// (which is you verifying it).
export const INSTALL_FIELDS = [
  "pipe_flex",
  "pulled",
  "mounted",
  "panel_term",
  "field_term",
  "tagged",
  "end_to_end",
] as const;
export type InstallField = (typeof INSTALL_FIELDS)[number];

export const INSTALL_FIELD_LABELS: Record<InstallField, string> = {
  pipe_flex: "Pipe/Flex",
  pulled: "Pulled",
  mounted: "Mounted",
  panel_term: "Panel Term.",
  field_term: "Field Term.",
  tagged: "Tagged",
  end_to_end: "End-to-End",
};

export const INSTALL_FIELD_WEIGHTS: Record<InstallField, number> = {
  pipe_flex: 40,
  pulled: 30,
  mounted: 10,
  panel_term: 10,
  field_term: 5,
  tagged: 2,
  end_to_end: 3,
};

export type PointStatus = "not_started" | "in_progress" | "commissioned";

export const POINT_STATUS_LABELS: Record<PointStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  commissioned: "Commissioned",
};

export interface Project {
  id: string;
  project_number: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Equipment {
  id: string;
  project_id: string;
  tag: string;
  equipment_type: string;
  location: string;
  notes: string;
  blocked_by: string;
  // false = not present in the most recent import (removed/renamed at the
  // source) — never hard-deleted by re-import. See import_points() in
  // supabase/schema.sql.
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type Point = {
  id: string;
  equipment_id: string;
  panel: string;
  ip_op: string;
  analog_digital: string;
  point_number: string;
  descriptor: string;
  notes: string;
  blocked_by: string;
  active: boolean;
  // null = never checked against a controller export; true/false = result
  // of the last check. See set_controller_status() in supabase/schema.sql.
  on_controller: boolean | null;
  // true only for a point created via "Add as New Point" -- provenance,
  // never recomputed by a later check or re-import.
  added_from_controller: boolean;
  // Maintained entirely by set_point_status_and_date() in
  // supabase/schema.sql -- never written directly by the app.
  status: PointStatus;
  date_commissioned: string | null;
  created_at: string;
  updated_at: string;
} & Record<CheckField, CheckState>;

// One row per point (point_id unique), auto-created server-side the moment
// a point is inserted -- see create_install_check_for_point() in
// supabase/schema.sql -- so the frontend can always assume one exists for
// every point without a null-check at the call site.
export type InstallCheck = {
  id: string;
  point_id: string;
  created_at: string;
  updated_at: string;
} & Record<InstallField, CheckState>;

export type IssueStatus = "open" | "closed";

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  closed: "Closed",
};

// Belongs to exactly one point (point_id FK, cascade delete with the
// point) -- independent of Point.blocked_by, which stays a plain free-text
// field. A point can have any number of issues, open or closed; see
// web/src/issues.ts for the rollup helpers built on top of this.
export interface Issue {
  id: string;
  point_id: string;
  description: string;
  recommended_action: string;
  // Report-only: entered alongside description/recommended_action when the
  // issue is logged, but only ever displayed in PointsReport.tsx's Issues
  // mode -- the interactive issue log (IssuesModal, Dashboard) never shows
  // it, so this stays a place for handoff-document context without
  // cluttering the on-screen views a tech checks while working a point.
  notes: string;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
}
