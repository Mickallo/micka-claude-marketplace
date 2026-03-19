---
name: kanban-run
description: >
  Run the AI team pipeline for kanban tasks — orchestration loop with 6 agents
  (Planner, Critic, Builder, Shield, Inspector, Ranger). Use /kanban-run <ID> to execute.
---

> Shared context: `internal-kanban-shared` skill for DB path, pipeline, API, schema, formats.

## Commands

### `/kanban-run <ID> [--auto]`

**Default**: pause for user confirmation at plan_review and impl_review gates.
**`--auto`**: fully automatic (circuit breaker still fires).

### `/kanban-run step <ID>`

Execute only the next pipeline step then exit.

### `/kanban-run review <ID>`

Trigger Inspector for a task in `impl_review` status.

## Orchestration Loop (Level-Aware)

Read the task's `level` field first.

```
L1 Quick:
  todo → Builder(opus) → commit → done

L2 Standard:
  todo → Planner(opus) → impl (skip plan_review)
  impl → Builder(opus) + Shield(sonnet) → impl_review
  impl_review → Inspector(opus) → [confirm] → commit → done / reject → impl

L3 Full:
  todo → Planner(opus) → plan_review
  plan_review → Critic(sonnet) → [confirm] → impl / reject → plan
  impl → Builder(opus) + Shield(sonnet) → impl_review
  impl_review → Inspector(opus) → [confirm] → test / reject → impl
  test → Ranger(sonnet) → pass → commit → done / fail → impl

Circuit breaker: plan_review_count > 3 OR impl_review_count > 3 → stop, ask user
```

## Agent Dispatch

| Status | Agent (`subagent_type`) | Nickname | Model |
|--------|------------------------|----------|-------|
| `todo` | `kanban:Planner` | Planner | opus |
| `plan_review` | `kanban:Critic` | Critic | sonnet |
| `impl` step 1 | `kanban:Builder` | Builder | opus |
| `impl` step 2 | `kanban:Shield` | Shield | sonnet |
| `impl_review` | `kanban:Inspector` | Inspector | opus |
| `test` | `kanban:Ranger` | Ranger | sonnet |

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
