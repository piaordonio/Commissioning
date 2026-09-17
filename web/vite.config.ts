import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    // mdb-reader's browser build parses the Access file format using Node's
    // Buffer API directly (readUInt32LE, Buffer.concat, etc. — see its
    // README: "Works in the browser with buffer") and its dependency chain
    // also touches `process`. Vite doesn't polyfill Node globals like
    // webpack/Parcel do, so this plugin provides them.
    nodePolyfills({ include: ["buffer", "process"] }),
  ],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:4001",
    },
  },
});
