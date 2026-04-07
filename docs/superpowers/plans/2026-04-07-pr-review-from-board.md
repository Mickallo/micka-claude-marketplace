# PR Review from Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Review" button on each PR card in the kanban GitHub board that dispatches the Inspector agent and posts the review (inline comments + global scoring) on GitHub.

**Architecture:** New `POST /api/github/review` endpoint clones the PR repo in a temporary worktree, spawns the Inspector agent with a PR-adapted prompt, parses the output (scoring table + file:line comments), and posts the review via `gh api`. The frontend adds a Review button per PR card with loading/done/error states.

**Tech Stack:** Hono (backend), Svelte 5 (frontend), `gh` CLI for GitHub API, Claude Inspector agent

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/routes/github-review.ts` | Create | Review endpoint: clone, dispatch Inspector, parse output, post to GitHub |
| `src/index.ts` | Modify (line 15-16, 83) | Import and register the new route |
| `frontend/src/lib/api.ts` | Modify (line 119) | Add `reviewPR()` function |
| `frontend/src/lib/types.ts` | Modify (line 134) | Add `ReviewResult` interface |
| `frontend/src/components/GitHubBoard.svelte` | Modify | Add Review button with states |

---

### Task 1: Backend — Review endpoint scaffolding

**Files:**
- Create: `kanban-server/src/routes/github-review.ts`
- Modify: `kanban-server/src/index.ts:15-16,83`

- [ ] **Step 1: Create the route file with endpoint skeleton**

Create `src/routes/github-review.ts`:

```typescript
import { Hono } from "hono";
import { execSync, spawn } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnAgent } from "../terminal.js";

const app = new Hono();

interface ReviewRequest {
  owner: string;
  repo: string;
  number: number;
}

interface InlineComment {
  path: string;
  line: number;
  body: string;
}

interface ReviewResult {
  status: "ok" | "error";
  score?: number;
  verdict?: "approve" | "comment";
  body?: string;
  comments?: InlineComment[];
  error?: string;
}

app.post("/api/github/review", async (c) => {
  const body = await c.req.json() as ReviewRequest;
  const { owner, repo, number } = body;

  if (!owner || !repo || !number) {
    return c.json({ status: "error", error: "owner, repo, and number required" } as ReviewResult, 400);
  }

  try {
    // Step 1: Fetch PR metadata
    const prJson = execSync(
      `gh pr view ${number} --repo ${owner}/${repo} --json title,body,headRefName,baseRefName,files,url`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const pr = JSON.parse(prJson);

    // Step 2: Get PR diff
    const diff = execSync(
      `gh pr diff ${number} --repo ${owner}/${repo}`,
      { encoding: "utf-8", timeout: 30000 }
    );

    // Step 3: Clone repo into temp worktree
    const tmpDir = mkdtempSync(path.join(tmpdir(), "pr-review-"));
    try {
      execSync(`gh repo clone ${owner}/${repo} ${tmpDir} -- --depth=50 --branch ${pr.headRefName}`, {
        encoding: "utf-8",
        timeout: 120000,
      });

      // Step 4: Dispatch Inspector
      const result = await dispatchInspector(tmpDir, owner, repo, number, pr, diff);

      // Step 5: Post review to GitHub
      await postReviewToGitHub(owner, repo, number, result);

      return c.json(result);
    } finally {
      // Cleanup
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not logged") || msg.includes("401") || msg.includes("authentication")) {
      return c.json({ status: "error", error: "gh CLI not authenticated" } as ReviewResult, 401);
    }
    console.error("[github-review] Error:", msg);
    return c.json({ status: "error", error: msg } as ReviewResult, 500);
  }
});

export default app;
```

The `dispatchInspector` and `postReviewToGitHub` functions are implemented in the next tasks.

- [ ] **Step 2: Register the route in index.ts**

In `src/index.ts`, add the import after line 15:

```typescript
import githubReviewRoutes from "./routes/github-review.js";
```

And register it after line 83 (`app.route("/", githubRoutes);`):

```typescript
app.route("/", githubReviewRoutes);
```

- [ ] **Step 3: Verify the server compiles**

Run: `cd /Users/micka/Projects/micka-claude-marketplace/plugins/kanban/kanban-server && pnpm build`
Expected: No compilation errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/github-review.ts src/index.ts
git commit -m "feat(kanban): scaffold PR review endpoint"
```

---

### Task 2: Backend — Inspector dispatch and output parsing

**Files:**
- Modify: `kanban-server/src/routes/github-review.ts`

- [ ] **Step 1: Add the dispatchInspector function**

Add before the `app.post` call in `github-review.ts`:

```typescript
function buildInspectorPrompt(
  owner: string, repo: string, number: number,
  pr: { title: string; body: string; headRefName: string; baseRefName: string },
  diff: string
): string {
  // Truncate diff to 100k chars to avoid context overflow
  const truncatedDiff = diff.length > 100000
    ? diff.slice(0, 100000) + "\n\n... [diff truncated at 100k chars]"
    : diff;

  return `You are reviewing Pull Request #${number}: ${pr.title}
Repository: ${owner}/${repo}
Branch: ${pr.headRefName} → ${pr.baseRefName}

## PR Description

${pr.body || "(no description)"}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

Review this PR using your standard 8-dimension scoring rubric.

For inline comments on specific code issues, reference files as \`path/to/file.ts:42\` (the exact path from the diff headers, without leading a/ or b/).

Output your standard scoring table format with ## Content, ## Decision Log, and ## Verdict sections.`;
}

