export type CheckState = "" | "check" | "x" | "na";

export const CHECK_FIELDS = ["wired", "tagged", "end_to_end", "calibrate", "sequence", "alarm", "graphics"] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];

export const CHECK_FIELD_LABELS: Record<CheckField, string> = {
  wired: "Wired",
  tagged: "Tagged",
  end_to_end: "End-to-End",
  calibrate: "Calibrate",
  sequence: "Sequence",
  alarm: "Alarm",
  graphics: "Graphics",
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
  created_at: string;
  updated_at: string;
} & Record<CheckField, CheckState>;
