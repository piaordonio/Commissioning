import { Workbook, Worksheet } from "exceljs";
import {
  CHECK_FIELDS,
  CheckState,
  Equipment,
  INSTALL_FIELDS,
  InstallCheck,
  Issue,
  Point,
  PointAttribute,
  PointAttributeValue,
  Project,
} from "./types";
import { sanitizeFilenamePart } from "./exportXlsx";

// A full-fidelity project snapshot -- every checklist value, Note, Blocked
// By, the Issue Log, and custom attribute values, not just the
// point/equipment structure the .mdb import round-trips. Deliberately a
// separate workbook layout from exportXlsx.ts's pretty Commissioning/
// Install/Issues reports: those are tuned for human reading and sign-off
// (symbols, status pills, narrow columns), not for being read back in
// reliably, which is this file's one job. Plain column-per-field, one
// sheet per table, raw values -- no styling beyond a bold header row.
//
// INSTALL_FIELDS' own "Tagged" (the installer's self-attested tag) and
// CHECK_FIELDS' "Tagged" (Commissioning verifying it) are two different
// fields that happen to share a name -- see the comment on INSTALL_FIELDS
// in types.ts. Renamed to "install_tagged" here (and in the
// restore_project_backup RPC) to avoid a column collision; every other
// field name matches its database column exactly.
const POINT_COLUMNS = [
  "id",
  "equipment_id",
  "panel",
  "ip_op",
  "analog_digital",
  "point_number",
  "descriptor",
  "notes",
  "blocked_by",
  "active",
  "on_controller",
  "added_from_controller",
  ...CHECK_FIELDS,
  ...INSTALL_FIELDS.map((f) => (f === "tagged" ? "install_tagged" : f)),
] as const;

function addHeaderedSheet(workbook: Workbook, name: string, columns: readonly string[]): Worksheet {
  const ws = workbook.addWorksheet(name);
  ws.columns = columns.map((key) => ({ header: key, key }));
  ws.getRow(1).font = { bold: true };
  return ws;
}

export async function exportProjectBackup(
  project: Project,
  equipment: Equipment[],
  points: Point[],
  installChecks: InstallCheck[],
  issues: Issue[],
  pointAttributes: PointAttribute[],
  pointAttributeValues: PointAttributeValue[]
): Promise<void> {
  const installChecksByPointId = new Map(installChecks.map((ic) => [ic.point_id, ic]));
  const attributeById = new Map(pointAttributes.map((a) => [a.id, a]));

  const workbook = new Workbook();

  const eqSheet = addHeaderedSheet(workbook, "Equipment", [
    "id",
    "tag",
    "equipment_type",
    "location",
    "notes",
    "blocked_by",
  ]);
  for (const e of equipment) {
    eqSheet.addRow({
      id: e.id,
      tag: e.tag,
      equipment_type: e.equipment_type,
      location: e.location,
      notes: e.notes,
      blocked_by: e.blocked_by,
    });
  }

  const ptSheet = addHeaderedSheet(workbook, "Points", POINT_COLUMNS);
  for (const p of points) {
    const ic = installChecksByPointId.get(p.id);
    const row: Record<string, unknown> = {
      id: p.id,
      equipment_id: p.equipment_id,
      panel: p.panel,
      ip_op: p.ip_op,
      analog_digital: p.analog_digital,
      point_number: p.point_number,
      descriptor: p.descriptor,
      notes: p.notes,
      blocked_by: p.blocked_by,
      active: p.active,
      on_controller: p.on_controller,
      added_from_controller: p.added_from_controller,
    };
    for (const f of CHECK_FIELDS) row[f] = p[f];
    for (const f of INSTALL_FIELDS) row[f === "tagged" ? "install_tagged" : f] = ic ? ic[f] : "";
    ptSheet.addRow(row);
  }

  const issuesSheet = addHeaderedSheet(workbook, "Issues", [
    "point_id",
    "description",
    "recommended_action",
    "priority",
    "notes",
    "status",
    "created_at",
  ]);
  for (const i of issues) {
    issuesSheet.addRow({
      point_id: i.point_id,
      description: i.description,
      recommended_action: i.recommended_action,
      priority: i.priority,
      notes: i.notes,
      status: i.status,
      created_at: i.created_at,
    });
  }

  const attrSheet = addHeaderedSheet(workbook, "Attribute Values", [
    "point_id",
    "attribute_name",
    "attr_type",
    "value",
  ]);
  for (const v of pointAttributeValues) {
    const attr = attributeById.get(v.point_attribute_id);
    if (!attr) continue; // orphaned value from a since-deleted attribute definition -- nothing to restore it against anyway
    attrSheet.addRow({ point_id: v.point_id, attribute_name: attr.name, attr_type: attr.attr_type, value: v.value });
  }

  const filenameBase = sanitizeFilenamePart(
    project.project_number ? `${project.project_number} - ${project.name}` : project.name
  );
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase} - Backup.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Restore ----

