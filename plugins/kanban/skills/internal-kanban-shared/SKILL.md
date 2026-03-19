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

| Column | Status | Agent (`subagent_type`) | Model |
|--------|--------|------------------------|-------|
| Req | `todo` | User | - |
| Plan | `plan` | `kanban:Planner` | opus |
| Review Plan | `plan_review` | `kanban:Critic` | sonnet |
| Impl | `impl` | `kanban:Builder` → `kanban:Shield` | opus → sonnet |
| Review Impl | `impl_review` | `kanban:Inspector` (mode kanban) | opus |
| Test | `test` | `kanban:Ranger` | sonnet |
| Done | `done` | - | - |

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
| `Planner` | `kanban:Planner` | `opus` | `plan`, `decision_log`, `done_when` |
| `Critic` | `kanban:Critic` | `sonnet` | `plan_review_comments` |
| `Builder` | `kanban:Builder` | `opus` | `implementation_notes` |
| `Shield` | `kanban:Shield` | `sonnet` | `implementation_notes` (append) |
| `Inspector` | `kanban:Inspector` | `opus` | `review_comments` |
| `Ranger` | `kanban:Ranger` | `sonnet` | `test_results` |

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

## Error Handling

- **Agent failure**: 1 retry; 2nd failure → keep status, log to `agent_log`, notify user
- **Plan review loop**: `plan_review_count > 3` → circuit breaker, ask user
- **Impl review loop**: `impl_review_count > 3` → circuit breaker, ask user
- **Mid-pipeline crash**: preserve status, log to `agent_log`, notify user
- In `--auto` mode: circuit breaker still fires

## Agent Context Flow

| Nickname | Reads | Writes (signed) | Moves to |
|----------|-------|-----------------|----------|
| `Refiner` | `title`, `description` | `description` (rewrite) | stays `todo` |
| `Planner` | `description` | `plan`, `decision_log`, `done_when` | `plan_review` |
| `Critic` | `description`, `plan`, `decision_log`, `done_when` | `plan_review_comments` | `impl` or `plan` |
| `Builder` | `description`, `plan`, `done_when`, `plan_review_comments` | `implementation_notes` | (none) |
| `Shield` | `description`, `implementation_notes` | `implementation_notes` (append) | `impl_review` |
| `Inspector` | `description`, `plan`, `done_when`, `implementation_notes` | `review_comments` | `test` or `impl` |
| `Ranger` | `implementation_notes` | `test_results` | `done` or `impl` |
