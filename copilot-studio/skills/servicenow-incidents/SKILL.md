---
name: servicenow-incidents
description: >-
  Create, look up, update, assign, and resolve individual ServiceNow incidents. Use when the user
  says "create an incident", "log a ticket", "check INC…", "update my incident", "assign this to
  Network", "resolve / close INC…", "add a note to INC…", or "show open incidents". For classifying
  and prioritising a new or unassigned incident, use incident-triage. For P1 / major outages, use
  major-incident.
---

# ServiceNow incidents

Run the incident lifecycle for one incident or a short list of them.

## When to invoke

- Creating an incident from a user's description of a problem
- Looking up one incident, or listing incidents by filter
- Changing the state, assignee, group, or impact/urgency of an incident, or adding notes
- Resolving an incident
- **Not** for deciding category or priority from scratch. Use incident-triage.
- **Not** for outages affecting many users. Use major-incident.

## Inputs

| Field | Required | Notes |
|---|---|---|
| `short_description` | yes (create) | One line, specific: "Outlook crashes on launch for J. Smith", not "email broken" |
| `description` | no | Symptoms, steps tried, error text |
| `category` / `subcategory` | no | See `references/servicenow-categories.md` |
| `impact`, `urgency` | no | 1-3 each. Priority is derived. See `references/servicenow-priorities.md` |
| `cmdb_ci` | no | Affected CI name. Confirm with `search_configuration_items` when it's ambiguous |
| `number` | yes (others) | INC number. If the user gives a description instead, find it with `search_incidents` |

## Steps

### Create
1. Collect the short description. Ask at most one follow-up question for anything essential that's missing (who's affected, since when).
2. Before creating, call `search_knowledge` with the key symptoms. If a matching article exists, offer it first: "This KB may fix it: [KB…](url). Create the incident anyway?"
3. Optionally call `search_incidents` with `active_only: true` and the key terms, to spot duplicates. If one is likely, offer to add a comment to it instead.
4. Show the preview:
   - **New incident: ready to create**
   - Short description / description
   - Category, impact, urgency, and the expected priority
   - Assignment group and CI, if known
   - *Nothing has been submitted yet. Create it?*
5. On "yes", call `create_incident`. Reply with the linked number and next steps.

### Look up / list
- One record: `get_incident`. Reply with a short field/value list: number, state, priority, assignee/group, opened, short description, last update.
- Several: `search_incidents` with filters (state, priority, assigned_to, assignment_group, cmdb_ci, query, active_only). Reply with a table: Number | Priority | State | Short description | Assigned to.
- For "what changed / latest notes", call `get_record_activity`.

### Update
1. Call `get_incident` for the current values.
2. Show a preview with before → after for each field being changed.
3. On "yes", call `update_incident`. For notes only, `add_work_note` is fine.

### Assign
- If the user names a group, check it with `search_groups` when unsure, then preview and call `assign_incident` with `group`.
- If no group is given, `assign_incident` without `group` auto-routes from category. Say which group it will route to in the preview.

### Resolve
1. Ask for the close notes (what fixed it) if the user hasn't given them. Default the close code to *Solved (Permanently)*, or *Solved (Work Around)* if they describe a workaround.
2. Preview the close code and notes, then call `resolve_incident`.
3. If the same root cause has hit 3 or more incidents, suggest opening a problem (problem-management).

## Confirmation rules

Every create, update, assign, resolve, and work note needs the preview and a clear "yes" first. Reading needs no confirmation.

## When it fails

- Not found: say so and offer `search_incidents` with what the user remembers.
- 403: the user's role can't do this. Suggest contacting the service desk.
- Never invent an INC number or a link.
