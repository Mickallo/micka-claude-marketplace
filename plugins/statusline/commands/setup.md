---
name: setup
description: Install the custom status bar into Claude Code settings
---

# Statusline Setup

Install the custom status bar script and configure Claude Code to use it.

## Steps

1. **Copy the script** to `~/.claude/statusline-command.sh`:
   ```bash
   cp "${CLAUDE_PLUGIN_ROOT}/src/statusline.sh" ~/.claude/statusline-command.sh
   chmod +x ~/.claude/statusline-command.sh
   ```

2. **Configure Claude Code** — read `~/.claude/settings.json`, set the `statusLine` field:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash ~/.claude/statusline-command.sh",
       "padding": 0
     }
   }
   ```
   Merge this into the existing settings (do not overwrite other fields).

3. **Initialize services file** — if `~/.claude/statusline-services.json` does not exist, create it with an empty array:
   ```json
   []
   ```

4. **Report** — confirm installation and tell the user to register services with `/statusline:add-service`.
