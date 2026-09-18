import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "./db.js";
import { router } from "./crud.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/api", router);

// WEB_DIST_DIR lets the Electron desktop wrapper (and `npm start` in
// general) serve the built web app from this same process/port instead of
// running a separate Vite dev server — there's no browser tab to proxy from
// once this isn't `npm run dev` anymore.
const webDistDir = process.env.WEB_DIST_DIR || path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(path.join(webDistDir, "index.html"))) {
  app.use(express.static(webDistDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => {
  console.log(`Commissioning server listening on http://localhost:${port}`);
});
