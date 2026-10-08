import { Workbook, Worksheet } from "exceljs";
import {
  CHECK_FIELDS,
  CHECK_FIELD_LABELS,
  CheckState,
  Equipment,
  INSTALL_FIELDS,
  INSTALL_FIELD_LABELS,
  InstallCheck,
  ISSUE_STATUS_LABELS,
  Issue,
  Point,
  POINT_STATUS_LABELS,
  PointAttribute,
  Project,
} from "./types";
import { installStatus, InstallStatus, INSTALL_STATUS_LABELS } from "./installProgress";
import { openIssueCount } from "./issues";
import { getAttributeValue, isAttrValueNA, ATTR_NA_DISPLAY } from "./pointAttributes";
import { resolvedPointNumber, displayPanel } from "./pointNumber";
import { formatDateCommissioned, formatTimestamp } from "./formatDate";

// Only ever writes a workbook built from our own in-memory data -- never
// reads/parses a file someone else produced -- so the parser-side issues
// tied to reading untrusted spreadsheets don't apply to how this app uses
// either this library or the browser APIs below.

// Hand-mirrored from the CSS custom properties and class rules in
// styles.css (search for each hex value there) -- there's no shared source
// of truth between the two, so a future palette change needs updating both
// places. Hex values carry an alpha-free ARGB "FF" prefix, which is what
// ExcelJS's color API expects.
const COLOR = {
  text: "FF1E293B",
  muted: "FF64748B",
  border: "FFE2E8F0",
  white: "FFFFFFFF",
  accent: "FF2563EB",
  headerBg: "FFF8FAFC",
  check: "FF16A34A",
  x: "FFDC2626",
  na: "FF94A3B8",
  notStartedBg: "FFF1F5F9",
  notStartedText: "FF64748B",
  inProgressBg: "FFFEF3C7",
  inProgressText: "FF92400E",
  doneBg: "FFDCFCE7",
  doneText: "FF166534",
  issuePillBg: "FFFFEDD5",
  issuePillText: "FF9A3412",
  blockedWarnText: "FFDC2626",
} as const;

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  not_started: { bg: COLOR.notStartedBg, color: COLOR.notStartedText },
  in_progress: { bg: COLOR.inProgressBg, color: COLOR.inProgressText },
  commissioned: { bg: COLOR.doneBg, color: COLOR.doneText },
  complete: { bg: COLOR.doneBg, color: COLOR.doneText },
  open: { bg: COLOR.inProgressBg, color: COLOR.inProgressText },
  closed: { bg: COLOR.doneBg, color: COLOR.doneText },
};

export function sanitizeFilenamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-");
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// The report's print header shows the Ainsworth letterhead inline with the
// project title (see .report-title-row in styles.css) -- fetched here
// rather than bundled as a data: URI so the export always reflects
// whichever file currently sits at web/public/ainsworth-logo.jpg.
async function fetchLogoBase64(): Promise<string | null> {
  try {
    const res = await fetch("/ainsworth-logo.jpg");
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    // btoa needs a plain binary string; chunking avoids blowing the call
    // stack on String.fromCharCode(...bytes) for a large-enough image.
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

// --- Generic report-shaped sheet construction -----------------------------
// Mirrors PointsReport.tsx's own JSX structure (header, table header row,
// one merged group-header bar per equipment, then its point rows) closely
// enough that the three build*Xlsx() functions below read as a direct
// translation of that component's three render branches, cell by cell.

type CellSpec = {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
  color?: string;
  bg?: string;
  divider?: boolean;
  richText?: { text: string; bold?: boolean; color?: string }[];
};

function addReportHeader(ws: Worksheet, colCount: number, title: string, meta: string, logoBase64: string | null) {
  const lastCol = colLetter(colCount);
  ws.getRow(1).height = 26;
  if (logoBase64) {
    const imageId = ws.workbook.addImage({ base64: logoBase64, extension: "jpeg" });
    // Source logo is 200x63 -- keep that ~3.17:1 aspect ratio at report scale.
    ws.addImage(imageId, { tl: { col: 0.1, row: 0.15 }, ext: { width: 66, height: 21 } });
  }
  ws.mergeCells(`B1:${lastCol}1`);
  const titleCell = ws.getCell("B1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: COLOR.text } };
  titleCell.alignment = { vertical: "middle" };

  ws.mergeCells(`A2:${lastCol}2`);
  const metaCell = ws.getCell("A2");
  metaCell.value = meta;
  metaCell.font = { italic: true, size: 10, color: { argb: COLOR.muted } };
  metaCell.alignment = { vertical: "middle" };

  return 4; // row 3 left blank as a spacer; table header starts at row 4
}

function addTableHeaderRow(ws: Worksheet, rowIndex: number, headers: { text: string; divider?: boolean }[]) {
  const row = ws.getRow(rowIndex);
  row.height = 22;
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h.text;
    cell.font = { bold: true, size: 10, color: { argb: COLOR.muted } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerBg } };
    cell.border = {
      bottom: { style: "thin", color: { argb: COLOR.border } },
      ...(h.divider ? { left: { style: "thin", color: { argb: COLOR.border } } } : {}),
    };
  });
}

