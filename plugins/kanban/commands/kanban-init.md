---
name: kanban-init
description: "Initialize the kanban system. Creates DB and default pipelines config."
---

## Usage

```
/kanban-init
```

## Procedure

### 1. Install board dependencies

```bash
if [ ! -d "${CLAUDE_PLUGIN_ROOT}/kanban-board/node_modules" ]; then
  pnpm --dir "${CLAUDE_PLUGIN_ROOT}/kanban-board" install
fi
```

### 2. Create DB

```bash
mkdir -p ~/.claude/kanban
sqlite3 ~/.claude/kanban/kanban.db "CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  pipeline TEXT NOT NULL DEFAULT 'full',
  description TEXT,
  blocks TEXT DEFAULT '[]',
  loop_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  attachments TEXT,
  notes TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);"
sqlite3 ~/.claude/kanban/kanban.db "PRAGMA journal_mode=DELETE;"
```

### 3. Write default pipelines config (if not exists)

Create `~/.claude/kanban/pipelines.json` if it doesn't already exist:

```json
{
  "pipelines": {
    "full": {
      "stages": ["Planner", "Critic", "Builder", "Shield", "Inspector", "Ranger"],
      "gates": []
    },
    "quick": { "stages": ["Builder", "Ranger"] }
  },
  "default": "full",
  "max_loops": 3
}
```

### 4. Register status bar service

```bash
if [ -f ~/.claude/statusline-services.json ]; then
  exists=$(jq '[.[] | select(.name == "Kanban")] | length' ~/.claude/statusline-services.json)
  if [ "$exists" = "0" ]; then
    jq '. += [{"name": "Kanban", "check": "port:5173"}]' ~/.claude/statusline-services.json > /tmp/ss.json && mv /tmp/ss.json ~/.claude/statusline-services.json
  fi
fi
```

### 5. Output

```
Kanban initialized.

  DB:        ~/.claude/kanban/kanban.db
  Pipelines: ~/.claude/kanban/pipelines.json
  Board:     /kanban-board-start
  Stop:      /kanban-board-stop

Add tasks with /kanban add <title>
Configure pipelines with /kanban-board-start → ⚙️ Settings
```
