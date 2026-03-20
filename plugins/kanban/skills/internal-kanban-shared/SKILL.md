---
name: internal-kanban-shared
description: Shared knowledge base for all kanban agents and skills — schema, pipeline, API, formats
disable-model-invocation: true
---

# Kanban Shared Context

Per-project SQLite databases at `~/.claude/kanban-dbs/{project}.db`.

## DB Path & Project Config

Read project config from `.claude/kanban.json` (created by `/kanban-init`):

```bash
cat .claude/kanban.json
```

Parse JSON to extract `project` field. If file missing, prompt user to run `/kanban-init`.
Store as PROJECT. DB path: `$HOME/.claude/kanban-dbs/${PROJECT}.db`.

## Pipeline Levels

| Level | Path | Use Case |
|-------|------|----------|
| L1 Quick | `todo → impl → done` | File cleanup, config, typos |
| L2 Standard | `todo → plan → impl → impl_review → done` | Features, bug fixes, refactoring |
| L3 Full | `todo → plan → plan_review → impl → impl_review → test → done` | New features, architecture changes |

## 7-Column Pipeline

| Column | Status | Agent (`subagent_type`) |
|--------|--------|------------------------|
| Req | `todo` | User |
| Plan | `plan` | `kanban:Planner` |
| Review Plan | `plan_review` | `kanban:Critic` |
| Impl | `impl` | `kanban:Builder` → `kanban:Shield` |
| Review Impl | `impl_review` | `kanban:Inspector` (mode kanban) |
| Test | `test` | `kanban:Ranger` |
| Done | `done` | - |

## Model Routing

Models are selected dynamically based on task `level` and `priority`.

**Override rule**: `priority = "high"` → always use the L3 models regardless of level.

| Agent | L1 | L2 | L3 |
|-------|-----|-----|-----|
| Planner | — | sonnet | opus |
| Critic | — | — | sonnet |
| Builder | sonnet | sonnet | opus |
| Shield | — | haiku | sonnet |
| Inspector | — | sonnet | opus |
| Ranger | — | — | sonnet |

To resolve the model for an agent dispatch:
1. Read task `level` and `priority`
2. If `priority == "high"`, use L3 column
3. Otherwise use the column matching `level`
4. Pass the resolved model to `Agent(model = "<resolved>")`

### Valid Status Transitions

```
todo        → plan
plan        → plan_review, impl (L2: skip review), todo
plan_review → impl (approve), plan (reject)
impl        → impl_review
impl_review → test (approve), impl (reject)
test        → done (pass), impl (fail)
done        → (terminal)
```

## DB Schema

```sql
CREATE TABLE IF NOT EXISTS tasks (
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
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  planned_at TEXT,
  reviewed_at TEXT,
  tested_at TEXT,
  completed_at TEXT
);
```

| Column | Description |
|--------|-------------|
| `status` | `todo` / `plan` / `plan_review` / `impl` / `impl_review` / `test` / `done` |
| `priority` | `high` / `medium` / `low` |
| `level` | Pipeline level: 1 (Quick), 2 (Standard), 3 (Full) |
| `description` | Requirements (markdown) |
| `plan` | Implementation plan (markdown, signed by Planner) |
| `decision_log` | Architecture decisions table (markdown, signed by Planner) |
| `done_when` | Verifiable completion checklist (markdown, signed by Planner) |
| `implementation_notes` | Code changes log (markdown, signed by Builder + Shield) |
| `plan_review_comments` | JSON array of plan review objects |
| `review_comments` | JSON array of code review objects |
| `test_results` | JSON array of test result objects |
| `agent_log` | JSON array of chronological agent actions |
| `current_agent` | Currently active agent nickname |
| `tags` | JSON array of strings |
| `notes` | JSON array of note objects |
| `rank` | Display order within column |

## Bash Rules

- **Never chain commands with `&&` or `;`** — run each as a separate Bash call
- **Never use `$()` command substitution** — run the inner command separately, parse the result in your context
- **Never use `cd X && command`** — instead, use absolute paths or run `cd` as a separate Bash call first
- **Never pipe with `| jq` or `| python3`** — run the command, then parse the output in your context
- These rules prevent Claude Code security prompts that block automation

## DB Access

Priority: **HTTP API** (`http://localhost:5173`) → **sqlite3 CLI** fallback.

Do NOT use `python3 -c "import sqlite3..."`. Use `/usr/bin/sqlite3`.

