---
name: pr-review
description: >
  Review a PR via Subagent-CodeReview and optionally post the result as inline comments.
  Triggered manually (e.g., "/pr-review #42" or "/pr-review").
---

# PR Review

## Agents (exact subagent_type)

- Git: `multi-agents:Git`
- Linear: `multi-agents:Linear`
- Code Review: `multi-agents:CodeReview`

## Flow

All context is written to `/tmp/pr-review-context.md` to keep the main context clean.

1. **Agent** `multi-agents:Git` — fetch PR metadata (title, body, branch, URLs). **Write to `/tmp/pr-review-context.md`**
2. **Agent** `multi-agents:Linear` — if Linear URL in the file, fetch issue (title, description, relations, linked PRs). **Append to `/tmp/pr-review-context.md`**. Skip otherwise
3. **Agent** `multi-agents:Git` — if linked PRs found in the file, fetch their title + state + summary. **Append to `/tmp/pr-review-context.md`**. Skip otherwise
4. **Agent** `multi-agents:CodeReview` — pass PR number, instruct to **read `/tmp/pr-review-context.md`** for full context
5. Display the report to the user
6. **Ask the user** if they want to post the review as inline comments on the PR
7. If yes → **Agent** `multi-agents:Git` — post the report as inline comments on the PR
