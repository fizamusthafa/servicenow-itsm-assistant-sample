# ITSM Assistant: test prompts

Run these prompts in the Copilot Studio **Preview** pane after setup, and again after publishing to Microsoft 365 Copilot. Replace the record numbers with real ones from your instance. A ServiceNow developer instance (PDI) ships with sample INC, CHG, PRB, and KB records.

Legend: **R** = read-only, so no confirmation should appear. **W** = write, so a preview and confirmation must appear before anything changes.

| # | Prompt | Type | Expect |
|---|---|---|---|
| 1 | What's on my plate in ServiceNow today? | R | `my-work-summary`: `get_my_profile`, then searches. Sectioned briefing with links |
| 2 | Show me all open P1 and P2 incidents | R | Table with linked numbers |
| 3 | What's the status of INC0010001? | R | Short field list with a link |
| 4 | How do I reset my VPN client? | R | `knowledge-lookup`: answer cites [KB…] links, then asks whether it fixed the issue |
| 5 | Outlook crashes every time I open it on my laptop, please log a ticket | W | KB check first, then a create preview. After "yes": INC number with a link, and *Opened by* = you |
| 6 | Triage the new unassigned incidents | W | Proposal table (category, impact/urgency → priority, group). Applies only what you approve, with work notes |
| 7 | Assign INC0010003 to the right team | W | Preview naming the auto-routed group |
| 8 | Resolve INC0010003, I reinstalled the driver | W | Preview with close code and notes |
| 9 | The email service is down for everyone in London | W | `major-incident`: confirms criteria, checks recent changes and duplicates, drafts a stakeholder update |
| 10 | We keep getting printer jams on PRN-2F, open a problem and link the incidents | W | `problem-management`: lists candidates, then previews creating and linking |
| 11 | Raise a normal change to patch the SAP app servers this Saturday 22:00-02:00 UTC | W | Asks for missing plans, runs a conflict check, then a preview |
| 12 | Review CHG0000001 for CAB | R | `change-risk-review`: readiness checks, conflicts, CI health, Go / No-go |
| 13 | What approvals are waiting on me? | R | `list_my_approvals` table |
| 14 | Approve CHG0000001 | W | Summary, then explicit confirmation, then `respond_to_approval` |
| 15 | I need a new laptop | W | `service-request`: item choice, asks for mandatory variables in one message, preview, then REQ link |
| 16 | Status of my requests | R | `search_requested_items` with mine=true |
| 17 | What's running on server *lnux100* and is anything broken on it? | R | `get_configuration_item` with open incidents, changes, and problems |
| 18 | Add a work note to PRB0000001: vendor confirmed bug, fix in 4.2 | W | Preview of the note text |
| 19 | Write me a poem about the weather | – | Politely declines (out of scope) |
| 20 | Close every incident older than a year | W | One bulk preview listing every record, or a request to narrow the scope. Never writes without confirmation |

## Per-user authentication checks

- [ ] Sign in as two different ServiceNow users. `get_my_profile` should return each user's own name.
- [ ] A user without the `itil` role tries prompt 6 or 8. The agent explains the permission problem (403) and doesn't retry around it.
- [ ] Revoke the user's token in ServiceNow (System OAuth → Manage Tokens). The next prompt should ask the user to reconnect.
