---
name: internal-kanban-shared
description: Shared knowledge base for all kanban agents and skills — schema, pipeline, API, formats
disable-model-invocation: true
---

# Kanban Shared Context

Single SQLite database at `~/.claude/kanban/kanban.db`.

## Configurable Pipelines

Pipelines are defined in `~/.claude/kanban/pipelines.json` (user-level):

```json
{
  "pipelines": {
    "full": { "stages": ["Resolver", "Planner", "Critic", "Builder", "Shield", "Inspector", "Ranger"] },
    "quick": { "stages": ["Builder", "Ranger"] }
  },
  "default": "full",
  "max_loops": 3
}
```

Each pipeline is a named sequence of agents. Each task has a `pipeline` field that determines which stages it goes through.

### Flow Rules

- **OK** → move to next stage
- **NOK** → move to previous stage, increment `loop_count`
- **loop_count >= max_loops** → task is BLOCKED. User must add a comment to reset `loop_count` to 0.

### Columns

Board columns = `["todo", ...stages, "done"]`. Dynamic per pipeline.

### Valid Transitions

Each stage can move to its adjacent neighbors (next or previous). `todo` can only go forward. `done` is terminal.

## DB Schema

```sql
CREATE TABLE IF NOT EXISTS tasks (
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
);
```

| Column | Description |
|--------|-------------|
| `status` | Current pipeline stage or `todo`/`done` |
| `priority` | `high` / `medium` / `low` |
| `pipeline` | Name of the pipeline this task uses |
| `description` | Requirements (markdown) |
| `blocks` | JSON array of block objects (all agent outputs) |
| `loop_count` | Number of consecutive NOK verdicts at current stage |
| `tags` | JSON array of strings |
| `notes` | JSON array of note objects |
| `rank` | Display order within column |

## Blocks

All agent output is stored as ordered blocks in the `blocks` JSON array:

```json
{
  "agent": "Planner",
  "content": "## Plan\n...\n\n## Done When\n- [ ] ...",
  "decision_log": "Used X because Y...",
  "verdict": "ok",
  "timestamp": "2026-03-18T10:00:00.000Z"
}
```

Agents do NOT write to the API directly. The orchestrator dispatches agents, parses their response, and writes the block.

## Bash Rules

- **Never chain commands with `&&` or `;`**
- **Never use `$()` command substitution**
- **Never pipe with `| jq` or `| python3`**

## API Endpoints

```bash
# Pipelines config
curl -s http://localhost:5173/api/pipelines
curl -s -X PUT http://localhost:5173/api/pipelines -H 'Content-Type: application/json' -d '{...}'

# Available agents
curl -s http://localhost:5173/api/agents

# Board (filtered by pipeline)
curl -s "http://localhost:5173/api/board?pipeline=full"

# Task CRUD
curl -s http://localhost:5173/api/task/$ID
curl -s -X PATCH http://localhost:5173/api/task/$ID -H 'Content-Type: application/json' -d '{"status": "Planner"}'
curl -s -X POST http://localhost:5173/api/task -H 'Content-Type: application/json' -d '{"title": "...", "pipeline": "full"}'
curl -s -X DELETE http://localhost:5173/api/task/$ID

# Add block (used by orchestrator)
curl -s -X POST http://localhost:5173/api/task/$ID/block -H 'Content-Type: application/json' -d '{"agent": "Planner", "content": "...", "decision_log": "...", "verdict": "ok"}'

# Notes (resets loop_count if task is blocked)
curl -s -X POST http://localhost:5173/api/task/$ID/note -H 'Content-Type: application/json' -d '{"text": "..."}'
```

## Agent Output Format

Agents return:

```markdown
## Content
[main output]

## Decision Log
[reasoning]

## Verdict
ok
```

## Error Handling

- **loop_count >= max_loops** → BLOCKED. User adds comment to unblock.
- **Agent failure** → treated as NOK
