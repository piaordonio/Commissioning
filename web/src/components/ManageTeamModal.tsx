import { useState } from "react";
import { InviteResult, PendingAdmin, PendingTeammate } from "../types";
import { fromLoginEmail } from "../username";

type Role = "admin" | "teammate";

// Account creation is invite-only (see reject_uninvited_signup() in
// supabase/schema.sql) -- every account from here on, installers aside
// (those are invited per-project from the Dashboard instead), is granted
// here by picking a role up front. "Admin" lands in pending_admins (full
// access to every project, same as your own account); "Teammate" lands in
// pending_teammates (no special role at all -- just lets the username past
// the signup gate, same as any ordinary account that owns what it creates).
// Deliberately simpler than ProjectDashboard's installer panel: every row
// here IS pending by definition (the backing row is deleted the moment
// that username signs up), so there's no Active/Pending distinction to
// show.
export function ManageTeamModal({
  pendingAdmins,
  pendingTeammates,
  onInviteAdmin,
  onInviteTeammate,
  onRevokeAdmin,
  onRevokeTeammate,
}: {
  pendingAdmins: PendingAdmin[];
  pendingTeammates: PendingTeammate[];
  onInviteAdmin: (username: string) => Promise<InviteResult>;
  onInviteTeammate: (username: string) => Promise<InviteResult>;
  onRevokeAdmin: (email: string) => void;
  onRevokeTeammate: (email: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("teammate");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      const typedUsername = username.trim();
      const result = await (role === "admin" ? onInviteAdmin(typedUsername) : onInviteTeammate(typedUsername));
      if (result.activated) {
        setNotice(
          role === "admin"
            ? `${typedUsername} already had an account — granted admin access immediately.`
            : `${typedUsername} already had an account — nothing further to do, they can already sign in.`
        );
      }
      setUsername("");
    } catch (err: any) {
      setError(err.message ?? "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const rows = [
    ...pendingAdmins.map((pa) => ({ email: pa.email, role: "admin" as Role })),
    ...pendingTeammates.map((pt) => ({ email: pt.email, role: "teammate" as Role })),
  ].sort((a, b) => fromLoginEmail(a.email).localeCompare(fromLoginEmail(b.email)));

  return (
    <div className="form">
      <p className="muted-text">
        Signing up is invite-only — a username must be invited here (or, for a field installer, from a project's
        Dashboard) before it can create an account at all. "Admin" gets full access to every project, the same as
        your own account. "Teammate" gets an ordinary account with no special role — it owns whatever projects it
        creates, same as any tech/designer. Either way, the invite activates automatically the moment that username
        signs up.
      </p>
      <form style={{ display: "flex", gap: 8 }} onSubmit={handleInvite}>
        <input
          type="text"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="teammate">Teammate</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="btn-primary" disabled={inviting}>
          {inviting ? "Inviting…" : "Invite"}
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="muted-text">{notice}</div>}
      {rows.length === 0 ? (
        <div className="muted-text">No pending invites.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              {rows.map((row) => (
                <tr key={row.email}>
                  <td>{fromLoginEmail(row.email)}</td>
                  <td>
                    <span className="status-pill status-not_started">{row.role === "admin" ? "Admin" : "Teammate"}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Cancel invite"
                      aria-label="Cancel invite"
                      onClick={() => {
                        if (!window.confirm(`Cancel the pending invite for ${fromLoginEmail(row.email)}?`)) return;
                        if (row.role === "admin") onRevokeAdmin(row.email);
                        else onRevokeTeammate(row.email);
                      }}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
