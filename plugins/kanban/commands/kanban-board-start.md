---
name: kanban-board-start
description: "Start the kanban board web UI server"
---

## Procedure

### 1. Resolve board path

```bash
echo "${CLAUDE_PLUGIN_ROOT}/kanban-board"
```

Store as `BOARD_DIR`.

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

### 4. Start server in background

```bash
nohup env KANBAN_PROJECT_ROOT="$(pwd)" pnpm --dir "$BOARD_DIR" dev > /tmp/kanban-board.log 2>&1 &
echo $! > /tmp/kanban-board.pid
```

### 5. Output

```
Kanban board started.

  URL:  http://localhost:5173
  PID:  <PID>
  Log:  /tmp/kanban-board.log
  Stop: /kanban-board-stop
```