function dispatchInspector(
  cwd: string, owner: string, repo: string, number: number,
  pr: { title: string; body: string; headRefName: string; baseRefName: string },
  diff: string
): Promise<ReviewResult> {
  return new Promise((resolve) => {
    const prompt = buildInspectorPrompt(owner, repo, number, pr, diff);

    const args = [
      "--agent", "kanban:Inspector",
      "-p", prompt,
      "--output-format", "json",
    ];

    spawnAgent({
      args,
      cwd,
      interactive: false,
      onFinish: (output, exitCode) => {
        const clean = output
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
          .replace(/\x1b\][^\x07]*\x07/g, "")
          .replace(/\x1b[><=][^\n]*/g, "")
          .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "")
          .replace(/\r/g, "")
          .trim();

        // Extract JSON result
        let parsedText = clean;
        const jsonMatch = clean.match(/\{["\s]*type["\s]*:["\s]*result[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const json = JSON.parse(jsonMatch[0]);
            parsedText = json.result || json.text || clean;
          } catch {}
        }

        // Parse scoring table — extract average
        const avgMatch = parsedText.match(/\*\*Average\*\*\s*\|\s*(\d+(?:\.\d+)?)\s*\/\s*5/);
        const score = avgMatch ? parseFloat(avgMatch[1]) : undefined;

        // Parse content section (the review body for GitHub)
        const contentMatch = parsedText.match(/## Content\s*\n([\s\S]*?)(?=\n## Decision Log|\n## Verdict|$)/);
        const body = contentMatch ? contentMatch[1].trim() : parsedText.slice(0, 5000);

        // Parse inline comments from file:line patterns
        const comments = parseInlineComments(parsedText);

        // Determine verdict
        const verdict: "approve" | "comment" = score !== undefined && score >= 4.0 ? "approve" : "comment";

        resolve({ status: "ok", score, verdict, body, comments });
      },
    });
  });
}
```

- [ ] **Step 2: Add the inline comment parser**

Add after the `dispatchInspector` function:

```typescript
function parseInlineComments(text: string): InlineComment[] {
  const comments: InlineComment[] = [];
  // Match patterns like **`src/file.ts:42`** — description
  const pattern = /\*\*`([^`]+):(\d+)`\*\*\s*(?:—|-)?\s*([\s\S]*?)(?=\n\*\*`|\n###|\n## |$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const filePath = match[1];
    const line = parseInt(match[2]);
    // Collect the body: description + suggestion
    let body = match[3].trim();
    // Clean up markdown blockquotes
    body = body.replace(/^>\s*/gm, "").trim();
    if (body) {
      comments.push({ path: filePath, line, body });
    }
  }
  return comments;
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/micka/Projects/micka-claude-marketplace/plugins/kanban/kanban-server && pnpm build`
Expected: No compilation errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/github-review.ts
git commit -m "feat(kanban): add Inspector dispatch and output parsing for PR review"
```

