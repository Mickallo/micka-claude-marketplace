---
description: Start, stop, or check the Slack bot (Socket Mode)
disable-model-invocation: true
---

Manage the Slack bot process. The argument is the action to perform.

## Actions

Parse `$ARGUMENTS` to determine the action:
- `start` (default if no argument) — Start the bot
- `stop` — Stop the bot
- `status` — Check if the bot is running

## Start

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

## Stop

1. Find PID: `pgrep -f "slack_bot.py"`
2. If found, `kill <PID>` and confirm.
3. If not found, report the bot is not running.

## Status

1. Find PID: `pgrep -f "slack_bot.py"`
2. If found, report running with PID.
3. If not found, report stopped.
4. Show last 5 lines of log if it exists: `tail -5 "${CLAUDE_PLUGIN_DATA}/slack-bot.log"`

## Environment

Required env vars (must be set before starting):
- `SLACK_BOT_TOKEN`
- `SLACK_BOT_SOCKET_MODE_TOKEN`
