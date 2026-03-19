---
description: Stop the Slack bot
disable-model-invocation: true
---

1. Find PID: `pgrep -f "slack_bot.py"`
2. If found, `kill <PID>` and confirm.
3. If not found, report the bot is not running.
