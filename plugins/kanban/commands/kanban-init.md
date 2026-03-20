---
name: kanban-init
description: "Register the current project in its own kanban DB. Usage: /kanban-init or /kanban-init my-project-name"
---

Registers the current project in `~/.claude/kanban-dbs/{project}.db`, installs the board web if needed, and creates local config.

## Usage

```
/kanban-init                  — project name = basename of current directory
/kanban-init my-project-name  — explicit project name
```

## Procedure

### 1. Determine project name

```bash
# If argument provided, strip leading dashes and .db suffix:
PROJECT=$(echo "$ARG" | sed 's/^-*//' | sed 's/\.db$//')

# Otherwise:
PROJECT=$(basename "$(pwd)" | sed 's/\.db$//')
```

### 2. Install board dependencies

The board runs directly from the plugin source at `${CLAUDE_PLUGIN_ROOT}/kanban-board/`. No copy needed.

Install dependencies if not already present:

```bash
if [ ! -d "${CLAUDE_PLUGIN_ROOT}/kanban-board/node_modules" ]; then
  pnpm --dir "${CLAUDE_PLUGIN_ROOT}/kanban-board" install
fi
```

### 3. Create DB

```bash
mkdir -p ~/.claude/kanban-dbs
sqlite3 ~/.claude/kanban-dbs/${PROJECT}.db "CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  description TEXT,
  plan TEXT,
  implementation_notes TEXT,
  tags TEXT,
  review_comments TEXT,
  plan_review_comments TEXT,
  test_results TEXT,
  agent_log TEXT,
  current_agent TEXT,
  plan_review_count INTEGER NOT NULL DEFAULT 0,
  impl_review_count INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 3,
  attachments TEXT,
  notes TEXT,
  decision_log TEXT,
  done_when TEXT,
  project_card_id INTEGER,
  milestone_id TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  planned_at TEXT,
  reviewed_at TEXT,
  tested_at TEXT,
  completed_at TEXT
);"
sqlite3 ~/.claude/kanban-dbs/${PROJECT}.db "CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',
  description TEXT,
  linear_project_id TEXT,
  linear_project_url TEXT,
  milestones TEXT,
  task_index TEXT,
  agent_log TEXT,
  current_agent TEXT,
  tags TEXT,
  notes TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);"
sqlite3 ~/.claude/kanban-dbs/${PROJECT}.db "PRAGMA journal_mode=DELETE;"
```

### 4. Write project config

Create `.claude/kanban.json` at the project root:

```json
{
  "project": "<PROJECT_NAME>"
}
```

### 5. Existing config detection

If `.claude/kanban.json` already exists:
1. Read the `project` field, strip `.db` suffix if present
2. Ask user whether to overwrite or keep as-is

### 6. Register status bar service

If `~/.claude/statusline-services.json` exists, register the Kanban service indicator (skip if already present):

```bash
if [ -f ~/.claude/statusline-services.json ]; then
  exists=$(jq '[.[] | select(.name == "Kanban")] | length' ~/.claude/statusline-services.json)
  if [ "$exists" = "0" ]; then
    jq '. += [{"name": "Kanban", "check": "port:5173"}]' ~/.claude/statusline-services.json > /tmp/ss.json && mv /tmp/ss.json ~/.claude/statusline-services.json
  fi
fi
```

### 7. Output

```
Project '<PROJECT_NAME>' registered.

  Config:  .claude/kanban.json
  DB:      ~/.claude/kanban-dbs/<PROJECT_NAME>.db
  Board:   /kanban-board-start
  Stop:    /kanban-board-stop

Add tasks with /kanban add <title>
Add projects with /kanban add <linear-project-url>
```