function addGroupHeaderRow(ws: Worksheet, rowIndex: number, colCount: number, text: string) {
  ws.mergeCells(rowIndex, 1, rowIndex, colCount);
  const cell = ws.getCell(rowIndex, 1);
  cell.value = text;
  cell.font = { bold: true, size: 10, color: { argb: COLOR.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.accent } };
  cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  ws.getRow(rowIndex).height = 18;
}

function writeDataRow(ws: Worksheet, rowIndex: number, cells: CellSpec[]) {
  const row = ws.getRow(rowIndex);
  cells.forEach((spec, i) => {
    const cell = row.getCell(i + 1);
    if (spec.richText) {
      cell.value = {
        richText: spec.richText.map((r) => ({
          text: r.text,
          font: { size: 10, bold: r.bold, color: { argb: r.color ?? COLOR.text } },
        })),
      };
    } else {
      cell.value = spec.text;
    }
    cell.font = { size: 10, bold: !!spec.bold, color: { argb: spec.color ?? COLOR.text } };
    cell.alignment = { horizontal: spec.align ?? "left", vertical: "middle" };
    if (spec.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: spec.bg } };
    cell.border = {
      bottom: { style: "thin", color: { argb: COLOR.border } },
      ...(spec.divider ? { left: { style: "thin", color: { argb: COLOR.border } } } : {}),
    };
  });
}

function checkCellSpec(value: CheckState, divider = false): CellSpec {
  if (value === "check") return { text: "✓", align: "center", bold: true, color: COLOR.check, divider };
  if (value === "x") return { text: "✗", align: "center", bold: true, color: COLOR.x, divider };
  if (value === "na") return { text: "N/A", align: "center", bold: true, color: COLOR.na, divider };
  return { text: "", align: "center", divider };
}

function statusCellSpec(label: string, statusKey: string, divider = true): CellSpec {
  const colors = STATUS_COLORS[statusKey] ?? { bg: COLOR.notStartedBg, color: COLOR.notStartedText };
  return { text: label, align: "center", bold: true, bg: colors.bg, color: colors.color, divider };
}

// Same "! N open issues" warning the printed report's Blocked By column
// shows inline (see PointsReport.tsx's openIssueCount() usage) -- a rich-
// text run instead of a separate column so Blocked By still reads as one
// field, just like on screen.
function blockedByCellSpec(openCount: number, blockedBy: string, divider = false): CellSpec {
  const richText: { text: string; bold?: boolean; color?: string }[] = [];
  if (openCount > 0) {
    richText.push({ text: `! ${openCount} open issue${openCount === 1 ? "" : "s"}  `, bold: true, color: COLOR.blockedWarnText });
  }
  richText.push({ text: blockedBy || "—" });
  return { text: "", richText, divider };
}

