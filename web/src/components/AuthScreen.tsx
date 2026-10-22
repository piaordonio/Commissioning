import { useState } from "react";
import { supabase } from "../supabaseClient";

// The one login screen every account type lands on -- a tech/designer and a
// field installer sign in through the exact same form; which project(s) and
// which columns they see afterward comes entirely from RLS (see
// supabase/schema.sql's owner_id/project_installers policies), not a
// different UI here. Email+password rather than an OAuth provider: installers
// are often subcontractor crews with no account in your company's identity
// system, so this is the one option guaranteed to work for everyone, and it
// needs no external app registration to turn on.
export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Supabase's default project setting requires confirming a new address by
  // email before it returns a session -- shown instead of silently doing
  // nothing when that's the case, since there's no account-level control
  // here over whether that confirmation step is on.
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setCheckEmail(false);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setCheckEmail(true);
      }
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="form auth-form" onSubmit={handleSubmit}>
        <div className="app-title auth-title">
          <span className="app-logo">◎</span> Commissioning Points
        </div>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        {checkEmail && (
          <div className="muted-text">Check your email to confirm your account, then sign in.</div>
        )}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
            setCheckEmail(false);
          }}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
