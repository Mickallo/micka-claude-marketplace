# PR Review from Board — Design Spec

## Goal

Add the ability to launch an AI code review on any GitHub PR directly from the kanban board UI. The Inspector agent reviews the PR, scores it on 8 dimensions, and posts the result on GitHub as inline comments + a global review comment.

## Scope

- New backend endpoint `POST /api/github/review`
- New "Review" button on each PR card in the "Needs Review" column
- New skill `/kanban review-pr` for CLI usage
- Reuse of the Inspector agent with a PR-adapted prompt
- Posting results to GitHub (inline comments + global review)

## Out of Scope

- Automatic/scheduled PR reviews (cron)
- Creating kanban tasks for reviews
- `--request-changes` verdict (never used)

---

## Backend

### Endpoint

```
POST /api/github/review
Body: { owner: string, repo: string, number: number }
Response: { status: "ok" | "error", score?: number, verdict?: "approve" | "comment", url?: string }
```

### Flow

1. **Fetch PR metadata** — `gh pr view {owner}/{repo} --json number,title,body,headRefName,baseRefName,files,url`
2. **Clone/checkout in worktree** — clone the repo (or reuse cached clone), create a temporary git worktree on the PR's head branch
3. **Fetch PR diff** — `gh pr diff {number} --repo {owner}/{repo}`
4. **Dispatch Inspector agent** — spawn the Inspector with a PR-specific prompt containing:
   - PR title, description, diff
   - The worktree path as working directory (so Inspector can read files, load ADRs)
   - Instructions to output the standard 8-dimension scoring table + inline violation comments with `file:line` references
5. **Parse Inspector output** — extract:
   - Scoring table (8 dimensions + average)
   - Inline comments (list of `{path, line, body}`)
   - Verdict: average >= 4.0 → `approve`, otherwise → `comment`
   - Feedback text
6. **Post to GitHub**:
   - Create a pull request review via `gh api repos/{owner}/{repo}/pulls/{number}/reviews` with:
     - `event`: `APPROVE` or `COMMENT`
     - `body`: global review (scoring table + feedback)
     - `comments`: array of `{path, line, side: "RIGHT", body}` using the multi-line review comment format (`subject_type: "line"`) which accepts file line numbers directly, avoiding diff position calculation
7. **Cleanup worktree**
8. **Return result** to frontend

### Parsing Inspector Output

The Inspector already outputs a structured format:

```markdown
## Content

| Dimension | Score | Comment |
|-----------|-------|---------|
| Code Quality | 4/5 | ... |
| ... | ... | ... |
| **Average** | 4.1/5 | |

<feedback text>

### ADR Violations

**`src/file.ts:42`** — [ADR: Title](link)
> Description

**Suggestion:** ...
```

The parser extracts:
- **Scoring table** → regex on `| Dimension | Score | Comment |` block
- **Average score** → from the `**Average**` row
- **Inline comments** → from `**\`file:line\`**` patterns in ADR Violations and feedback
- **Global body** → the full Content section as-is

### Verdict Mapping

| Average Score | GitHub Action |
|---------------|---------------|
| >= 4.0 | `APPROVE` with scoring body |
| < 4.0 | `COMMENT` with scoring body |

No `REQUEST_CHANGES` is ever used.

---

## Frontend

### GitHubBoard.svelte Changes

Add a "Review" button on each PR card in the "Needs Review" column.

#### Button States

| State | Display |
|-------|---------|
| `idle` | "Review" button with Inspector icon |
| `reviewing` | Spinner + "Reviewing..." (disabled) |
| `done` | Green checkmark + score badge |
| `error` | Red X + retry button |

#### Interaction

- Click "Review" → call `POST /api/github/review` with `{owner, repo, number}` extracted from the PR data
- The request is long-running (1-2 min) — the button shows a spinner
- On success: show score badge, the review is already posted on GitHub
- On error: show error state with retry option
- `event.stopPropagation()` on the button to prevent navigating to the PR URL

#### State Management

- Per-PR review state tracked in a local `Map<string, ReviewState>` keyed by `{owner}/{repo}#{number}`
- State resets on page navigation or refresh

### API Addition (api.ts)

```typescript
export async function reviewPR(owner: string, repo: string, number: number): Promise<ReviewResult> {
  return json("/api/github/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, number }),
  });
}
```

---

## Skill: `/kanban review-pr`

CLI alternative to the UI button.

### Usage

```
/kanban review-pr owner/repo#123
/kanban review-pr https://github.com/owner/repo/pull/123
```

### Behavior

1. Parse the PR reference (supports `owner/repo#N` or full URL)
2. Call `POST http://localhost:5173/api/github/review` with `{owner, repo, number}`
3. Display the scoring table and verdict in the terminal
4. Confirm the review was posted on GitHub

---

## Inspector PR Prompt

A variant of the standard Inspector prompt, adapted for PR context instead of kanban task context.

### Key Differences from Task Review

| Aspect | Task Review | PR Review |
|--------|-------------|-----------|
| Context source | Kanban blocks (plan, builder output) | PR title, description, diff |
| Diff source | `git diff origin/main...HEAD` | `gh pr diff` (provided in prompt) |
| Working directory | Builder's worktree | Temporary worktree on PR branch |
| Completion scoring | Against kanban acceptance criteria | Against PR description / linked issues |
| Output destination | Kanban block | GitHub review API |

### Prompt Structure

```
You are reviewing Pull Request #{number}: {title}
Repository: {owner}/{repo}
Branch: {head} → {base}

## PR Description
{body}

## Diff
{diff}

Score this PR on 8 dimensions using your standard rubric.
For inline comments, reference files as `path/to/file.ts:line`.
Output your standard scoring table format.
```

The Inspector's existing ADR loading logic applies unchanged (reads `.reviewer.json` from the worktree).

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `kanban-server/src/routes/github-review.ts` | Review endpoint handler |
| `kanban-server/src/lib/github-review-parser.ts` | Parse Inspector output into GitHub review payload |
| `plugins/kanban/skills/kanban-review-pr/SKILL.md` | CLI skill definition |

### Modified Files

| File | Change |
|------|--------|
| `kanban-server/src/index.ts` | Register new review route |
| `kanban-server/frontend/src/components/GitHubBoard.svelte` | Add Review button + states |
| `kanban-server/frontend/src/lib/api.ts` | Add `reviewPR()` function |
| `kanban-server/frontend/src/lib/types.ts` | Add `ReviewResult` type |

---

## Error Handling

| Error | Behavior |
|-------|----------|
| `gh` CLI not authenticated | Return 401 with message "GitHub CLI not authenticated" |
| Repo not accessible | Return 404 with message |
| Inspector agent fails/times out | Return 500, frontend shows error + retry |
| GitHub review API fails | Return 502, log error, frontend shows error |
| PR already reviewed by bot | Allow re-review (posts new review) |
