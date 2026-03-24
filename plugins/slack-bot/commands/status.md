---
description: Check if the Slack bot is running
---

1. Check container status: `docker ps -a --filter name=evaneos-slack-bot --format '{{.Status}}'`
2. If running, show last 10 lines of logs: `docker logs evaneos-slack-bot 2>&1 | tail -10`
3. If not running, report stopped.
