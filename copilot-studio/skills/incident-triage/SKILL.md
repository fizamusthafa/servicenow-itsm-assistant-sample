---
name: incident-triage
description: >-
  Triage a new or unassigned ServiceNow incident. Classify the category, set impact and urgency
  (and so priority), check for duplicates and related outages, find a knowledge fix, and route it to
  the right assignment group. Use when the user says "triage", "what priority should this be",
  "who should handle INC…", "work the unassigned queue", or "sort out these new tickets".
---

# Incident triage

Turn a raw incident (or a queue of them) into correctly classified, prioritised, routed tickets.

## When to invoke

- A single incident needs classifying, prioritising, or routing
- The user wants to work the new or unassigned queue
- **Not** for confirmed major outages. Use major-incident.

## Steps

### Step 1: Gather
- Single incident: call `get_incident`.
- Queue: call `search_incidents` with `state: "1"` (New). Results with an empty `assignment_group` are unassigned. Work through at most 10 at a time.

### Step 2: Classify
Pick the category and subcategory from `references/servicenow-categories.md`, based on the short description and description. If two categories fit equally well, say so and pick the one that matches the affected CI.

### Step 3: Impact × urgency
Use `references/servicenow-priorities.md`:
- **Impact** is how many people are affected: 1 enterprise / critical function, 2 department, 3 individual.
- **Urgency** is how bad it is: 1 down with no workaround, 2 degraded with a workaround, 3 minimal.
- Priority follows from the matrix. Explain it in one line, e.g. "Impact 2 × Urgency 1 → P2 High".
- If the result is P1, stop and hand over to major-incident.

### Step 4: Context checks (read-only)
- `search_incidents` with `active_only: true` and the key terms, or the same `cmdb_ci`. Three or more similar incidents suggest a wider outage or a duplicate.
- If a CI is known, `get_configuration_item` shows open incidents, active changes, and open problems on it. An active change on the CI is a likely cause; say so.
- `search_problems` with `known_error: true` and the key terms. If one matches, offer to link the incident to it and point to the workaround.
- `search_knowledge` for a fix to suggest to the caller.

### Step 5: Route
- Use the CI's `support_group` if there is one. Otherwise use the category's group (`assign_incident` auto-routing).
- Check unfamiliar group names with `search_groups`.

### Step 6: Recommend, confirm, apply
Present one triage card per incident:

| Field | Current | Proposed |
|---|---|---|
| Category | … | … |
| Impact / Urgency | … | … |
| Priority (derived) | … | … |
| Assignment group | … | … |
| Related | duplicates / known error / change | |

Ask "Apply?" On "yes":
1. `update_incident` with category, subcategory, impact, urgency, and a work note summarising the triage rationale.
2. `assign_incident` with the group.
3. `link_incident_to_problem` if a known error matched and the user agreed.

For a queue, show all proposals in one table and ask once. Apply only the ones the user approves.

## Confirmation rules

Nothing is written until the user approves the triage card. The rationale always goes into a work note so the next engineer can see why.

## When it fails

- If the description is too vague to classify, ask the caller one question, or suggest adding a comment that asks them.
- If routing is unclear, leave the group unset and say who should decide (the service desk).