```bash
# Read
sqlite3 -json ~/.claude/kanban-dbs/$PROJECT.db \
  "SELECT id, title, status, priority FROM tasks WHERE project='$PROJECT' ORDER BY id"

# Update
sqlite3 ~/.claude/kanban-dbs/$PROJECT.db \
  "UPDATE tasks SET status='impl', started_at=datetime('now') WHERE id=$ID"
```

### API Endpoints

```bash
# Board
curl -s "http://localhost:5173/api/board?project=$PROJECT"

# Read task
curl -s "http://localhost:5173/api/task/$ID?project=$PROJECT"

# Update task
curl -s -X PATCH "http://localhost:5173/api/task/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"plan": "...", "status": "plan_review"}'

# Create task
curl -s -X POST http://localhost:5173/api/task \
  -H 'Content-Type: application/json' \
  -d "{\"title\": \"...\", \"project\": \"$PROJECT\", \"priority\": \"medium\", \"level\": 3, \"description\": \"...\"}"

# Plan review
curl -s -X POST "http://localhost:5173/api/task/$ID/plan-review?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"reviewer": "Critic", "model": "sonnet", "status": "approved", "comment": "..."}'

# Code review
curl -s -X POST "http://localhost:5173/api/task/$ID/review?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"reviewer": "Inspector", "model": "opus", "status": "approved", "comment": "..."}'

# Test result
curl -s -X POST "http://localhost:5173/api/task/$ID/test-result?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"tester": "Ranger", "model": "sonnet", "status": "pass", "lint": "...", "build": "...", "tests": "...", "comment": "..."}'

# Add note
curl -s -X POST "http://localhost:5173/api/task/$ID/note?project=$PROJECT" \
  -H 'Content-Type: application/json' -d '{"content": "..."}'

# Delete
curl -s -X DELETE "http://localhost:5173/api/task/$ID?project=$PROJECT"
```

## Agent Nicknames & Signatures

Each agent MUST prepend a signature header to its output:

```markdown
> **Planner** `opus` · 2026-03-18T10:00:00Z
```

| Nickname | Agent | Model | Writes to |
|----------|-------|-------|-----------|
| `Analyst` | `kanban:Analyst` | opus | project `description`, `milestones`, `task_index` |
| `Planner` | `kanban:Planner` | routed | `plan`, `decision_log`, `done_when` |
| `Critic` | `kanban:Critic` | routed | `plan_review_comments` |
| `Builder` | `kanban:Builder` | routed | `implementation_notes` |
| `Shield` | `kanban:Shield` | routed | `implementation_notes` (append) |
| `Inspector` | `kanban:Inspector` | routed | `review_comments` |
| `Ranger` | `kanban:Ranger` | routed | `test_results` |

Model is resolved via the **Model Routing** table above.

## JSON Formats

### plan_review_comments / review_comments

```json
[
  {
    "reviewer": "Critic",
    "model": "sonnet",
    "status": "approved",
    "comment": "> **Critic** `sonnet` · 2026-03-18T14:30:00Z\n\n## Review\n...",
    "timestamp": "2026-03-18T14:30:00.000Z"
  }
]
```

`status`: `"approved"` or `"changes_requested"`.

### test_results

```json
[
  {
    "tester": "Ranger",
    "model": "sonnet",
    "status": "pass",
    "lint": "0 errors, 0 warnings",
    "build": "Build successful",
    "tests": "42 passed, 0 failed",
    "comment": "> **Ranger** `sonnet` · 2026-03-18T15:00:00Z\n\nAll checks passed.",
    "timestamp": "2026-03-18T15:00:00.000Z"
  }
]
```

`status`: `"pass"` or `"fail"`.

### agent_log

```json
[
  {
    "agent": "Planner",
    "model": "opus",
    "message": "Plan complete. 4 files to modify.",
    "timestamp": "2026-03-18T10:05:00.000Z"
  }
]
```

## Projects Board

Separate board for tracking Linear projects through analysis and decomposition.

### Projects Table Schema

```sql
CREATE TABLE IF NOT EXISTS projects (
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
);
```

| Column | Description |
|--------|-------------|
| `status` | `backlog` / `analyse` / `processing` / `done` |
| `linear_project_id` | Linear project identifier |
| `linear_project_url` | Original Linear project URL |
| `milestones` | JSON array of `{id, linear_id, title, status}` |
| `task_index` | JSON array of child task IDs |
| `description` | Analyst exploration report (markdown) |

