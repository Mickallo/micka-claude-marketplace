---
name: kanban-board-start
description: "Start the kanban board web UI server"
---

Start the kanban board dev server on http://localhost:5173.

## Procedure

### 1. Resolve board path

The board runs directly from the plugin source. Determine the path:

```bash
echo "${CLAUDE_PLUGIN_ROOT}/kanban-board"
```

Store as `BOARD_DIR`. If `CLAUDE_PLUGIN_ROOT` is not set, fall back to `~/.claude/kanban-board` (legacy install).

### 2. Ensure dependencies installed

```bash
if [ ! -d "$BOARD_DIR/node_modules" ]; then
  pnpm --dir "$BOARD_DIR" install
fi
```

### 3. Check if already running

```bash
if lsof -iTCP:5173 -sTCP:LISTEN -t > /dev/null 2>&1; then
  echo "Board already running on http://localhost:5173"
  exit 0
fi
```

### 4. Read project config

```bash
if [ -f .claude/kanban.json ]; then
  PROJECT=$(cat .claude/kanban.json | grep '"project"' | sed 's/.*: *"\(.*\)".*/\1/')
else
  PROJECT=$(basename "$(pwd)")
fi
```

### 5. Start server in background

```bash
nohup pnpm --dir "$BOARD_DIR" dev > /tmp/kanban-board.log 2>&1 &
echo $! > /tmp/kanban-board.pid
```

### 6. Output

```
Kanban board started.

  URL:  http://localhost:5173/?project=<PROJECT>
  PID:  <PID>
  Log:  /tmp/kanban-board.log
  Stop: /kanban-board-stop
```
