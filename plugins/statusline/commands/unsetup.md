---
name: unsetup
description: Remove the custom status bar from Claude Code settings
---

# Statusline Unsetup

Remove the custom status bar and restore default behavior.

## Steps

1. **Remove the script**:
   ```bash
   rm -f ~/.claude/statusline-command.sh
   ```

2. **Remove the setting** — read `~/.claude/settings.json`, delete the `statusLine` field. Do not touch other fields.

3. **Optionally remove services file**:
   ```bash
   rm -f ~/.claude/statusline-services.json
   ```

4. **Report** — confirm removal.
