import MDBReader from "mdb-reader";

// Mirrors the legacy Engtool checksheet's VBA import (ImportAccessData.bas +
// VAVPoints.bas), but runs entirely client-side against the .mdb/.accdb file
// the user picks, instead of round-tripping through a CSV export.
//
// Three tables, read case-insensitively since real-world Access column
// casing doesn't always match the literal SQL text captured from the VBA:
//   - "Points List T": direct controller points (CP Panel, Point Number,
//     Descriptor, Part#, Analog/Digital) -> one equipment group per CP Panel.
//   - "Zone T": zone/VAV instances (CP Panel, Ref#, Type id, Location) ->
//     one equipment group per zone, keyed by Ref# (e.g. "VAV-101").
//   - "Zone type points list T": a point template per zone Type id (IP/OP,
//     point number, Descriptor, Part#), expanded against every zone instance
//     of that type.
//
// The expansion (VavPointNumb in VAVPoints.bas) builds each generated
// point's number from the ZONE's CP Panel + the template's IP/OP + point
// number (e.g. "20300.BI1101"), while the human-readable descriptor is built
// from the zone's Ref# + the template's descriptor (e.g. "VAV-101_RoomTemp").
// Point numbering and zone naming come from different source columns —
// easy to conflate, so keep them distinct here.

export interface ImportEquipmentDraft {
  tempId: string;
  tag: string;
  equipment_type: "cp_panel" | "zone";
  location?: string;
}

export interface ImportPointDraft {
  equipmentTempId: string;
  panel?: string;
  ip_op?: string;
  analog_digital?: string;
  point_number: string;
  descriptor?: string;
}

export interface ImportResult {
  equipment: ImportEquipmentDraft[];
  points: ImportPointDraft[];
}

type Row = Record<string, unknown>;

function field(row: Row, name: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return "";
  const value = row[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

function findTableName(reader: MDBReader, name: string): string {
  const match = reader.getTableNames().find((t) => t.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new Error(
      `Table "${name}" not found in this database. Available tables: ${reader.getTableNames().join(", ")}`
    );
  }
  return match;
}

export async function parseAccessFile(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const reader = new MDBReader(buffer);

  const pointsListRows = reader.getTable(findTableName(reader, "Points List T")).getData() as Row[];
  const zoneRows = reader.getTable(findTableName(reader, "Zone T")).getData() as Row[];
  const zoneTypePointRows = reader.getTable(findTableName(reader, "Zone type points list T")).getData() as Row[];

  return buildEquipmentAndPoints(pointsListRows, zoneRows, zoneTypePointRows);
}

// Pure transform, split out from the mdb-reader-specific file reading above
// so it can be exercised directly against fixture rows (see mdbImport.test.ts).
export function buildEquipmentAndPoints(pointsListRows: Row[], zoneRows: Row[], zoneTypePointRows: Row[]): ImportResult {
  const equipment: ImportEquipmentDraft[] = [];
  const points: ImportPointDraft[] = [];

  // Direct CP-panel points, grouped by CP Panel.
  const panelTempIdByTag = new Map<string, string>();
  for (const row of pointsListRows) {
    const panel = field(row, "CP Panel");
    let tempId = panelTempIdByTag.get(panel);
    if (!tempId) {
      tempId = `panel:${panel}`;
      panelTempIdByTag.set(panel, tempId);
      equipment.push({ tempId, tag: panel, equipment_type: "cp_panel" });
    }
    points.push({
      equipmentTempId: tempId,
      panel,
      ip_op: "",
      analog_digital: field(row, "Analog/Digital"),
      point_number: field(row, "Point Number"),
      descriptor: field(row, "Descriptor"),
    });
  }

  // Zone/VAV template points list, grouped by Type id for the expansion below.
  const templatesByType = new Map<string, Row[]>();
  for (const row of zoneTypePointRows) {
    const typeId = field(row, "Type id");
    const list = templatesByType.get(typeId);
    if (list) list.push(row);
    else templatesByType.set(typeId, [row]);
  }

  // Zone instances, expanded against their type's point templates.
  for (const zone of zoneRows) {
    const zonePanel = field(zone, "CP Panel");
    const zoneRef = field(zone, "Ref#");
    const typeId = field(zone, "Type id");
    const location = field(zone, "Location");

    const tempId = `zone:${zoneRef}`;
    equipment.push({ tempId, tag: zoneRef, equipment_type: "zone", location });

    const templates = templatesByType.get(typeId) ?? [];
    for (const tpl of templates) {
      const ipOp = field(tpl, "IP/OP");
      const tplPointNumber = field(tpl, "point number");
      const tplDescriptor = field(tpl, "Descriptor");
      points.push({
        equipmentTempId: tempId,
        panel: zonePanel,
        ip_op: ipOp,
        analog_digital: "",
        point_number: `${zonePanel}.${ipOp}${tplPointNumber}`,
        descriptor: `${zoneRef}_${tplDescriptor}`,
      });
    }
  }

  return { equipment, points };
}
