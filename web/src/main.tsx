import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Checked here, before anything imports supabaseClient.ts, so a missing
// config shows a page instead of a blank screen — a module-level throw
// inside an imported module happens before React ever gets to render
// anything, including an error boundary.
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.render(
    <div style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 640 }}>
      <h2>Missing Supabase configuration</h2>
      <p>
        This app needs <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to run. Copy{" "}
        <code>web/.env.example</code> to <code>web/.env.local</code> and fill in the values from your Supabase
        project's Settings → API page (or set them under Vercel's Project Settings → Environment Variables if
        you're seeing this on a deployed build).
      </p>
    </div>
  );
} else {
  import("./App").then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
