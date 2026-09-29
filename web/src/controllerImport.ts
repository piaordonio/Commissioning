// Parses an EnteliWEB "Points List" CSV export (Device, Object ID, Name,
// Sensor Type, Calibration, Flags) into rows we can cross-check against the
// design points list already tracked for a project. No dependency needed —
// the real export is plain CSV with no banner/footer rows, just a header
// row followed by data:
//   Device,Object ID,Name,Sensor Type,Calibration,Flags
//   20300,20300.AI83,CPU Board Temperature,eBUS DCE Temp AIC,0,
//
// Handled defensively in case a copy gets hand-edited/re-saved in Excel
// (which can add a title/site/date banner above the header, a group-label
// row below it, and a "Total : N Objects" footer) without depending on
// their exact wording: the header row is found by looking for a cell that
// reads "Object ID", and a row counts as data only if its Object ID cell
// contains a "." (device.point format) — which a banner, group-label, or
// footer row never does.

export interface ControllerPointRow {
  device: string;
  object_id: string;
  name: string;
  sensor_type: string;
  calibration: string;
  flags: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

export function parseControllerPoints(csvText: string): ControllerPointRow[] {
  const lines = csvText.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  const rows = lines.map(parseCsvLine);

  const headerIdx = rows.findIndex((r) => r.some((cell) => cell.toLowerCase() === "object id"));
  if (headerIdx === -1) {
    throw new Error('Could not find an "Object ID" column header in this file.');
  }
  const header = rows[headerIdx].map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idxDevice = col("device");
  const idxObjectId = col("object id");
  const idxName = col("name");
  const idxSensorType = col("sensor type");
  const idxCalibration = col("calibration");
  const idxFlags = col("flags");

  const result: ControllerPointRow[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const objectId = row[idxObjectId] ?? "";
    if (!objectId.includes(".")) continue; // banner / group-label / "Total : N Objects" footer row
    result.push({
      device: idxDevice >= 0 ? row[idxDevice] ?? "" : "",
      object_id: objectId,
      name: idxName >= 0 ? row[idxName] ?? "" : "",
      sensor_type: idxSensorType >= 0 ? row[idxSensorType] ?? "" : "",
      calibration: idxCalibration >= 0 ? row[idxCalibration] ?? "" : "",
      flags: idxFlags >= 0 ? row[idxFlags] ?? "" : "",
    });
  }
  return result;
}
