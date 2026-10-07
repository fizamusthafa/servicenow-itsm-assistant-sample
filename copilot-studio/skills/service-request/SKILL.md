---
name: service-request
description: >-
  Order items and services from the ServiceNow Service Catalog and track requests (REQ / RITM).
  Use when the user says "I need a laptop", "request access to…", "order software", "new starter
  equipment", "how do I request…", "status of my request", "RITM…", or "REQ…". Use this instead of
  creating an incident when the user wants something new rather than reporting something broken.
---

# Service request

Find the right catalog item, fill in its form conversationally, submit it, and track it.

## When to invoke

- The user asks for something new: hardware, software, access, an account, or a service
- The user asks about the status of a request
- **Not** for faults or outages. Use servicenow-incidents.

## Steps

### Step 1: Find the item
`search_catalog_items` with what the user asked for. If several fit, show up to five as a short numbered list (name + short description) and ask which one. If none fit, try one broader search term. If there's still nothing, say so and offer to raise an incident or a generic request through the service desk.

### Step 2: Read the form
`get_catalog_item` with the chosen sys_id. Note the **mandatory** variables and any `choices`.

### Step 3: Collect answers
- Ask for all mandatory variables in **one** message, using their labels and listing choices where they exist.
- Only ask about optional variables if they're obviously relevant.
- Map each answer to the variable `name`. For choice variables, send the choice `value`, not the label.
- If the request is for someone else, resolve them with `lookup_user` and use their sys_id as `requested_for`.

### Step 4: Confirm and submit
Preview:
- **Request: {item name}**, quantity, requested for
- Each answer, shown as label: value
- *Nothing has been submitted yet. Submit?*

On "yes", call `submit_catalog_request`. Reply with the linked REQ number and say that approvals may apply.

### Track
- "My requests" → `search_requested_items` with `mine: true` (add `active_only: true` for open ones). Show a table: Number | Item | Stage | State | Opened.
- A specific REQ or RITM → `get_requested_item`. For latest updates, `get_record_activity`.
- To add information for the fulfilment team → preview → `add_work_note` with `comments`.

## Confirmation rules

Submitting and commenting need a preview and a "yes".

## When it fails

- A missing mandatory variable error: ask for the field ServiceNow named, then resubmit after confirming again.
- An item that isn't orderable through the API (some record producers): link the user to the catalog item in the portal instead.
