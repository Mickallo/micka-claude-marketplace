---
name: kanban-board-start
description: "Start the kanban board web UI server"
---

Start the kanban board dev server on http://localhost:5173.

## Procedure

### 1. Check board is installed

```bash
if [ ! -f ~/.claude/kanban-board/package.json ]; then
  echo "Board not installed. Run /kanban-init first."
  exit 1
fi
```

### 2. Check if already running

```bash
if lsof -iTCP:5173 -sTCP:LISTEN -t > /dev/null 2>&1; then
  echo "Board already running on http://localhost:5173"
  exit 0
fi
```

### 3. Read project config

```bash
if [ -f .claude/kanban.json ]; then
  PROJECT=$(cat .claude/kanban.json | grep '"project"' | sed 's/.*: *"\(.*\)".*/\1/')
else
  PROJECT=$(basename "$(pwd)")
fi
```

### 4. Start server in background

```bash
nohup pnpm --dir ~/.claude/kanban-board dev > /tmp/kanban-board.log 2>&1 &
echo $! > /tmp/kanban-board.pid
```

### 5. Output

```
Kanban board started.

  URL:  http://localhost:5173/?project=<PROJECT>
  PID:  <PID>
  Log:  /tmp/kanban-board.log
  Stop: /kanban-board-stop
```
