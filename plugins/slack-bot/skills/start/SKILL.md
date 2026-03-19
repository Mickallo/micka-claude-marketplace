---
description: Start the Slack bot
disable-model-invocation: true
---

1. Check if already running: `pgrep -f "slack_bot.py"`. If a PID is found, report it's already running and exit.
2. Install dependencies if needed:
   ```
   pip3 install -r "${CLAUDE_PLUGIN_ROOT}/src/requirements.txt" --quiet
   ```
3. Launch in background:
   ```
   nohup python3 "${CLAUDE_PLUGIN_ROOT}/src/slack_bot.py" > "${CLAUDE_PLUGIN_DATA}/slack-bot.log" 2>&1 &
   ```
4. Wait 2 seconds, then verify the process started with `pgrep -f "slack_bot.py"`.
5. Report the PID and log path.

Required env vars (must be set before starting):
- `SLACK_BOT_TOKEN`
- `SLACK_BOT_SOCKET_MODE_TOKEN`