---

### Task 3: Backend — Post review to GitHub

**Files:**
- Modify: `kanban-server/src/routes/github-review.ts`

- [ ] **Step 1: Add the postReviewToGitHub function**

Add after `parseInlineComments`:

```typescript
function postReviewToGitHub(
  owner: string, repo: string, number: number, result: ReviewResult
): void {
  if (result.status === "error") return;

  const event = result.verdict === "approve" ? "APPROVE" : "COMMENT";

  // Build the review payload
  const payload: Record<string, unknown> = {
    event,
    body: result.body || "Review complete.",
  };

  // Add inline comments if any
  if (result.comments && result.comments.length > 0) {
    payload.comments = result.comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: "RIGHT",
      body: c.body,
    }));
  }

  // Post via gh api
  execSync(
    `gh api repos/${owner}/${repo}/pulls/${number}/reviews --input -`,
    {
      encoding: "utf-8",
      timeout: 30000,
      input: JSON.stringify(payload),
    }
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/micka/Projects/micka-claude-marketplace/plugins/kanban/kanban-server && pnpm build`
Expected: No compilation errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/github-review.ts
git commit -m "feat(kanban): post PR review to GitHub via gh api"
```

---

### Task 4: Frontend — API function and types

**Files:**
- Modify: `kanban-server/frontend/src/lib/types.ts:134`
- Modify: `kanban-server/frontend/src/lib/api.ts:119`

- [ ] **Step 1: Add ReviewResult type**

At the end of `frontend/src/lib/types.ts` (after line 134, after the closing `}`of `GitHubData`), add:

```typescript
export interface ReviewResult {
  status: "ok" | "error";
  score?: number;
  verdict?: "approve" | "comment";
  body?: string;
  error?: string;
}
```

- [ ] **Step 2: Add reviewPR API function**

At the end of `frontend/src/lib/api.ts` (after line 119, after `fetchGitHub`), add:

```typescript
export async function reviewPR(owner: string, repo: string, number: number): Promise<ReviewResult> {
  return json("/api/github/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, number }),
  });
}
```

Add the import in the existing type import at line 1:

```typescript
import type { Task, BoardResponse, PipelinesFile, AgentInfo, GitInfo, DashboardData, GitHubData, ReviewResult } from "./types.js";
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/micka/Projects/micka-claude-marketplace/plugins/kanban/kanban-server && pnpm build:frontend`

If there is no `build:frontend` script, use: `cd frontend && npx svelte-check`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat(kanban): add reviewPR API function and types"
```

---

### Task 5: Frontend — Review button on PR cards

**Files:**
- Modify: `kanban-server/frontend/src/components/GitHubBoard.svelte`

- [ ] **Step 1: Add review state and handler in the script section**

In `GitHubBoard.svelte`, add these imports and state after the existing imports (after line 7):

```typescript
import { Eye } from "lucide-svelte";
import { reviewPR } from "../lib/api";
import type { ReviewResult } from "../lib/types";
```

After the `pollInterval` declaration (after line 13), add:

```typescript
type ReviewState = { status: "idle" } | { status: "reviewing" } | { status: "done"; score: number; verdict: string } | { status: "error"; error: string };
let reviewStates: Map<string, ReviewState> = $state(new Map());

function prKey(pr: { repo: string; number: number }): string {
  return `${pr.repo}#${pr.number}`;
}

