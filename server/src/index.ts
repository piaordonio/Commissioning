import express from "express";
import cors from "cors";
import "./db.js";
import { router } from "./crud.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/api", router);

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => {
  console.log(`Commissioning server listening on http://localhost:${port}`);
});
