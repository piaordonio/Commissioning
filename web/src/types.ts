export type CheckState = "" | "check" | "x" | "na";

export const CHECK_FIELDS = [
  "wired",
  "tagged",
  "end_to_end",
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
  end_to_end: "End-to-End",
  calibrate: "Calibrate",
  function_test: "Function Test",
  sequence: "Sequence",
  alarm: "Alarm",
  graphics: "Graphics",
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