async function startReview(pr: { repo: string; number: number }) {
  const key = prKey(pr);
  reviewStates.set(key, { status: "reviewing" });
  reviewStates = new Map(reviewStates); // trigger reactivity
  try {
    const [owner, repo] = pr.repo.split("/");
    const result: ReviewResult = await reviewPR(owner, repo, pr.number);
    if (result.status === "ok") {
      reviewStates.set(key, { status: "done", score: result.score ?? 0, verdict: result.verdict ?? "comment" });
    } else {
      reviewStates.set(key, { status: "error", error: result.error ?? "Unknown error" });
    }
  } catch (err: unknown) {
    reviewStates.set(key, { status: "error", error: err instanceof Error ? err.message : "Network error" });
  }
  reviewStates = new Map(reviewStates); // trigger reactivity
}
```

- [ ] **Step 2: Add the Review button in the PR card template**

In the template, find the "Needs Review" column's PR card. After the reviewers row (row 5, around line 228), before the closing `</a>`, add the review button. But since the card is an `<a>` tag, we need to place the button and use `event.preventDefault()`.

Replace the entire `<a>` block for PR cards (inside `{#each column.prs as pr}`) with a `<div>` wrapper that separates the link from the button. Find this line (line 172):

```svelte
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                class="block bg-card border border-l-[3px] border-border rounded-lg p-3 hover:bg-secondary/50 transition-colors no-underline"
                style="border-left-color: {overallCiColor(pr.checks)}"
              >
```

Replace the entire `<a>...</a>` block (lines 172-231) with:

```svelte
              <div
                class="bg-card border border-l-[3px] border-border rounded-lg p-3 hover:bg-secondary/50 transition-colors"
                style="border-left-color: {overallCiColor(pr.checks)}"
              >
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block no-underline"
                >
                  <!-- Row 1: CI dot + repo + PR number + draft badge + age -->
                  <div class="flex items-center gap-2 mb-1.5">
                    <span class="text-sm" style="color:{overallCiColor(pr.checks)}">{"\u25CF"}</span>
                    <span class="text-xs text-muted-foreground">{pr.repo}</span>
                    <span class="text-xs" style="color:#58a6ff">#{pr.number}</span>
                    {#if pr.isDraft}
                      <span class="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">DRAFT</span>
                    {/if}
                    <span class="ml-auto text-[11px] text-muted-foreground">{shortAge(pr.createdAt)}</span>
                  </div>
                  <!-- Row 2: Title -->
                  <div class="text-sm font-medium text-foreground mb-1.5 leading-snug">{pr.title}</div>
                  <!-- Row 3: Labels + author + diff + comments -->
                  <div class="flex items-center gap-1.5 flex-wrap mb-1.5">
                    {#each pr.labels as label}
                      <span
                        class="text-[11px] px-2 py-0.5 rounded-full"
                        style="background:#{label.color}22;color:#{label.color}"
                      >{label.name}</span>
                    {/each}
                    {#if column.showAuthor}
                      <span class="text-[11px] text-muted-foreground">@{pr.author}</span>
                    {/if}
                    <span class="text-[11px]">
                      <span style="color:#3fb950">+{pr.additions}</span><span style="color:#f85149">-{pr.deletions}</span>
                    </span>
                    {#if pr.commentCount > 0}
                      <span class="text-[11px] text-muted-foreground">{pr.commentCount} msg</span>
                    {/if}
                  </div>
                  <!-- Row 4: CI checks -->
                  {#if pr.checks.length > 0}
                    <div class="flex items-center gap-1 flex-wrap">
                      {#each pr.checks as check}
                        <span
                          class="text-[10px] px-1.5 py-0.5 rounded"
                          style="background:{ciColor(check.status)}15;color:{ciColor(check.status)}"
                        >{check.name} {ciIcon(check.status)}</span>
                      {/each}
                    </div>
                  {/if}
                  <!-- Row 5: Reviewers -->
                  {#if pr.reviews.length > 0}
                    <div class="flex items-center gap-1 flex-wrap mt-1">
                      {#each pr.reviews as review}
                        <span
                          class="text-[10px] px-1.5 py-0.5 rounded"
                          style="background:{reviewColor(review.state)}15;color:{reviewColor(review.state)}"
                        >@{review.author} {reviewIcon(review.state)}</span>
                      {/each}
                    </div>
                  {/if}
                </a>
                <!-- Row 6: Review button (only in Needs Review column) -->
                {#if column.showAuthor}
                  {@const state = reviewStates.get(prKey(pr)) ?? { status: "idle" }}
                  <div class="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                    {#if state.status === "idle"}
                      <button
                        class="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-border bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
                        onclick={() => startReview(pr)}
                      >
                        <Eye class="w-3 h-3" />
                        Review
                      </button>
                    {:else if state.status === "reviewing"}
                      <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 class="w-3 h-3 animate-spin" />
                        Reviewing...
                      </div>
                    {:else if state.status === "done"}
                      <span
                        class="text-[11px] px-2.5 py-1 rounded-md"
                        style="background:{state.verdict === 'approve' ? '#3fb950' : '#d29922'}22;color:{state.verdict === 'approve' ? '#3fb950' : '#d29922'}"
                      >
                        {state.verdict === "approve" ? "\u2713 Approved" : "\u25CB Comment"} ({state.score}/5)
                      </span>
                    {:else if state.status === "error"}
                      <div class="flex items-center gap-1.5">
                        <span class="text-[11px] text-red-400">\u2717 {state.error}</span>
                        <button
                          class="text-[11px] px-2 py-0.5 rounded border border-border text-foreground hover:bg-secondary/80"
                          onclick={() => startReview(pr)}
                        >Retry</button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
```

- [ ] **Step 3: Build the full project and verify**

Run: `cd /Users/micka/Projects/micka-claude-marketplace/plugins/kanban/kanban-server && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Manual test — open the board**

Open http://localhost:5173, navigate to the GitHub tab. Verify:
- PR cards in "Needs Review" column have a "Review" button
- PR cards in "My PRs" column do NOT have a "Review" button
- Clicking a "Review" button shows "Reviewing..." spinner

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GitHubBoard.svelte
git commit -m "feat(kanban): add Review button on PR cards in GitHub board"
```

---

### Task 6: End-to-end test with a real PR

This task is manual verification — no code changes.

- [ ] **Step 1: Restart the kanban server**

```bash
# Stop existing server
kill $(cat /tmp/kanban-board.pid 2>/dev/null) 2>/dev/null
# Rebuild and start
cd /Users/micka/Projects/micka-claude-marketplace/plugins/kanban/kanban-server
pnpm build
KANBAN_PROJECT_ROOT=/Users/micka/Projects nohup pnpm start > /tmp/kanban-board.log 2>&1 &
echo $! > /tmp/kanban-board.pid
```

- [ ] **Step 2: Open the board and click Review on a PR**

Open http://localhost:5173, go to the GitHub tab.
Click "Review" on any PR in the "Needs Review" column.
Wait for the Inspector to finish (1-3 min).

Expected:
- Button shows "Reviewing..." with spinner
- When done, shows green "Approved (X/5)" or yellow "Comment (X/5)"
- The review appears on the GitHub PR page with:
  - A global comment with the 8-dimension scoring table
  - Inline comments on specific lines (if any violations found)

- [ ] **Step 3: Verify on GitHub**

Go to the PR on GitHub. Verify:
- The review appears with the correct event (APPROVE if score >= 4.0, COMMENT otherwise)
- Inline comments appear on the correct lines
- The scoring table is readable in markdown
