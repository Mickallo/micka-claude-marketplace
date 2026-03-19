---
name: pr-notify
description: >
  Orchestrates PR notification on Slack. Triggers after PR creation or on demand.
---

# Notify PR

## Triggering

- **Auto**: after the `multi-agents:Git` subagent returns a PR URL, ask "Do you want to notify Slack?"
- **Manual**: user requests (e.g., "notify PR #42 of org/repo")

## Agents (exact subagent_type)

- Git: `multi-agents:Git`
- Slack: `multi-agents:Slack`

## Flow

1. **Agent** `multi-agents:Git` → retrieve only: `pr_url`, `pr_number`, `pr_title`, `pr_description`.
2. **Preview** → fill the `internal-slack-pr-notification` template with the data. Display the formatted message to the user and ask which channel to post to. Do not proceed until the user validates.
3. **Agent** `multi-agents:Slack` → send the validated message to the chosen channel. Pass the exact message text — do not add extra fields (commits, files, stats, etc.).
