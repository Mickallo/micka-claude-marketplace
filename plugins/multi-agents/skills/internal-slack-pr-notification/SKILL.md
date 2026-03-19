---
name: internal-slack-pr-notification
description: >
  PR notification template and workflow for Slack. Preloaded in Subagent-Slack.
disable-model-invocation: true
user-invocable: false
---

# PR Notification

## Required data

| Key | Source |
|-----|--------|
| `pr_url` | GitHub |
| `pr_number` | GitHub |
| `pr_title` | GitHub |
| `pr_description` | GitHub |

## Template

```
:rocket: *New PR ready for review*

*<{pr_url}|#{pr_number} - {pr_title}>*
> {pr_summary}

:eyes: _Please review when possible_
```

`{pr_summary}` = `{pr_description}` summarized in 1 sentence (max 2 lines). The entire message must not exceed 3 lines.

## Workflow

1. Fill the template with the received data.
2. Show the draft to the user.
3. Ask which channel to post to.
4. Send after validation.
