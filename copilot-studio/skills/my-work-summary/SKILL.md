---
name: my-work-summary
description: >-
  Give the signed-in user a prioritised overview of their ServiceNow work: incidents assigned to them
  or their groups, changes they are implementing, problems they own, open requests, and approvals
  waiting on them. Use when the user says "what's on my plate", "my tickets", "my queue", "what do I
  need to do today", "my team's open work", or "start of day summary".
---

# My work summary

One read-only briefing of everything waiting on the user, most urgent first.

## When to invoke

- Start-of-day or hand-over briefings
- "My tickets", "my queue", "my team's work"
- **Not** for acting on a specific record. Hand over to the relevant skill.

## Steps

### Step 1: Who am I
`get_my_profile`. Note the `name` and `groups`.

### Step 2: Collect (read-only, in parallel where possible)
- `search_incidents` with `assigned_to` = the user's name and `active_only: true`
- For team scope, or if the user asks: `search_incidents` with `assignment_group` = each group (up to 3 groups) and `active_only: true`. Highlight the unassigned ones.
- `search_changes` with `assignment_group` = the user's main group and `active_only: true`. Highlight changes with a planned start in the next 7 days.
- `search_problems` with `assignment_group` = the user's main group and `active_only: true`
- `list_my_approvals`
- `search_requested_items` with `mine: true` and `active_only: true`

### Step 3: Prioritise
Order:
1. P1 and P2 incidents
2. Approvals waiting on the user
3. Changes starting within 48 hours
4. Other incidents, oldest first
5. Problems
6. The user's own requests

### Step 4: Present
> **Good {morning}, {first name}. Here's your ServiceNow summary**
> **Needs attention now:** up to 5 bullets with linked numbers
> **Incidents ({n})** table: Number | P | State | Short description | Age
> **Approvals ({n})**: Number | What | Requested
> **Upcoming changes ({n})**: Number | Window | Short description
> **Problems ({n})** and **My requests ({n})**: counts with links, expanded if asked

Leave out empty sections. End with 2-3 suggested next actions, for example "Triage the 4 unassigned incidents?" or "Review CHG… for CAB?"

## Confirmation rules

This skill is read-only. Any follow-up action goes through its own skill's confirmation.

## When it fails

- If the user isn't in any group, show the personal sections only and say so.
- If one search fails, show the rest and say which section is missing.
