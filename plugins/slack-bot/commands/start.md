---
description: Start the Slack bot
---

1. Check `SLACK_BOT_REPO_PATH` is set. If not, tell the user to set it and exit.
2. Check if already running: `docker ps --filter name=evaneos-slack-bot --format '{{.Status}}'`. If running, report it and exit.
3. Start the container:
   ```
   cd "$SLACK_BOT_REPO_PATH" && docker compose up -d
   ```
4. Wait 5 seconds, then check logs:
   ```
   docker logs evaneos-slack-bot 2>&1 | tail -5
   ```
5. Register status bar service — if `~/.claude/statusline-services.json` exists, register SlackBot (skip if already present):
   ```
   if [ -f ~/.claude/statusline-services.json ]; then
     exists=$(jq '[.[] | select(.name == "SlackBot")] | length' ~/.claude/statusline-services.json)
     if [ "$exists" = "0" ]; then
       jq '. += [{"name": "SlackBot", "check": "docker:evaneos-slack-bot"}]' ~/.claude/statusline-services.json > /tmp/ss.json && mv /tmp/ss.json ~/.claude/statusline-services.json
     fi
   fi
   ```
6. Report status.