### Project Status Transitions

```
backlog    → analyse
analyse    → processing, backlog
processing → done
done       → (terminal)
```

### Task-Project Linking

Tasks table has two linking columns:
- `project_card_id` — references `projects.id` (parent project card)
- `milestone_id` — references a milestone within the project

Auto-completion: when ALL tasks with a given `project_card_id` reach `done`, the project card auto-moves to `done`.

### Projects Board Pipeline

| Column | Status | Agent |
|--------|--------|-------|
| Backlog | `backlog` | User (import from Linear) |
| Analysis | `analyse` | `kanban:Analyst` |
| Processing | `processing` | (sub-tasks running on Tasks board) |
| Done | `done` | Auto (all sub-tasks done) |

### Analyst Agent

| Nickname | Agent | Model | Writes to |
|----------|-------|-------|-----------|
| `Analyst` | `kanban:Analyst` | opus | project `description`, `milestones`, `task_index` |

The Analyst:
1. Reads project card (title, description, Linear project URL)
2. Deep-explores the codebase
3. Produces exploration report
4. Decomposes into milestones and issues
5. Creates milestones on Linear (via Linear MCP tools)
6. Creates issues on Linear (linked to milestones)
7. Creates corresponding task cards on Tasks board (with `project_card_id` and `milestone_id`)
8. Updates project card with report, milestones JSON, and task_index
9. Moves project card to `processing`

### Projects Board API Endpoints

```bash
# Projects board
curl -s "http://localhost:5173/api/projects-board?project=$PROJECT"

# Read project card
curl -s "http://localhost:5173/api/project-card/$ID?project=$PROJECT"

# Create project card
curl -s -X POST http://localhost:5173/api/project-card \
  -H 'Content-Type: application/json' \
  -d "{\"title\": \"...\", \"project\": \"$PROJECT\", \"linear_project_id\": \"...\", \"linear_project_url\": \"...\"}"

# Update project card
curl -s -X PATCH "http://localhost:5173/api/project-card/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"description": "...", "milestones": "...", "task_index": "...", "status": "processing"}'

# Get child tasks
curl -s "http://localhost:5173/api/project-card/$ID/tasks?project=$PROJECT"

# Add note
curl -s -X POST "http://localhost:5173/api/project-card/$ID/note?project=$PROJECT" \
  -H 'Content-Type: application/json' -d '{"text": "..."}'

# Delete
curl -s -X DELETE "http://localhost:5173/api/project-card/$ID?project=$PROJECT"
```

### Create task linked to project

```bash
curl -s -X POST http://localhost:5173/api/task \
  -H 'Content-Type: application/json' \
  -d "{\"title\": \"...\", \"project\": \"$PROJECT\", \"priority\": \"medium\", \"level\": 3, \"description\": \"...\", \"project_card_id\": $PROJECT_CARD_ID, \"milestone_id\": \"$MILESTONE_ID\"}"
```

## Error Handling

- **Agent failure**: 1 retry; 2nd failure → keep status, log to `agent_log`, notify user
- **Plan review loop**: `plan_review_count > 3` → circuit breaker, ask user
- **Impl review loop**: `impl_review_count > 3` → circuit breaker, ask user
- **Mid-pipeline crash**: preserve status, log to `agent_log`, notify user
- In `--auto` mode: circuit breaker still fires

## Agent Context Flow

| Nickname | Reads | Writes (signed) | Moves to |
|----------|-------|-----------------|----------|
| `Analyst` | project `title`, `description`, `linear_project_url` | project `description`, `milestones`, `task_index` + creates tasks | `processing` |
| `Refiner` | `title`, `description` | `description` (rewrite) | stays `todo` |
| `Planner` | `description` | `plan`, `decision_log`, `done_when` | `plan_review` |
| `Critic` | `description`, `plan`, `decision_log`, `done_when` | `plan_review_comments` | `impl` or `plan` |
| `Builder` | `description`, `plan`, `done_when`, `plan_review_comments` | `implementation_notes` | (none) |
| `Shield` | `description`, `implementation_notes` | `implementation_notes` (append) | `impl_review` |
| `Inspector` | `description`, `plan`, `done_when`, `implementation_notes` | `review_comments` | `test` or `impl` |
| `Ranger` | `implementation_notes` | `test_results` | `done` or `impl` |
