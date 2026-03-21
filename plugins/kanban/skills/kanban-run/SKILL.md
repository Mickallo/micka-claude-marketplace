---
name: kanban-run
description: >
  Run the configurable AI pipeline for kanban tasks. Reads pipelines.json, dispatches agents in order,
  handles ok/nok/blocked flow. Use /kanban-run <ID> to execute.
---

> Shared context: `internal-kanban-shared` skill for schema, pipeline, API, formats.

## Commands

### `/kanban-run <ID> [--auto]`

**Default**: pause for user confirmation after each agent.
**`--auto`**: fully automatic (blocked state still fires).

### `/kanban-run step <ID>`

Execute only the next pipeline step then exit.

## Orchestration Loop

### 1. Read task and pipeline

```bash
curl -s http://localhost:5173/api/task/$ID
```

Parse: `status`, `pipeline`, `blocks`, `loop_count`, `title`, `description`, `notes`.

```bash
curl -s http://localhost:5173/api/pipelines
```

Get the task's pipeline stages from `pipelines[task.pipeline].stages` and `max_loops`.

### 2. Determine current position

```
columns = ["todo", ...stages, "done"]
current_index = columns.indexOf(task.status)
```

If `status == "todo"` → move to first stage.
If `status == "done"` → exit.

### 3. Check blocked

If `loop_count >= max_loops` → STOP. Tell user to add a comment to unblock.

### 4. Dispatch agent

The current stage name IS the agent name.

```
Agent(
  subagent_type = "kanban:<stage_name>",
  mode = "auto",
  prompt = "Kanban task #<ID>

Title: <title>
Description: <description>

Previous blocks:
<for each block>
---
Agent: <agent> | Verdict: <verdict> | <timestamp>
Content: <content>
Decision Log: <decision_log>
---
</for>

User notes:
<for each note>
- <author> (<timestamp>): <text>
</for>

Return your response in this EXACT format:

## Content
[your main output]

## Decision Log
[your reasoning]

## Verdict
ok or nok"
)
```

### 5. Parse and write block

Extract `content`, `decision_log`, `verdict` from agent output (default `ok`).

```bash
curl -s -X POST http://localhost:5173/api/task/$ID/block \
  -H 'Content-Type: application/json' \
  -d '{"agent": "<stage>", "content": "<content>", "decision_log": "<log>", "verdict": "<verdict>"}'
```

### 6. Move task

**verdict == ok:**
```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d '{"status": "<next_stage>", "loop_count": 0}'
```
If next is `done` → go to Done Transition.

**verdict == nok:**
```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d '{"loop_count": <current + 1>}'
```
If `loop_count >= max_loops` → BLOCKED, stop.
Otherwise move to previous stage.

### 7. Loop or confirm

**`--auto`**: loop to step 1.
**Default**: show summary, ask to continue.
**`step`**: exit.

## Done Transition

1. Commit with `git add` + `git commit`
2. Push + `gh pr create`
3. Mark done: `PATCH /api/task/$ID {"status": "done"}`
4. Record note: `POST /api/task/$ID/note {"text": "Commit: <HASH>\nPR: <URL>"}`
