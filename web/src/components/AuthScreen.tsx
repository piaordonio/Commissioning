import { useState } from "react";
import { supabase } from "../supabaseClient";
import { toLoginEmail } from "../username";

// The one login screen every account type lands on -- a tech/designer and a
// field installer sign in through the exact same form; which project(s) and
// which columns they see afterward comes entirely from RLS (see
// supabase/schema.sql's owner_id/project_installers policies), not a
// different UI here. Username+password, not a real email: installers are
// often subcontractor crews with no company email to use, and nobody here
// wants to wait on a confirmation inbox. Supabase Auth is email/password
// under the hood, so the username is mapped to a synthetic, never-delivered
// address (see ../username.ts) -- which only works if this project's
// "Confirm email" setting is off, since that synthetic address can never
// receive a real confirmation link.
export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown if Supabase's "Confirm email" project setting is still on --
  // sign-up succeeds but comes back without a session, and since usernames
  // here aren't real addresses, no confirmation link can ever arrive.
  const [needsConfirmOff, setNeedsConfirmOff] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNeedsConfirmOff(false);
    try {
      const email = toLoginEmail(username);
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setNeedsConfirmOff(true);
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
          Username
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
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
        {needsConfirmOff && (
          <div className="error-banner">
            Account created, but this project still requires email confirmation -- and usernames here aren't real
            addresses, so no confirmation link can ever arrive. In the Supabase dashboard, go to Authentication →
            Providers → Email and turn off "Confirm email", then sign in again.
          </div>
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
            setNeedsConfirmOff(false);
          }}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
