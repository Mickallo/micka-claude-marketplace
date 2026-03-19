---
description: Check if the Slack bot is running
---

1. Find PID: `pgrep -f "slack_bot.py"`
2. If found, report running with PID.
3. If not found, report stopped.
4. Show last 5 lines of log if it exists: `tail -5 "${CLAUDE_PLUGIN_DATA}/slack-bot.log"`
