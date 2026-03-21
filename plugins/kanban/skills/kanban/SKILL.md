---
name: kanban
description: >
  Manage tasks in the kanban board. Supports CRUD (add, edit, move, remove),
  board viewing, and statistics. For pipeline orchestration use /kanban-run,
  for requirements refinement use /kanban-refine. Run /kanban-init first.
---

> Shared context: read `internal-kanban-shared` skill for schema, pipeline, API, formats.

## Setup

DB at `~/.claude/kanban/kanban.db`. If missing, prompt user to run `/kanban-init`.

DB access priority: **HTTP API** (`http://localhost:5173`) → **sqlite3 CLI** fallback.

## Commands

### `/kanban` or `/kanban list`

```bash
curl -s "http://localhost:5173/api/board?pipeline=full"
```

Parse the JSON response. The response contains `column_order`, `columns`, `pipeline`, `pipelines`.

Output as markdown table: ID | Status | Priority | Title.

### `/kanban context`

Fetch the board and output pipeline state summary:
- Active stages (tasks in pipeline stages)
- Recently Done (last 5)
- Next Todo (first 3)
- Available pipelines

### `/kanban add <arg>`

| Argument | Source | Example |
|----------|--------|---------|
| Linear identifier (`XXX-123`) | Import from Linear issue | `/kanban add ENG-42` |
| Free text | Manual entry | `/kanban add "Fix login bug"` |

#### Source: Linear

1. Fetch the issue from Linear
2. Map fields: title, description, priority, tags
3. Show to user for confirmation
4. Create task

#### Source: Manual

1. Ask for: Priority, Description (mandatory), Tags
2. Create task

#### Create task

```bash
curl -s -X POST http://localhost:5173/api/task \
  -H 'Content-Type: application/json' \
  -d "{\"title\": \"$TITLE\", \"priority\": \"$PRIORITY\", \"pipeline\": \"$PIPELINE\", \"description\": \"$DESC\"}"
```

### `/kanban move <ID> <status>`

```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d "{\"status\": \"$STATUS\"}"
```

### `/kanban edit <ID>`

Ask user which fields to modify, then PATCH via API.

### `/kanban remove <ID>`

```bash
curl -s -X DELETE http://localhost:5173/api/task/$ID
```

### `/kanban stats`

Fetch the board and output task counts per column + completion rate.

## Web Board

Start: `/kanban-board-start` → `http://localhost:5173`

Use the pipeline dropdown to switch between pipelines. Use the gear icon to configure pipelines.
