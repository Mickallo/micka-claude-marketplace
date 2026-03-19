---
description: Start the Slack bot
---

1. Check if already running: `pgrep -f "slack_bot.py"`. If a PID is found, report it's already running and exit.
2. Check venv exists: `test -d "${CLAUDE_PLUGIN_DATA}/venv"`. If not, tell the user to run `/slack-bot:install` first and exit.
3. Launch in background:
   ```
   nohup "${CLAUDE_PLUGIN_DATA}/venv/bin/python" "${CLAUDE_PLUGIN_ROOT}/src/slack_bot.py" > "${CLAUDE_PLUGIN_DATA}/slack-bot.log" 2>&1 &
   ```
4. Wait 2 seconds, then verify the process started with `pgrep -f "slack_bot.py"`.
5. Report the PID and log path.

Required env vars (must be set before starting):
- `SLACK_BOT_TOKEN`
- `SLACK_BOT_SOCKET_MODE_TOKEN`
