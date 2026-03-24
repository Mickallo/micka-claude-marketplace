---
description: Build the Slack bot Docker image
---

1. Check Docker is available: `docker --version`
2. Check `SLACK_BOT_REPO_PATH` is set. If not, tell the user to set it (e.g. `export SLACK_BOT_REPO_PATH=~/Projects/evaneos-slack-bot`) and exit.
3. Check the repo exists: `test -f "$SLACK_BOT_REPO_PATH/docker-compose.yml"`. If not, tell user the path is wrong or to clone the repo first.
4. Build the image:
   ```
   cd "$SLACK_BOT_REPO_PATH" && docker compose build
   ```
5. Report build status.