export interface ParsedBackupPoint {
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
  on_controller: boolean | null;
  added_from_controller: boolean;
  [field: string]: unknown; // the CHECK_FIELDS/INSTALL_FIELDS (install_tagged included) columns, each a CheckState
}

export interface ParsedBackupIssue {
  point_id: string;
  description: string;
  recommended_action: string;
  priority: string;
  notes: string;
  status: string;
  created_at: string;
}

export interface ParsedBackupAttributeValue {
  point_id: string;
  attribute_name: string;
  value: string;
}

export interface ParsedBackup {
  equipment: { id: string; tag: string; equipment_type: string; location: string; notes: string; blocked_by: string }[];
  points: ParsedBackupPoint[];
  issues: ParsedBackupIssue[];
  attributeValues: ParsedBackupAttributeValue[];
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  // ExcelJS can hand back a {text, hyperlink} rich-value or a Date for a
  // cell that was never meant to be either -- this app only ever writes
  // plain strings/booleans/numbers to these columns, so anything else
  // means the file was hand-edited into a shape we don't expect; stringify
  // it rather than throw, same "don't trust an uploaded file" posture as
  // mdbImport.ts's own field() helper.
  if (typeof v === "object" && "text" in (v as any)) return String((v as any).text ?? "");
  return String(v);
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = toStr(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function toBoolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined || toStr(v).trim() === "") return null;
  return toBool(v);
}

const VALID_CHECK_STATES: readonly CheckState[] = ["", "check", "x", "na"];
function toCheckState(v: unknown): CheckState {
  const s = toStr(v).trim().toLowerCase();
  return (VALID_CHECK_STATES as readonly string[]).includes(s) ? (s as CheckState) : "";
}

// 1-based like ExcelJS's own row/column numbering -- row 1 is the header
// this function reads its keys from, so data starts at row 2.
function sheetRowsAsObjects(ws: Worksheet): Record<string, unknown>[] {
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = toStr(cell.value);
  });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) obj[key] = cell.value;
    });
    rows.push(obj);
  });
  return rows;
}

export async function parseProjectBackupWorkbook(file: File): Promise<ParsedBackup> {
  const buffer = await file.arrayBuffer();
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer);

  const eqWs = workbook.getWorksheet("Equipment");
  const ptWs = workbook.getWorksheet("Points");
  if (!eqWs || !ptWs) {
    throw new Error("This doesn't look like a project backup file -- missing the Equipment/Points sheets.");
  }
  const issuesWs = workbook.getWorksheet("Issues");
  const attrWs = workbook.getWorksheet("Attribute Values");

  const equipment = sheetRowsAsObjects(eqWs).map((r) => ({
    id: toStr(r.id),
    tag: toStr(r.tag),
    equipment_type: toStr(r.equipment_type),
    location: toStr(r.location),
    notes: toStr(r.notes),
    blocked_by: toStr(r.blocked_by),
  }));

  const points: ParsedBackupPoint[] = sheetRowsAsObjects(ptWs).map((r) => {
    const point: ParsedBackupPoint = {
      id: toStr(r.id),
      equipment_id: toStr(r.equipment_id),
      panel: toStr(r.panel),
      ip_op: toStr(r.ip_op),
      analog_digital: toStr(r.analog_digital),
      point_number: toStr(r.point_number),
      descriptor: toStr(r.descriptor),
      notes: toStr(r.notes),
      blocked_by: toStr(r.blocked_by),
      active: toBool(r.active),
      on_controller: toBoolOrNull(r.on_controller),
      added_from_controller: toBool(r.added_from_controller),
    };
    for (const f of CHECK_FIELDS) point[f] = toCheckState(r[f]);
    for (const f of INSTALL_FIELDS) {
      const key = f === "tagged" ? "install_tagged" : f;
      point[key] = toCheckState(r[key]);
    }
    return point;
  });

  const issues: ParsedBackupIssue[] = issuesWs
    ? sheetRowsAsObjects(issuesWs).map((r) => ({
        point_id: toStr(r.point_id),
        description: toStr(r.description),
        recommended_action: toStr(r.recommended_action),
        priority: toStr(r.priority) || "normal",
        notes: toStr(r.notes),
        status: toStr(r.status) || "open",
        created_at: (() => {
          const v = r.created_at;
          if (v instanceof Date) return v.toISOString();
          const s = toStr(v);
          const parsed = s ? new Date(s) : null;
          return parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
        })(),
      }))
    : [];

  const attributeValues: ParsedBackupAttributeValue[] = attrWs
    ? sheetRowsAsObjects(attrWs).map((r) => ({
        point_id: toStr(r.point_id),
        attribute_name: toStr(r.attribute_name),
        value: toStr(r.value),
      }))
    : [];

  return { equipment, points, issues, attributeValues };
}
