import { useState } from "react";
import { PendingAdmin } from "../types";
import { fromLoginEmail } from "../username";

// "Same access as me" invites -- see pending_admins in supabase/schema.sql.
// Deliberately simpler than ProjectDashboard's installer panel: every row
// here IS pending by definition (the backing row is deleted the moment that
// email signs up -- admin_users is the lasting record from then on), so
// there's no Active/Pending distinction to show.
export function ManageAdminsModal({
  pendingAdmins,
  onInvite,
  onRevoke,
}: {
  pendingAdmins: PendingAdmin[];
  onInvite: (email: string) => Promise<void>;
  onRevoke: (email: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setInviting(true);
    setError(null);
    try {
      await onInvite(username.trim());
      setUsername("");
    } catch (err: any) {
      setError(err.message ?? "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="form">
      <p className="muted-text">
        Invited here gets full access to every project, the same as your own account — not scoped to one project the
        way a field installer invite is. Invite by username before they've signed up; it activates automatically the
        moment that username creates an account.
      </p>
      <form style={{ display: "flex", gap: 8 }} onSubmit={handleInvite}>
        <input
          type="text"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn-primary" disabled={inviting}>
          {inviting ? "Inviting…" : "Invite"}
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      {pendingAdmins.length === 0 ? (
        <div className="muted-text">No pending invites.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              {pendingAdmins.map((pa) => (
                <tr key={pa.email}>
                  <td>{fromLoginEmail(pa.email)}</td>
                  <td>
                    <span className="status-pill status-not_started">Pending</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Cancel invite"
                      aria-label="Cancel invite"
                      onClick={() => {
                        if (window.confirm(`Cancel the pending invite for ${fromLoginEmail(pa.email)}?`))
                          onRevoke(pa.email);
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
