const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");

// Otherwise app.getName() (and so userData's folder name) falls back to
// package.json's "name" field ("desktop"), not what the user sees installed.
app.setName("Commissioning Points");

const PORT = 4317; // fixed port, chosen to avoid clashing with the apps tracker's dev ports
const isPackaged = app.isPackaged;

// In a packaged app, Program Files isn't writable — point the SQLite file
// at Electron's per-user app-data folder instead. In dev (`npm run start`
// from this desktop workspace), keep the server's own ./data default so it
// matches the plain-web dev workflow.
const dataDir = isPackaged ? path.join(app.getPath("userData"), "data") : undefined;

// Packaged (see package.json's build.files mapping): server/dist, web/dist
// and server/package.json are copied to sit right next to main.js, so
// require/import resolution from server/dist/index.js walks up through
// this same app directory and finds node_modules/express, node_modules/cors
// (packaged automatically, since they're this workspace's own dependencies).
// In dev, they're one level up in the repo layout instead.
const resourcesDir = isPackaged ? __dirname : path.join(__dirname, "..");
const serverEntry = path.join(resourcesDir, "server", "dist", "index.js");
const webDistDir = path.join(resourcesDir, "web", "dist");

let mainWindow;

async function startServer() {
  process.env.PORT = String(PORT);
  process.env.WEB_DIST_DIR = webDistDir;
  if (dataDir) process.env.COMMISSIONING_DATA_DIR = dataDir;

  // Runs server/dist/index.js's top-level code (which calls app.listen) in
  // this same process, rather than forking a child — one module-resolution
  // context to reason about instead of two.
  await import(pathToFileURL(serverEntry).href);

  await waitUntilListening();
}

function waitUntilListening(attempt = 0) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/projects`, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", () => {
      if (attempt > 100) return reject(new Error("Server did not start in time"));
      setTimeout(() => waitUntilListening(attempt + 1).then(resolve, reject), 100);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Commissioning Points",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    console.error("Failed to start the commissioning server:", err);
    app.quit();
    return;
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
