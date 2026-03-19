---
name: kanban
description: >
  Manage project tasks in per-project kanban DBs. Supports CRUD (add, edit, move, remove),
  board viewing, session context, and statistics. For pipeline orchestration use /kanban-run,
  for requirements refinement use /kanban-refine. Run /kanban-init first.
---

> Shared context: read `internal-kanban-shared` skill for DB path, pipeline, API, schema, formats.

## Setup

Read project from `.claude/kanban.json`. If missing, prompt user to run `/kanban-init`.

```bash
cat .claude/kanban.json
```

Parse JSON to extract `project` field. If file missing, prompt user to run `/kanban-init`.
Store as PROJECT. DB path: `$HOME/.claude/kanban-dbs/${PROJECT}.db`.

DB access priority: **HTTP API** (`http://localhost:5173`) → **sqlite3 CLI** fallback.

## Commands

### `/kanban` or `/kanban list`

```bash
curl -s "http://localhost:5173/api/board?project=$PROJECT"
```

Parse the JSON response in your context.

Fallback:
```bash
sqlite3 -header -column $DB \
  "SELECT id, title, status, priority FROM tasks WHERE project='$PROJECT' \
   ORDER BY CASE status WHEN 'impl' THEN 0 WHEN 'impl_review' THEN 1 \
   WHEN 'plan' THEN 2 WHEN 'plan_review' THEN 3 WHEN 'test' THEN 4 \
   WHEN 'todo' THEN 5 WHEN 'done' THEN 6 END, id"
```

Output as markdown table: ID | Status | Priority | Title.

### `/kanban context`

Run first when starting a new session. Fetch board and output pipeline state summary:
- Implementing (status `impl`)
- Plan Review (status `plan_review`)
- Impl Review (status `impl_review`)
- Testing (status `test`)
- Recently Done (last 5, status `done`)
- Next Todo (first 3, status `todo`)

### `/kanban add <arg>`

Detect the argument format to determine the source:

| Argument | Source | Example |
|----------|--------|---------|
| Linear identifier (`XXX-123`) | Import from Linear | `/kanban add ENG-42` |
| Linear URL (`linear.app/...`) | Import from Linear | `/kanban add https://linear.app/...` |
| Free text | Manual entry | `/kanban add "Fix login bug"` |

#### Auto-Level Detection

Analyze the task title and description to auto-assign a pipeline level:

| Signal | Level |
|--------|-------|
| Typo, rename, config change, formatting, 1 file | **L1 Quick** |
| Bug fix, small feature, refactor, 2-5 files | **L2 Standard** |
| New feature, architecture change, 6+ files, cross-cutting concern, security | **L3 Full** |

**Keywords → L1**: typo, rename, fix typo, config, formatting, cleanup, lint, wording, env, gitignore, README
**Keywords → L2**: fix, bug, refactor, update, add endpoint, test, migration
**Keywords → L3**: architecture, redesign, new module, security, auth, multi-*, cross-cutting, system

Apply auto-level after collecting title + description. Show the suggested level to the user for confirmation:

```
Auto-detected level: L2 Standard (bug fix, 3 files estimated)
Accept? [Y/n/1/2/3]
```

- `Y` or empty → accept suggestion
- `1`/`2`/`3` → override with that level

#### Source: Linear

1. Fetch the issue from Linear using available Linear MCP tools (search via `ToolSearch` `+linear`). Extract: title, description, priority, labels, state.
2. Map Linear fields to kanban fields:
   - **title** ← issue title
   - **description** ← issue description (markdown)
   - **priority** ← `urgent`/`high` → `high`, `medium` → `medium`, `low`/`none` → `low`
   - **tags** ← issue labels as JSON array
3. Run **Auto-Level Detection** on the imported title + description
4. Show the imported data to user for confirmation before creating
5. Create task (see below)
6. Store the Linear issue identifier in a note on the task for traceability:
   ```bash
   curl -s -X POST "http://localhost:5173/api/task/$ID/note?project=$PROJECT" \
     -H 'Content-Type: application/json' \
     -d '{"content": "Source: Linear <IDENTIFIER>"}'
   ```

#### Source: Manual

1. Ask user via AskUserQuestion for each field separately:
   - **Priority**: `high` / `medium` / `low` (default: `medium`)
   - **Description** (MANDATORY): what should be done and why? (markdown)
   - **Tags**: comma-separated, optional
2. Run **Auto-Level Detection** on the title + description
3. Create task (see below)

#### Create task

```bash
curl -s -X POST http://localhost:5173/api/task \
  -H 'Content-Type: application/json' \
  -d "{\"title\": \"$TITLE\", \"project\": \"$PROJECT\", \"priority\": \"$PRIORITY\", \"level\": $LEVEL, \"description\": \"$DESC\", \"tags\": \"$TAGS_JSON\"}"
```

Output confirmation with new task ID.

### `/kanban move <ID> <status>`

```bash
curl -s -X PATCH "http://localhost:5173/api/task/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d "{\"status\": \"$STATUS\"}"
```

The API enforces valid transitions per pipeline level. Invalid moves return 400.

### `/kanban edit <ID>`

Ask user which fields to modify, then PATCH via API.

### `/kanban remove <ID>`

```bash
curl -s -X DELETE "http://localhost:5173/api/task/$ID?project=$PROJECT"
```

Fallback:
```bash
sqlite3 $DB "DELETE FROM tasks WHERE id=$ID;"
```

### `/kanban stats`

```bash
curl -s "http://localhost:5173/api/board?project=$PROJECT"
```

Parse the JSON response in your context.

Output task counts per column + completion rate.

## Web Board

Start: `/kanban-board-start` → `http://localhost:5173/?project=<PROJECT>`

Add to `.gitignore`:
```
.claude/kanban.json
```
