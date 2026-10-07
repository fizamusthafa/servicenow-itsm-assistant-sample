---
name: problem-management
description: >-
  Run ServiceNow problem management. Spot recurring incidents, open problem records, link
  incidents, capture root cause and workaround, mark known errors, and drive the problem to
  resolution. Use when the user says "this keeps happening", "open a problem", "link these incidents",
  "root cause", "known error", "workaround", "PRB…", or "recurring incidents on X".
---

# Problem management

Move from repeated symptoms to a recorded root cause and a permanent fix.

## When to invoke

- The same issue is recurring across incidents
- The user wants to create, update, or review a problem
- After a major incident, for root-cause follow-up

## Steps

### Step 1: Detect or load
- Existing problem: `get_problem`. This includes the linked incidents.
- Candidate problem: `search_incidents` with the key terms and/or `cmdb_ci`, without `active_only`, to see history too. Three or more incidents with the same symptom or CI in recent weeks is a candidate.
- Check for an existing record first: `search_problems` with the same terms or CI and `active_only: true`. If one exists, link to it instead of creating a duplicate.

### Step 2: Create (confirm first)
Preview:
- **New problem: ready to create**
- Short description (the underlying fault, not one user's symptom)
- Description: pattern summary, the list of incident numbers, first and last occurrence
- CI, impact / urgency, assignment group

On "yes", call `create_problem`, then preview linking the incidents and call `link_incident_to_problem` for each one the user approves.

### Step 3: Investigate and record
As facts become known, preview and apply `update_problem`:
- `state` 102 Assess → 103 Root Cause Analysis → 104 Fix in Progress
- `workaround`: as soon as one exists. Offer to set `known_error: true` so the service desk can find it.
- `cause_notes`: the root cause, stated factually, with evidence
- `work_notes`: investigation progress

Suggest checking `search_knowledge` for an existing article. If the workaround is new, suggest that the user publishes one.

### Step 4: Fix and close
- If the fix needs a change, hand over to servicenow-changes to raise it. Reference the PRB in the justification.
- After the fix is verified, preview `update_problem` with `fix_notes` and `state` 106 Resolved.

## Output

For a problem summary:

| Field | Value |
|---|---|
| Problem | [PRB…](url) |
| State | … |
| Known error | yes/no |
| Root cause | … |
| Workaround | … |
| Linked incidents | n (list the open ones) |

## Confirmation rules

Creating, linking, and every update need a preview and a "yes". Never record a root cause the user hasn't stated or confirmed.

## When it fails

- `cause_notes` / `workaround` field errors usually mean an older ServiceNow release. Put the text in `work_notes` instead and say so.
