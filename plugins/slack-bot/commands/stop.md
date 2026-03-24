---
description: Stop the Slack bot
---

1. Check `SLACK_BOT_REPO_PATH` is set. If not, tell the user to set it and exit.
2. Check if running: `docker ps --filter name=evaneos-slack-bot --format '{{.Status}}'`. If not running, report it and exit.
3. Stop the container:
   ```
   cd "$SLACK_BOT_REPO_PATH" && docker compose down
   ```
4. Confirm stopped.
