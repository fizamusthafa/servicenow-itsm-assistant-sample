---
name: servicenow-changes
description: >-
  Create, look up, update, schedule, and close ServiceNow change requests (normal, standard,
  emergency). Use when the user says "raise a change", "submit a change request", "schedule a
  maintenance window", "check CHG…", "list pending changes", "move my change to Implement", or
  "close my change". For a risk / CAB review of a change, use change-risk-review.
---

# ServiceNow changes

Raise and progress change requests through their lifecycle.

## When to invoke

- Creating a change request
- Looking up or listing changes
- Moving a change between states, rescheduling it, or closing it
- **Not** for risk assessment or CAB preparation. Use change-risk-review.
- **Not** for approving or rejecting. Use `list_my_approvals` / `respond_to_approval` (see the Approvals section below).

## Inputs (create)

| Field | Required | Notes |
|---|---|---|
| `short_description` | yes | What is changing, where |
| `type` | yes | `standard` (pre-approved, low risk, repeatable), `normal` (needs assessment and CAB), `emergency` (fixes an active P1/P2 outage now) |
| `description` / `justification` | yes for normal/emergency | Why, and the business benefit |
| `cmdb_ci` | strongly recommended | Affected CI. Confirm it with `search_configuration_items` |
| `start_date`, `end_date` | yes for normal | Planned window. Convert to ISO 8601 UTC |
| `implementation_plan`, `backout_plan`, `test_plan` | yes for normal/emergency | Ask for them. Don't invent technical steps |
| `risk`, `impact`, `assignment_group` | no | |

## Steps

### Create
1. Work out the type from context. If the user mentions an ongoing outage, it's **emergency**. If it's a routine catalogued task, it's **standard**. Otherwise it's **normal**.
2. Collect the missing required inputs. Ask for all of them in a single message.
3. Run a quick conflict check: `search_changes` with `window_start` / `window_end` = the planned window and `cmdb_ci`. Mention any overlapping changes.
4. Show the preview:
   - **New change: ready to create**
   - Type, short description, CI, window
   - Risk / impact
   - Plans: implementation, backout, test (shortened)
   - Conflicts found
   - *Nothing has been submitted yet. Create it?*
5. On "yes", call `create_change`. Reply with the linked number, and say that a normal change goes to Assess / CAB next.

### Look up / list
- One change: `get_change`. Show number, type, state, risk, window, CI, assignment, approval, and the plans if asked.
- Many: `search_changes` (state, type, assignment_group, cmdb_ci, query, window). Show a table: Number | Type | State | Risk | Planned start | Short description.

### Update / progress / close
1. Call `get_change` for the current values.
2. Preview before → after (state, dates, plans, assignment).
3. On "yes", call `update_change`. To close, include `close_code` (successful / successful_issues / unsuccessful) and `close_notes`.

### Approvals
- "What needs my approval?" → `list_my_approvals`.
- To approve or reject: show the change summary (`get_change`) and ask for an explicit decision. A rejection needs a reason. Then call `respond_to_approval`.

## Confirmation rules

Create, update, close, and approval decisions all need a preview and a clear "yes".

## When it fails

- If the planned window is in the past or the end is before the start, point it out and ask again.
- If a state transition is rejected by ServiceNow (business rule), show the message and the state the change is in now.