async function downloadWorkbook(workbook: Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function groupHeaderText(eq: Equipment | undefined, equipmentId: string, count: number, pct: number): string {
  const name = eq?.tag ?? equipmentId;
  const location = eq?.location ? ` — ${eq.location}` : "";
  return `${name}${location}   ${count} point${count === 1 ? "" : "s"}   ${pct}% complete`;
}

// --- Commissioning ---------------------------------------------------------

export async function exportCommissioningXlsx(params: {
  project: Project;
  groups: { equipmentId: string; items: Point[] }[];
  equipmentById: Record<string, Equipment>;
  progressByEquipment: Map<string, number>;
  attrs: PointAttribute[];
  attrValueMap: Map<string, Map<string, string>>;
  issuesByPointId: Map<string, Issue[]>;
  hideDateCommissioned: boolean;
  generatedLabel: string;
  pointsShownLabel: string;
  commissionedBy: string;
}): Promise<void> {
  const { project, groups, equipmentById, progressByEquipment, attrs, attrValueMap, issuesByPointId, hideDateCommissioned, generatedLabel, pointsShownLabel, commissionedBy } = params;

  const headers: { text: string; divider?: boolean }[] = [
    { text: "Panel" },
    { text: "Point #" },
    { text: "Descriptor" },
    ...CHECK_FIELDS.map((f) => ({ text: CHECK_FIELD_LABELS[f] })),
    ...attrs.map((a) => ({ text: a.short_text || a.name })),
    { text: "Status", divider: true },
    ...(hideDateCommissioned ? [] : [{ text: "Date Comm.", divider: true }]),
    { text: "Notes", divider: true },
    { text: "Blocked By" },
  ];

  const workbook = new Workbook();
  const ws = workbook.addWorksheet("Commissioning");
  ws.columns = [
    { width: 12 },
    { width: 10 },
    { width: 26 },
    ...CHECK_FIELDS.map(() => ({ width: 11 })),
    ...attrs.map((a) => ({ width: a.attr_type === "boolean" ? 11 : 18 })),
    { width: 14 },
    ...(hideDateCommissioned ? [] : [{ width: 13 }]),
    { width: 26 },
    { width: 22 },
  ];

  const logoBase64 = await fetchLogoBase64();
  let row = addReportHeader(ws, headers.length, project.project_number ? `${project.project_number} — ${project.name}` : project.name, `${generatedLabel}    ${pointsShownLabel}    Commissioned By: ${commissionedBy || "—"}`, logoBase64);
  addTableHeaderRow(ws, row, headers);
  row += 1;

  for (const g of groups) {
    const eq = equipmentById[g.equipmentId];
    const pct = progressByEquipment.get(g.equipmentId) ?? 0;
    addGroupHeaderRow(ws, row, headers.length, groupHeaderText(eq, g.equipmentId, g.items.length, pct));
    row += 1;
    for (const point of g.items) {
      const openCount = openIssueCount(issuesByPointId.get(point.id));
      const cells: CellSpec[] = [
        { text: displayPanel(point.panel) },
        { text: resolvedPointNumber(point) },
        { text: point.descriptor },
        ...CHECK_FIELDS.map((field) => checkCellSpec(point[field])),
        ...attrs.map((a): CellSpec => {
          const value = getAttributeValue(attrValueMap, point.id, a.id);
          return a.attr_type === "boolean"
            ? checkCellSpec(value as CheckState)
            : { text: isAttrValueNA(value) ? ATTR_NA_DISPLAY : value, color: isAttrValueNA(value) ? COLOR.na : COLOR.text };
        }),
        statusCellSpec(POINT_STATUS_LABELS[point.status], point.status, true),
        ...(hideDateCommissioned ? [] : [{ text: formatDateCommissioned(point.date_commissioned) || "—", align: "center" as const, divider: true }]),
        { text: point.notes || "—", divider: true },
        blockedByCellSpec(openCount, point.blocked_by),
      ];
      writeDataRow(ws, row, cells);
      row += 1;
    }
  }

  const filenameBase = sanitizeFilenamePart(project.project_number ? `${project.project_number} - ${project.name}` : project.name);
  await downloadWorkbook(workbook, `${filenameBase} - Commissioning Report.xlsx`);
}

// --- Install ---------------------------------------------------------------

export async function exportInstallXlsx(params: {
  project: Project;
  groups: { equipmentId: string; items: Point[] }[];
  equipmentById: Record<string, Equipment>;
  installProgressByEquipment: Map<string, number>;
  installChecksByPointId: Map<string, InstallCheck>;
  issuesByPointId: Map<string, Issue[]>;
  generatedLabel: string;
  pointsShownLabel: string;
}): Promise<void> {
  const { project, groups, equipmentById, installProgressByEquipment, installChecksByPointId, issuesByPointId, generatedLabel, pointsShownLabel } = params;

  const headers: { text: string; divider?: boolean }[] = [
    { text: "Panel" },
    { text: "Point #" },
    { text: "Descriptor" },
    ...INSTALL_FIELDS.map((f) => ({ text: INSTALL_FIELD_LABELS[f] })),
    { text: "Status", divider: true },
    { text: "Notes", divider: true },
    { text: "Blocked By" },
  ];

  const workbook = new Workbook();
  const ws = workbook.addWorksheet("Install");
  ws.columns = [
    { width: 12 },
    { width: 10 },
    { width: 26 },
    ...INSTALL_FIELDS.map(() => ({ width: 11 })),
    { width: 14 },
    { width: 26 },
    { width: 22 },
  ];

  const logoBase64 = await fetchLogoBase64();
  let row = addReportHeader(ws, headers.length, project.project_number ? `${project.project_number} — ${project.name}` : project.name, `${generatedLabel}    ${pointsShownLabel}`, logoBase64);
  addTableHeaderRow(ws, row, headers);
  row += 1;

  for (const g of groups) {
    const eq = equipmentById[g.equipmentId];
    const pct = installProgressByEquipment.get(g.equipmentId) ?? 0;
    addGroupHeaderRow(ws, row, headers.length, groupHeaderText(eq, g.equipmentId, g.items.length, pct));
    row += 1;
    for (const point of g.items) {
      const check = installChecksByPointId.get(point.id);
      const status = installStatus(check);
      const openCount = openIssueCount(issuesByPointId.get(point.id));
      const cells: CellSpec[] = [
        { text: displayPanel(point.panel) },
        { text: resolvedPointNumber(point) },
        { text: point.descriptor },
        ...INSTALL_FIELDS.map((field) => checkCellSpec(check ? check[field] : "")),
        statusCellSpec(INSTALL_STATUS_LABELS[status], status, true),
        { text: point.notes || "—", divider: true },
        blockedByCellSpec(openCount, point.blocked_by),
      ];
      writeDataRow(ws, row, cells);
      row += 1;
    }
  }

  const filenameBase = sanitizeFilenamePart(project.project_number ? `${project.project_number} - ${project.name}` : project.name);
  await downloadWorkbook(workbook, `${filenameBase} - Install Report.xlsx`);
}

// --- Issues ------------------------------------------------------------------

export async function exportIssuesXlsx(params: {
  project: Project;
  groups: { equipmentId: string; items: { issue: Issue; point: Point }[] }[];
  equipmentById: Record<string, Equipment>;
  generatedLabel: string;
  issuesCountLabel: string;
}): Promise<void> {
  const { project, groups, equipmentById, generatedLabel, issuesCountLabel } = params;

  const headers: { text: string; divider?: boolean }[] = [
    { text: "Panel" },
    { text: "Point #" },
    { text: "Descriptor" },
    { text: "Issue", divider: true },
    { text: "Recommended Action" },
    { text: "Status", divider: true },
    { text: "Date Created", divider: true },
    { text: "Date Closed", divider: true },
    { text: "Notes", divider: true },
  ];

  const workbook = new Workbook();
  const ws = workbook.addWorksheet("Issues");
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 22 }, { width: 32 }, { width: 32 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 24 }];

  const logoBase64 = await fetchLogoBase64();
  let row = addReportHeader(ws, headers.length, project.project_number ? `${project.project_number} — ${project.name}` : project.name, `${generatedLabel}    ${issuesCountLabel}`, logoBase64);
  addTableHeaderRow(ws, row, headers);
  row += 1;

  for (const g of groups) {
    const eq = equipmentById[g.equipmentId];
    const name = eq?.tag ?? g.equipmentId;
    const location = eq?.location ? ` — ${eq.location}` : "";
    addGroupHeaderRow(ws, row, headers.length, `${name}${location}   ${g.items.length} issue${g.items.length === 1 ? "" : "s"}`);
    row += 1;
    for (const { issue, point } of g.items) {
      const cells: CellSpec[] = [
        { text: displayPanel(point.panel) },
        { text: resolvedPointNumber(point) },
        { text: point.descriptor },
        { text: issue.description, divider: true },
        { text: issue.recommended_action || "—" },
        statusCellSpec(ISSUE_STATUS_LABELS[issue.status], issue.status, true),
        { text: formatTimestamp(issue.created_at), align: "center", divider: true },
        { text: issue.closed_at ? formatTimestamp(issue.closed_at) : "—", align: "center", divider: true },
        { text: issue.notes || "—", divider: true },
      ];
      writeDataRow(ws, row, cells);
      row += 1;
    }
  }

  const filenameBase = sanitizeFilenamePart(project.project_number ? `${project.project_number} - ${project.name}` : project.name);
  await downloadWorkbook(workbook, `${filenameBase} - Issues Report.xlsx`);
}
