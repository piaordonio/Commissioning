import { useState } from "react";
import { ISSUE_STATUS_LABELS, Issue, IssueStatus, Point } from "../types";
import { formatTimestamp } from "../formatDate";

// Wrapped by the generic <Modal> from App.tsx, same pattern as
// VerifyControllerModal/ImportMdbModal -- this component owns the form and
// list, not the overlay/close button. No inline editing of an existing
// issue's text here: not asked for, and trivially added later the same way
// onSetStatus was.
export function IssuesModal({
  point,
  equipmentTag,
  issues,
  onAdd,
  onSetStatus,
}: {
  point: Point;
  equipmentTag: string;
  issues: Issue[];
  onAdd: (pointId: string, description: string, recommendedAction: string) => void;
  onSetStatus: (issueId: string, status: IssueStatus) => void;
}) {
  const [description, setDescription] = useState("");
  const [recommendedAction, setRecommendedAction] = useState("");

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
          {sorted.map((issue) => (
            <div key={issue.id} className="issue-row">
              <div className="issue-row-header">
                <span className={`status-pill status-${issue.status}`}>{ISSUE_STATUS_LABELS[issue.status]}</span>
                <span className="muted-text">{formatTimestamp(issue.created_at)}</span>
                <div className="spacer" />
                <button
                  type="button"
                  className="btn-secondary issue-toggle-btn"
                  onClick={() => onSetStatus(issue.id, issue.status === "open" ? "closed" : "open")}
                >
                  {issue.status === "open" ? "Close" : "Reopen"}
                </button>
              </div>
              <div className="issue-description">{issue.description}</div>
              {issue.recommended_action && (
                <div className="issue-recommended-action">
                  <span className="muted-text">Recommended: </span>
                  {issue.recommended_action}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
