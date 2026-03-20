---
name: add-service
description: "Register a service indicator in the status bar. Usage: /statusline:add-service <name> <check>"
---

# Add Service Indicator

Register a new service to monitor in the status bar.

## Usage

```
/statusline:add-service Kanban port:5173
/statusline:add-service SlackBot pgrep:slack_bot.py
```

## Check types

| Type | Format | How it works |
|------|--------|-------------|
| `port` | `port:<number>` | Checks if a process is listening on that TCP port |
| `pgrep` | `pgrep:<pattern>` | Checks if a process matching the pattern is running |

## Procedure

1. Parse arguments: first arg is the service name, second is the check string
2. Read `~/.claude/statusline-services.json` (create with `[]` if missing)
3. Check if a service with the same name already exists — if so, update its check
4. Otherwise append `{"name": "<NAME>", "check": "<CHECK>"}`
5. Write back the JSON file
6. Report confirmation
