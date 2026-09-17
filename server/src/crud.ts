import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export const router = Router();
const now = () => new Date().toISOString();

const CHECK_FIELDS = ["wired", "tagged", "end_to_end", "calibrate", "sequence", "alarm", "graphics"] as const;

// ---- Projects ----
router.get("/projects", (_req, res) => {
  res.json(db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all());
});

router.post("/projects", (req, res) => {
  const { name, project_number = "" } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO projects (id, project_number, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, project_number, name, ts, ts);
  res.status(201).json(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
});

router.delete("/projects/:id", (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ---- Equipment ----
router.get("/equipment", (req, res) => {
  const { project_id } = req.query;
  if (project_id) {
    res.json(db.prepare("SELECT * FROM equipment WHERE project_id = ? ORDER BY tag").all(String(project_id)));
  } else {
    res.json(db.prepare("SELECT * FROM equipment ORDER BY tag").all());
  }
});

router.put("/equipment/:id", (req, res) => {
  const allowed = ["tag", "equipment_type", "location", "notes", "blocked_by"] as const;
  const patch = req.body ?? {};
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  for (const key of allowed) {
    if (key in patch) {
      sets.push(`${key} = ?`);
      vals.push(patch[key]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: "no valid fields" });
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(req.params.id);
  db.prepare(`UPDATE equipment SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  res.json(db.prepare("SELECT * FROM equipment WHERE id = ?").get(req.params.id));
});

// ---- Points ----
router.get("/points", (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: "project_id is required" });
  res.json(
    db
      .prepare(
        `SELECT points.* FROM points
         JOIN equipment ON equipment.id = points.equipment_id
         WHERE equipment.project_id = ?
         ORDER BY points.point_number`
      )
      .all(String(project_id))
  );
});

router.put("/points/:id", (req, res) => {
  const allowed = ["notes", "blocked_by", ...CHECK_FIELDS] as const;
  const patch = req.body ?? {};
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  for (const key of allowed) {
    if (key in patch) {
      sets.push(`${key} = ?`);
      vals.push(patch[key]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: "no valid fields" });
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(req.params.id);
  db.prepare(`UPDATE points SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  res.json(db.prepare("SELECT * FROM points WHERE id = ?").get(req.params.id));
});

// Bulk field update, used by the checklist grid's range-fill and paste.
router.post("/points/bulk", (req, res) => {
  const updates = req.body?.updates as { id: string; field: string; value: string }[] | undefined;
  if (!Array.isArray(updates)) return res.status(400).json({ error: "updates array is required" });
  const validFields = new Set([...CHECK_FIELDS, "notes", "blocked_by"]);
  const ts = now();
  db.exec("BEGIN");
  try {
    for (const u of updates) {
      if (!validFields.has(u.field)) continue;
      db.prepare(`UPDATE points SET ${u.field} = ?, updated_at = ? WHERE id = ?`).run(u.value, ts, u.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  res.status(204).end();
});

// ---- Import (from mdb-reader client-side parse) ----
// Body: { project_id, equipment: [{ tempId, tag, equipment_type, location }], points: [{ equipmentTempId, panel, ip_op, analog_digital, point_number, descriptor }] }
router.post("/import", (req, res) => {
  const { project_id, equipment, points } = req.body ?? {};
  if (!project_id || !Array.isArray(equipment) || !Array.isArray(points)) {
    return res.status(400).json({ error: "project_id, equipment[], points[] are required" });
  }

  const ts = now();
  const tempIdToRealId = new Map<string, string>();

  const insertEquipment = db.prepare(
    `INSERT INTO equipment (id, project_id, tag, equipment_type, location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPoint = db.prepare(
    `INSERT INTO points (id, equipment_id, panel, ip_op, analog_digital, point_number, descriptor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec("BEGIN");
  try {
    for (const eq of equipment) {
      const id = randomUUID();
      tempIdToRealId.set(eq.tempId, id);
      insertEquipment.run(id, project_id, eq.tag, eq.equipment_type ?? "", eq.location ?? "", ts, ts);
    }
    for (const p of points) {
      const equipmentId = tempIdToRealId.get(p.equipmentTempId);
      if (!equipmentId) continue;
      insertPoint.run(
        randomUUID(),
        equipmentId,
        p.panel ?? "",
        p.ip_op ?? "",
        p.analog_digital ?? "",
        p.point_number,
        p.descriptor ?? "",
        ts,
        ts
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json({ equipment_count: equipment.length, point_count: points.length });
});
