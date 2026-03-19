---
name: kanban-refine
description: >
  Refine backlog requirements through structured user interview. Turns rough task
  descriptions into concrete, actionable requirements with goal, scope, acceptance criteria.
---

> Shared context: `internal-kanban-shared` skill for DB path, pipeline, API, schema, formats.

## `/kanban-refine <ID>`

Target: tasks in `todo` status. If not `todo`, warn and confirm before proceeding.

### Procedure

#### 1. Read the task

```bash
curl -s "http://localhost:5173/api/task/$ID?project=$PROJECT"
```

Parse the JSON response to extract: title, description, priority, level, tags.

#### 2. Display current state

Show the user their raw title + description as-is.

#### 3. Analyze for gaps

Identify what's missing or vague across:

- **WHAT**: What exactly should be built/changed?
- **WHY**: What problem does this solve?
- **SCOPE**: What's included vs excluded?
- **ACCEPTANCE**: How do we know it's done?
- **CONSTRAINTS**: Technical limitations, compatibility, performance?
- **EDGE CASES**: Error states, boundary conditions?
- **DEPENDENCIES**: Other tasks or external systems?

#### 4. Interview the user

Use AskUserQuestion to ask about the gaps found in step 3.

- 1-4 focused questions per round
- Group related questions in one round
- Max 3 rounds
- Stop early if user says "enough" or all gaps are filled
- Use concrete options when possible, not open-ended questions

#### 5. Synthesize refined description

Rewrite using this template:

```markdown
## Goal
[1-2 sentences: what this task achieves and why]

## Scope
- IN: [what's included]
- OUT: [what's explicitly excluded]

## Requirements
[Numbered list of concrete, testable requirements]

## Acceptance Criteria
- [ ] [Checklist items — each verifiable]

## Constraints
[Technical constraints, if any]

## Edge Cases
[Edge cases to handle, if any]
```

Omit sections with no content.

#### 6. Present and confirm

Show the refined description. Ask user via AskUserQuestion:
- **Approve & save**
- **Edit more** (back to interview)
- **Cancel** (discard)

#### 7. Save

If approved:
- PATCH `description` via API
- Update `title`, `level`, `priority`, `tags` if discussed
- Append to `agent_log`:

```json
{"agent": "Refiner", "model": "sonnet", "message": "Requirements refined. N questions across M rounds.", "timestamp": "..."}
```
