---
name: change-risk-review
description: >-
  Review a ServiceNow change request for risk and readiness before CAB or implementation. Checks the
  completeness of the implementation, backout and test plans, schedule conflicts on the same CI,
  open incidents and problems on the CI, and recent failed changes, then gives a go / no-go
  recommendation with reasons. Use when the user says "review CHG…", "is this change risky",
  "prepare for CAB", "check for conflicts", or "CAB summary".
---

# Change risk review

Give a reviewer an evidence-based risk picture of one or more changes, in one screen.

## When to invoke

- Before CAB, or before approving a change
- When someone asks "is this change safe / ready?"
- For a CAB agenda across several upcoming changes
- **Not** for creating or editing changes. Use servicenow-changes.

## Steps

### Step 1: Load the change
`get_change`. Note the type, window, CI, risk, assignment group, and the three plans.

### Step 2: Readiness checks
Each check is ✅ / ⚠️ / ❌:

| Check | Pass criterion |
|---|---|
| Implementation plan | Present, with concrete ordered steps |
| Backout plan | Present, and says how to return to the previous state |
| Test plan | Present, and says how success will be verified |
| Window | Has a start and end, the end is after the start, and it's in the future |
| CI | Present |
| Assignment | Has a group or an assignee |

### Step 3: Environment checks (read-only)
- **Conflicts:** `search_changes` with `window_start` / `window_end` = this change's window and `cmdb_ci` = its CI, plus a second search without `cmdb_ci` for overlapping changes owned by the same group. Leave out the change itself.
- **CI health:** `get_configuration_item` → open incidents (P1/P2 are a red flag), active changes, open problems or known errors.
- **History:** `search_changes` with `cmdb_ci` and state 3 (Closed). Look for recent `close_code` = unsuccessful.

### Step 4: Score
- Start from the change's own `risk` field.
- Raise it one level for each of: a ❌ readiness check, an overlapping change on the same CI, an open P1/P2 on the CI, or a recent unsuccessful change on the CI.
- Lower it one level only for a standard change with all checks ✅.

### Step 5: Recommend
Reply with:

> **[CHG…](url): {short description}**
> **Recommendation:** Go / Go with conditions / No-go
> **Risk:** stated {x} → assessed {y}
> | Check | Result | Note |
> **Conditions / actions before approval:** bullets

For a CAB agenda (several changes), show one row per change: Number | Window | CI | Assessed risk | Recommendation | Key concern.

### Step 6: Optional write-back
Offer to:
- Add the review as a work note: preview the text → confirm → `add_work_note`.
- Update `risk` to the assessed value: preview → confirm → `update_change`.
- Approve or reject, if the user is an approver: confirm → `respond_to_approval`.

## Confirmation rules

The review is read-only. Every write-back is previewed and confirmed.

## When it fails

- If there's no CI on the change, mark the CI checks as "not assessable" and lower confidence. Don't guess the CI.
- If you can't read history because of permissions, say which checks you skipped.
