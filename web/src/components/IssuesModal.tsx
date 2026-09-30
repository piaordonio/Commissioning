import { useState } from "react";
import { ISSUE_STATUS_LABELS, Issue, IssueStatus, Point } from "../types";
import { formatTimestamp } from "../formatDate";

// Wrapped by the generic <Modal> from App.tsx, same pattern as
// VerifyControllerModal/ImportMdbModal -- this component owns the form and
// list, not the overlay/close button. Description is fixed once an issue
// is created (not asked for): it's the identifying statement of the
// problem, set once in the add form. Recommended Action and Notes are
// both editable after creation, but only once an issue exists and its
// card is opened (see expandedIssueIds below) -- neither tends to be
// fully known while you're still describing a fresh problem, so editing
// them later rather than only at creation matches how the information
// actually arrives.
export function IssuesModal({
  point,
  equipmentTag,
  issues,
  onAdd,
  onSetStatus,
  onDelete,
  onUpdateRecommendedAction,
  onUpdateNotes,
}: {
  point: Point;
  equipmentTag: string;
  issues: Issue[];
  onAdd: (pointId: string, description: string, recommendedAction: string) => void;
  onSetStatus: (issueId: string, status: IssueStatus) => void;
  onDelete: (issue: Issue) => void;
  onUpdateRecommendedAction: (issueId: string, recommendedAction: string) => void;
  onUpdateNotes: (issueId: string, notes: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [recommendedAction, setRecommendedAction] = useState("");
  // Collapsed by default, same reasoning as the mobile point cards --
  // Notes only needs to be in view while you're actually editing it, not
  // for every issue in the list all the time. Independent per issue.
  const [expandedIssueIds, setExpandedIssueIds] = useState<Set<string>>(new Set());
  const toggleIssue = (id: string) => {
    setExpandedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sorted = [...issues].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });

  return (
    <div className="issues-modal">
      {equipmentTag && <div className="muted-text">{equipmentTag}</div>}

      <form
        className="form issue-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!description.trim()) return;
          onAdd(point.id, description.trim(), recommendedAction.trim());
          setDescription("");
          setRecommendedAction("");
        }}
      >
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's wrong with this point?"
            rows={2}
            required
          />
        </label>
        <label>
          Recommended Action
          <textarea
            value={recommendedAction}
            onChange={(e) => setRecommendedAction(e.target.value)}
            placeholder="What needs to happen to fix it?"
            rows={2}
          />
        </label>
        <div className="form-actions">
          <div className="spacer" />
          <button type="submit" className="btn-primary">
            Add Issue
          </button>
        </div>
      </form>

      {sorted.length === 0 ? (
        <div className="empty-state">No issues logged for this point.</div>
      ) : (
        <div className="issue-list">
          {sorted.map((issue) => {
            const isExpanded = expandedIssueIds.has(issue.id);
            return (
              <div key={issue.id} className="issue-row">
                <div className="issue-row-header">
                  <span className={`status-pill status-${issue.status}`}>{ISSUE_STATUS_LABELS[issue.status]}</span>
                  <span className="muted-text">Opened {formatTimestamp(issue.created_at)}</span>
                  {issue.status === "closed" && issue.closed_at && (
                    <span className="muted-text">Closed {formatTimestamp(issue.closed_at)}</span>
                  )}
                  <div className="spacer" />
                  <button
                    type="button"
                    className="btn-secondary issue-toggle-btn"
                    onClick={() => onSetStatus(issue.id, issue.status === "open" ? "closed" : "open")}
                  >
                    {issue.status === "open" ? "Close" : "Reopen"}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Delete this issue"
                    aria-label="Delete issue"
                    onClick={() => onDelete(issue)}
                  >
                    🗑
                  </button>
                </div>

                <button
                  type="button"
                  className="issue-summary"
                  aria-expanded={isExpanded}
                  onClick={() => toggleIssue(issue.id)}
                >
                  <span className="issue-description">{issue.description}</span>
                  <span className="issue-chevron" aria-hidden="true">
                    {isExpanded ? "▲" : "▾"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="issue-body">
                    <label className="issue-field">
                      Recommended Action
                      <textarea
                        key={`${issue.id}-recommended-action`}
                        defaultValue={issue.recommended_action}
                        placeholder="What needs to happen to fix it?"
                        rows={2}
                        onBlur={(e) => {
                          if (e.target.value !== issue.recommended_action)
                            onUpdateRecommendedAction(issue.id, e.target.value);
                        }}
                      />
                    </label>
                    <label className="issue-field">
                      Notes (shown on the printed Issues report only)
                      <textarea
                        key={`${issue.id}-notes`}
                        defaultValue={issue.notes}
                        placeholder="Add report context -- a vendor ticket number, a scheduled follow-up…"
                        rows={2}
                        onBlur={(e) => {
                          if (e.target.value !== issue.notes) onUpdateNotes(issue.id, e.target.value);
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
