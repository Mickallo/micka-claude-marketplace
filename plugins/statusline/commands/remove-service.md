---
name: remove-service
description: "Remove a service indicator from the status bar. Usage: /statusline:remove-service <name>"
---

# Remove Service Indicator

Remove a service from the status bar.

## Usage

```
/statusline:remove-service Kanban
```

## Procedure

1. Parse argument: service name
2. Read `~/.claude/statusline-services.json`
3. Remove the entry matching the name
4. Write back the JSON file
5. Report confirmation
