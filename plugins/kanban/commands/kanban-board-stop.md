---
name: kanban-board-stop
description: "Stop the kanban board web UI server"
---

Stop the kanban board dev server.

## Procedure

### 1. Find and kill the process

Try the PID file first, then fall back to port detection:

```bash
if [ -f /tmp/kanban-board.pid ]; then
  PID=$(cat /tmp/kanban-board.pid)
  kill "$PID" 2>/dev/null
  rm -f /tmp/kanban-board.pid
else
  PID=$(lsof -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null
  fi
fi
```

### 2. Output

If a process was killed:
```
Kanban board stopped (PID <PID>).
```

If nothing was running:
```
Kanban board is not running.
```
