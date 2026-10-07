---
name: major-incident
description: >-
  Coordinate a major incident (P1 / widespread outage) in ServiceNow. Confirm the major-incident
  criteria, establish impact, find likely causes such as recent changes, link duplicate incidents,
  draft stakeholder updates, and drive the hand-off to problem management after resolution. Use when
  the user says "major incident", "P1", "outage", "everyone is affected", "site down", "declare a
  MI", or "send a status update".
---

# Major incident

Run the first hour of a major incident, and its close-out, consistently.

## When to invoke

- An incident is, or may become, P1, or many users or a critical service are affected
- The user wants a stakeholder or status update for an ongoing outage
- The major incident is resolved and needs a close-out

## Steps

### Step 1: Confirm it is major
It's a major incident if **any** of these apply:
- A business-critical service is down with no workaround (impact 1 × urgency 1)
- Many users or several sites are affected
- There's a security or safety risk, or regulatory exposure

If none apply, say so and use incident-triage instead.

### Step 2: Anchor the record
- If an incident already exists, `get_incident`. If not, follow the create flow (preview → confirm → `create_incident`) with impact 1 and urgency 1.
- Identify the affected service or CI with `search_configuration_items`, then `get_configuration_item`.

### Step 3: Establish impact and likely cause (read-only)
- `search_incidents` with `active_only: true` and the CI or key terms to collect duplicates.
- `get_configuration_item` → `active_changes`, plus `search_changes` with a `window_start` of 24 hours ago and a `window_end` of now. A change implemented just before the outage started is the first suspect.
- `search_problems` with `known_error: true`, for a known workaround.

### Step 4: Organise (confirm first)
Show one preview listing every write:
- The parent incident: work note with an impact summary and suspected cause
- Each duplicate incident: a work note pointing at the parent ("Tracked under INC…")
- Optionally, the assignment group for the parent

On "yes", apply them with `update_incident` / `add_work_note`.

### Step 5: Stakeholder update
Draft the update in this shape and let the user edit it. Only post it as a customer-visible `comments` entry if they ask.

> **[MAJOR INCIDENT] {service}: {status: Investigating | Identified | Monitoring | Resolved}**
> **Impact:** who and what is affected
> **Started:** time · **Next update:** time
> **Current actions:** 1-3 bullets
> **Workaround:** if any
> **Reference:** [INC…](url)

### Step 6: Close-out
When service is restored:
1. Preview `resolve_incident` on the parent, with close notes covering cause, fix, and duration.
2. Offer to resolve the duplicates with "Resolved under parent INC…".
3. **Always** offer to `create_problem` for root-cause analysis, then `link_incident_to_problem` for the parent and the duplicates.

## Confirmation rules

Each batch of writes is previewed and confirmed. Never post customer-visible comments without explicit approval of the exact text.

## When it fails

- If the cause is unclear, say so. Don't speculate beyond what the data shows.
- If the user lacks rights on other teams' incidents (403), list the numbers so a coordinator can update them.
