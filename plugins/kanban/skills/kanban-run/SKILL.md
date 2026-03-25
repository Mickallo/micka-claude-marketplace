---
name: kanban-run
description: >
  Run the configurable AI pipeline for kanban tasks. Reads pipelines.json, dispatches agents in order,
  handles ok/nok/relay/blocked flow. Use /kanban-run <ID> to execute.
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

Get the task's pipeline stages from `pipelines[task.pipeline].stages`, `gates` (array of stage names requiring user validation), and `max_loops`.

### 2. Determine current position

```
columns = ["todo", ...stages, "done"]
current_index = columns.indexOf(task.status)
```

If `status == "todo"` → move to first stage.
If `status == "done"` → exit.
If `status` starts with `awaiting:` → this is a gate sub-state. Go to **Gate Validation** section.

### 3. Check blocked

If `loop_count >= max_loops` → STOP. Tell user to add a comment to unblock.

### 4. Dispatch agent

The current stage name IS the agent name.

**Check if a previous agent can be resumed**: look through `blocks` in reverse for the most recent block where `block.agent == <stage_name>` and `block.agent_id` exists. If found, resume it via `SendMessage`. Otherwise, spawn a new agent.

**Resume existing agent (preferred on NOK retry):**

```
SendMessage(
  to = "<agent_id from previous block>",
  message = "The task was sent back to your stage.

<if previous block verdict is "relay">
The next agent reported a problem but could not fix it. Review the feedback and either address it yourself or relay it further back.
</if>

Feedback:
<content and decision_log from the block that caused the retry>

User notes (if any new ones):
<new notes since your last block>

Respond with your output, then on the last line write one of:
- ok — done, proceed to next stage
- nok — problem found, send back to previous stage
- relay — problem found but not in my scope, forward back"
)
```

**Spawn new agent (first time at this stage):**

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

Respond with your output, then on the last line write one of:
- ok — done, proceed to next stage
- nok — problem found, send back to previous stage
- relay — problem found but not in my scope, forward back"
)
```

After dispatch, capture the `agentId` from the Agent/SendMessage result.

### 5. Parse and write block

Extract `content`, `decision_log`, `verdict` from agent output (default `ok`).

**CRITICAL — preserve markdown formatting**:
- Copy `content` and `decision_log` **verbatim** from the agent output.
- Preserve all newlines, headings, tables, lists, code blocks exactly as written.
- Do NOT summarize, flatten, or compress the content into a single line.

Include the `agent_id` in the block payload.

Write the block as a JSON file then POST it, to preserve multiline content:

```bash
cat > /tmp/kanban-block.json <<'BLOCK_EOF'
{
  "agent": "<stage>",
  "agent_id": "<agentId from step 4>",
  "content": <content as properly escaped JSON string>,
  "decision_log": <decision_log as properly escaped JSON string>,
  "verdict": "<verdict>"
}
BLOCK_EOF
curl -s -X POST http://localhost:5173/api/task/$ID/block \
  -H 'Content-Type: application/json' \
  -d @/tmp/kanban-block.json
```

### 6. Move task

**verdict == ok:**

Check if current stage is in `gates` array. If yes → enter gate sub-state:
```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d '{"status": "awaiting:<current_stage>", "loop_count": 0}'
```
Then STOP (even in `--auto` mode). Tell the user:
> Stage **<current_stage>** completed and awaiting validation.
> Approve or refuse from the board UI, or run `/kanban-run <ID>` again to decide inline.

If current stage is NOT in `gates` → normal flow. Move to next stage: `columns[current_index + 1]`.
```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d '{"status": "<next_stage>", "loop_count": 0}'
```
If next is `done` → go to Done Transition.

**verdict == nok:**
Increment loop_count. If `loop_count >= max_loops` → BLOCKED, stop.
Otherwise move to previous stage: `columns[current_index - 1]`.
```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d '{"status": "<previous_stage>", "loop_count": <current + 1>}'
```
Example: if current is `Ranger` (index 6) in the full pipeline `["todo","Resolver","Planner","Critic","Builder","Inspector","Ranger","done"]`, previous is `Inspector` (index 5). Never skip stages.

**verdict == relay:**
Move to previous stage: `columns[current_index - 1]`. Do not increment loop_count.
```bash
curl -s -X PATCH http://localhost:5173/api/task/$ID \
  -H 'Content-Type: application/json' \
  -d '{"status": "<previous_stage>"}'
```

### 7. Loop or confirm

**`--auto`**: loop to step 1.
**Default**: show summary, ask to continue.
**`step`**: exit.

## Gate Validation

When `status` starts with `awaiting:`, extract the stage name: `stage = status.slice("awaiting:".length)`.

The user may have already approved or refused via the board UI. In that case, the status is no longer `awaiting:` and the normal orchestration loop applies.

If the status is still `awaiting:`, show the user the last block output (content + decision_log) and ask via `AskUserQuestion`:

> **Approve** — advance to next stage
> **Refuse** — you must provide a comment explaining what to fix

**Approve:**
```bash
curl -s -X POST http://localhost:5173/api/task/$ID/gate \
  -H 'Content-Type: application/json' \
  -d '{"action": "approve"}'
```
If the resulting status is `done` → go to Done Transition. Otherwise loop to step 1.

**Refuse:**
The user MUST provide a comment. If they don't, ask again.
```bash
curl -s -X POST http://localhost:5173/api/task/$ID/gate \
  -H 'Content-Type: application/json' \
  -d '{"action": "refuse", "comment": "<user comment>"}'
```
The API adds the comment as a note and moves the task back to the stage. Loop to step 1 (the agent will be resumed with the user's feedback).

## Done Transition

1. Mark done:
   ```bash
   curl -s -X PATCH http://localhost:5173/api/task/$ID \
     -H 'Content-Type: application/json' \
     -d '{"status": "done"}'
   ```
2. Tell the user: "Ready to ship. Run `/kanban-ship <ID>` to push and create the PR."
