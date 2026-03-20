---
name: kanban-run
description: >
  Run the AI team pipeline for kanban tasks and projects — orchestration loop with 7 agents
  (Analyst, Planner, Critic, Builder, Shield, Inspector, Ranger). Use /kanban-run <ID> to execute.
---

> Shared context: `internal-kanban-shared` skill for DB path, pipeline, API, schema, formats.

## Commands

### `/kanban-run <ID> [--auto]`

**Default**: pause for user confirmation at review gates.
**`--auto`**: fully automatic (circuit breaker still fires).

Works for both **project cards** (P#ID) and **task cards** (#ID).

### `/kanban-run step <ID>`

Execute only the next pipeline step then exit.

### `/kanban-run review <ID>`

Trigger Inspector for a task in `impl_review` status.

## Card Type Detection

At the start, determine whether the ID refers to a project card or a task card.

If the user passes `P#<ID>` or mentions "project", try the projects API first:

```bash
curl -s "http://localhost:5173/api/project-card/$ID?project=$PROJECT"
```

If found → **Project Card Flow** (see below).
If 404 → try task API → **Task Card Flow** (existing pipeline).

## Project Card Flow

### `/kanban-run P#<ID>` (explore only)

```
backlog → analyse (Analyst explores + creates milestones/issues/cards) → processing. Stop.
```

1. Read project card state
2. Move to `analyse`:
   ```bash
   curl -s -X PATCH "http://localhost:5173/api/project-card/$ID?project=$PROJECT" \
     -H 'Content-Type: application/json' \
     -d '{"status": "analyse", "current_agent": "Analyst"}'
   ```
4. Dispatch Analyst:
   ```
   Agent(
     subagent_type = "kanban:Analyst",
     model = "opus",
     mode = "auto",
     prompt = "Kanban project P#<ID>, project: <PROJECT>\n\nTitle: <title>\nDescription: <description>\nLinear Project URL: <linear_project_url>\nLinear Project ID: <linear_project_id>"
   )
   ```
5. After Analyst completes, append to project agent_log (same procedure as task agent_log but using `/api/project-card/$ID`)
6. Move to `processing`:
   ```bash
   curl -s -X PATCH "http://localhost:5173/api/project-card/$ID?project=$PROJECT" \
     -H 'Content-Type: application/json' \
     -d '{"status": "processing", "current_agent": null}'
   ```
7. Report what was created and stop.

### `/kanban-run P#<ID> --auto` (full pipeline)

Same as above, then after moving to `processing`:

7. Read the project card to get `milestones` and `task_index`
8. For each milestone (in order by `id`):
   a. Get all task cards with matching `milestone_id`:
      ```bash
      curl -s "http://localhost:5173/api/project-card/$ID/tasks?project=$PROJECT"
      ```
      Filter by `milestone_id` in your context.
   b. For each task card in the milestone, run the existing **Task Card Flow** with `--auto`:
      - Read task, dispatch agents per level (L1/L2/L3), commit, done
   c. When all tasks in the milestone are done, close the milestone on Linear:
      ```
      Use mcp__plugin_linear_linear__save_milestone to update status to completed
      ```
9. When all milestones complete, the project card auto-moves to `done` (handled by API auto-completion hook).
10. Close the Linear project if all milestones are done.

## Task Card Flow (Orchestration Loop — Level-Aware)

Read the task's `level` field first.

```
L1 Quick:
  todo → Builder → commit → done

L2 Standard:
  todo → Planner → impl (skip plan_review)
  impl → Builder + Shield → impl_review
  impl_review → Inspector → [confirm] → commit → done / reject → impl

L3 Full:
  todo → Planner → plan_review
  plan_review → Critic → [confirm] → impl / reject → plan
  impl → Builder + Shield → impl_review
  impl_review → Inspector → [confirm] → test / reject → impl
  test → Ranger → pass → commit → done / fail → impl

Circuit breaker: plan_review_count > 3 OR impl_review_count > 3 → stop, ask user
```

## Model Routing

Resolve each agent's model dynamically before dispatch. See `internal-kanban-shared` → **Model Routing** table.

1. Read task `level` (1/2/3) and `priority` (high/medium/low)
2. If `priority == "high"` → use L3 column
3. Otherwise → use column matching `level`
4. Pass resolved model to `Agent(model = "<resolved>")`

## Agent Dispatch

| Status | Agent (`subagent_type`) | Nickname |
|--------|------------------------|----------|
| `todo` | `kanban:Planner` | Planner |
| `plan_review` | `kanban:Critic` | Critic |
| `impl` step 1 | `kanban:Builder` | Builder |
| `impl` step 2 | `kanban:Shield` | Shield |
| `impl_review` | `kanban:Inspector` | Inspector |
| `test` | `kanban:Ranger` | Ranger |

## Dispatch Procedure

For every agent, execute in order:

### 1. Read task state

```bash
curl -s "http://localhost:5173/api/task/$ID?project=$PROJECT"
```

Parse the JSON response in your context to extract: status, level, title, description, plan, implementation_notes, plan_review_comments, decision_log, done_when.

### 2. Mark agent as active

```bash
curl -s -X PATCH "http://localhost:5173/api/task/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"current_agent": "<Nickname>"}'
```

### 3. Launch agent

Build the prompt with relevant task fields injected, then dispatch with `mode: "auto"`:

```
Agent(
  subagent_type = "kanban:<AgentName>",
  model = "<resolved model>",
  mode = "auto",
  prompt = "Kanban task #<ID>, project: <PROJECT>\n\nTitle: <title>\nDescription: <description>\nPlan: <plan>\n..."
)
```

**All agents MUST be dispatched with `mode: "auto"`** to avoid permission prompts during pipeline execution.

**Prompt content per agent:**

| Agent | Include in prompt |
|-------|-------------------|
| Planner | task ID, project, title, description |
| Critic | task ID, project, title, description, plan, decision_log, done_when |
| Builder | task ID, project, title, description, plan, done_when, plan_review_comments |
| Shield | task ID, project, title, description, implementation_notes |
| Inspector | task ID, project, mode=kanban, description, plan, done_when, implementation_notes |
| Ranger | task ID, project, title, implementation_notes |

### 4. Append to agent_log

After agent completes, read current agent_log, append entry, PATCH back.

**Run each step as a separate Bash call** (no `$()` substitution):

1. Get timestamp:
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
Store the output as TIMESTAMP.

2. Read current log:
```bash
curl -s "http://localhost:5173/api/task/$ID?project=$PROJECT"
```
Parse the JSON response to extract `agent_log` (default `[]`).

3. Build the new log array in your context: append `{"agent": "<Nickname>", "model": "<model>", "message": "<summary>", "timestamp": "<TIMESTAMP>"}` to the existing array.

4. PATCH back with the JSON you built:
```bash
curl -s -X PATCH "http://localhost:5173/api/task/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"agent_log": <BUILT_JSON_ARRAY>, "current_agent": null}'
```
Replace `<BUILT_JSON_ARRAY>` with the literal JSON array you constructed in step 3.

### 5. Re-read state and loop

Re-read task status. Continue to next agent or exit if done/circuit breaker.

## Impl Stage (Builder + Shield)

Builder runs first, then Shield appends. After both complete, the orchestrator moves to `impl_review`:

```bash
curl -s -X PATCH "http://localhost:5173/api/task/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"status": "impl_review", "current_agent": null}'
```

## Review Gates

**Default mode**: after Critic and Inspector complete, use AskUserQuestion to let the user accept/reject before advancing.

**Auto mode (`--auto`)**: auto-accept the agent's decision (approved → advance, changes_requested → loop back).

## Done Transition

### 1. Commit

Commit all pending changes for the kanban task. Use `git add` + `git commit` with a Karma-style message referencing the task ID and title.

### 2. Create PR

Read the task's notes to find a Linear source (format: `Source: Linear <IDENTIFIER>`).

Build the PR body from task fields: description, plan, decision_log, implementation_notes, done_when.

Push the branch and create the PR with `gh pr create`:

```bash
git push -u origin HEAD
gh pr create --title "<TITLE>" --assignee @me --body "$(cat <<'EOF'
## Context
<description>

## Linear
<LINEAR_IDENTIFIER or 'N/A'>

## Plan
<plan summary — first 3-5 lines>

## What was done
<implementation_notes summary — Files Modified section>

## Done When
<done_when checklist>
EOF
)"
```
```

### 3. Move to done and record

Run each as a separate Bash call:

1. Get PR URL:
```bash
gh pr view --json url -q .url
```
Store the output (or "no-pr" if it fails).

2. Get commit hash:
```bash
git rev-parse --short HEAD
```
Store the output (or "no-git" if it fails).

3. Mark done:
```bash
curl -s -X PATCH "http://localhost:5173/api/task/$ID?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"status": "done"}'
```

4. Record note (substitute values from steps 1-2 as literals):
```bash
curl -s -X POST "http://localhost:5173/api/task/$ID/note?project=$PROJECT" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Commit: <HASH>\nPR: <URL>"}'
```

### 4. Sync to Linear

If the task has a Linear source (found in notes as `Source: Linear <IDENTIFIER>`, or in the PR body), sync the full task to Linear.

1. **Export the full task** — fetch the task JSON from the API:
```bash
curl -s "http://localhost:5173/api/task/$ID?project=$PROJECT"
```

2. **Build a markdown report** in your context from the JSON, with all sections:
   - Title, status, priority, level
   - Requirements (description)
   - Plan
   - Decision Log
   - Done When
   - Plan Review
   - Implementation Notes
   - Code Review (from review_comments JSON array)
   - Test Results (from test_results JSON array)
   - Agent Log (from agent_log JSON array)

3. **Sync to Linear** — if Linear MCP tools are available, use them to:
   - Create a document titled `Kanban Task #<ID> — Full Pipeline Report` with the markdown report
   - Create an attachment on the issue with the PR URL
   - Update issue status to `In Review`
   - Add a comment: `PR <PR_URL> created. Kanban pipeline complete.`

   If no Linear tools are available, skip this step.

4. **Update the PR body** — if a Linear document was created, update the PR body's `## Linear` section with the issue link and document URL using `gh pr edit`.
