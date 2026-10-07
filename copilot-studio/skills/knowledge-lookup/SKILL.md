---
name: knowledge-lookup
description: >-
  Find and summarise ServiceNow knowledge base articles to answer how-to and troubleshooting
  questions. Use when the user asks "how do I…", "is there a KB for…", "how to fix…", "known fix
  for…", or quotes an error message, and before raising an incident when a self-help fix may exist.
---

# Knowledge lookup

Answer from published ServiceNow knowledge, with citations, so users can often fix things themselves.

## When to invoke

- How-to or troubleshooting questions
- An error message the user wants explained
- As a deflection step before creating an incident (servicenow-incidents calls for this)

## Steps

### Step 1: Search
`search_knowledge` with 2-5 distinctive keywords: the product name and key error words. Leave out filler words. If there are no results, retry once with broader terms (the product name only).

### Step 2: Pick and read
Pick the 1-2 most relevant results by title. Call `get_knowledge_article` on them.

### Step 3: Answer
- Give the steps or answer in your own words, short and ordered, **based only on the article text**.
- Cite each article as a link: [KB…](url).
- If the articles don't actually answer the question, say so. Don't fill gaps from general knowledge as if it came from the KB.

### Step 4: Close the loop
Ask "Did that fix it?" If not, offer to create an incident with servicenow-incidents. Include the KB numbers already tried in the description.

## Output

> **Answer:** 1-3 sentences
> **Steps:** numbered list (from the KB)
> **Source:** [KB…](url)

## When it fails

- No published article: say so, and offer to raise an incident or a request.
- The article is truncated (very long): summarise what was returned and give the link for the rest.
