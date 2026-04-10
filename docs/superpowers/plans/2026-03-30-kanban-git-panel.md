# Kanban Git Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable Git panel to the kanban ticket sheet showing branch info, commits, file tree of changed files, and unified diff with syntax highlighting.

**Architecture:** Backend endpoint extracts repo path from the Resolver block, runs git commands, returns structured JSON (branch, commits, file tree, diffs). Frontend adds a GitPanel component rendered alongside the block detail panel, toggled via a button in the ticket header. Clicking a commit filters the tree/diff to that commit only.

**Tech Stack:** Hono backend, Svelte 5 frontend, Tailwind CSS, git CLI

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/routes/git.ts` | Backend git API endpoint |
| Modify | `src/routes/tasks.ts` | Import and mount git routes |
| Create | `frontend/src/lib/diff-parser.ts` | Parse unified diff into structured data |
| Create | `frontend/src/components/GitPanel.svelte` | Main git panel (tree + diff + commits) |
| Modify | `frontend/src/lib/api.ts` | Add `fetchGitInfo()` API call |
| Modify | `frontend/src/lib/types.ts` | Add git-related types |
| Modify | `frontend/src/components/TicketSheet.svelte` | Toggle button + render GitPanel alongside detail |

---

### Task 1: Backend Git API

**Files:**
- Create: `plugins/kanban/kanban-server/src/routes/git.ts`
- Modify: `plugins/kanban/kanban-server/src/routes/tasks.ts` (mount route)

- [ ] **Step 1: Create `src/routes/git.ts`**

```typescript
import { Hono } from "hono";
import { execSync } from "child_process";
import type { Task, Block } from "../types.js";
import { getDb } from "../db.js";

const app = new Hono();

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function extractRepoPath(task: Task): string | null {
  const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
  const resolver = blocks.find((b) => b.agent === "Resolver" && b.verdict === "ok");
  if (!resolver) return null;
  const m = resolver.content.match(/Repository:\s*`([^`]+)`/);
  return m ? m[1] : null;
}

// GET /api/task/:id/git
app.get("/api/task/:id/git", (c) => {
  const id = parseInt(c.req.param("id"));
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const repoPath = extractRepoPath(task);
  if (!repoPath) return c.json({ error: "No repo found" }, 404);

  const branch = git("rev-parse --abbrev-ref HEAD", repoPath);
  if (!branch) return c.json({ error: "Not a git repo" }, 500);

  // Find merge base with main/master
  const mainBranch = git("rev-parse --verify main", repoPath) ? "main" : "master";
  const mergeBase = git(`merge-base ${mainBranch} HEAD`, repoPath);

  // Commits since merge base
  const commitLog = git(
    mergeBase
      ? `log ${mergeBase}..HEAD --format=%H%n%h%n%s%n%aI%n%an --reverse`
      : "log -20 --format=%H%n%h%n%s%n%aI%n%an --reverse",
    repoPath
  );
  const commits: { hash: string; short: string; message: string; date: string; author: string }[] = [];
  if (commitLog) {
    const lines = commitLog.split("\n");
    for (let i = 0; i + 4 < lines.length; i += 5) {
      commits.push({
        hash: lines[i],
        short: lines[i + 1],
        message: lines[i + 2],
        date: lines[i + 3],
        author: lines[i + 4],
      });
    }
  }

  // Full diff against merge base (or last 20 commits)
  const diff = git(
    mergeBase ? `diff ${mergeBase}..HEAD` : "diff HEAD~20..HEAD",
    repoPath
  );

  return c.json({ branch, commits, diff });
});

// GET /api/task/:id/git/commit/:hash
app.get("/api/task/:id/git/commit/:hash", (c) => {
  const id = parseInt(c.req.param("id"));
  const hash = c.req.param("hash");
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const repoPath = extractRepoPath(task);
  if (!repoPath) return c.json({ error: "No repo found" }, 404);

  const diff = git(`diff ${hash}~1..${hash}`, repoPath);
  return c.json({ diff });
});

export default app;
```

- [ ] **Step 2: Mount in tasks.ts**

In `src/routes/tasks.ts`, add at the top with other imports:
```typescript
import gitRoutes from "./git.js";
```

And after the existing routes (before the export), add:
```typescript
app.route("", gitRoutes);
```

- [ ] **Step 3: Verify endpoint works**

```bash
curl -s http://localhost:5173/api/task/1/git | head -c 200
```

Expected: JSON with `branch`, `commits`, `diff` fields (or `error` if no Resolver block).

- [ ] **Step 4: Commit**

```bash
git add plugins/kanban/kanban-server/src/routes/git.ts plugins/kanban/kanban-server/src/routes/tasks.ts
git commit -m "feat(kanban): add git info API endpoint"
```

---

### Task 2: Frontend Types and API

**Files:**
- Modify: `plugins/kanban/kanban-server/frontend/src/lib/types.ts`
- Modify: `plugins/kanban/kanban-server/frontend/src/lib/api.ts`

- [ ] **Step 1: Add types to `types.ts`**

Append to the file:

```typescript
export interface GitCommit {
  hash: string;
  short: string;
  message: string;
  date: string;
  author: string;
}

export interface GitInfo {
  branch: string;
  commits: GitCommit[];
  diff: string;
}
```

- [ ] **Step 2: Add API functions to `api.ts`**

Append to the file:

```typescript
import type { ..., GitInfo } from "./types.js";

export async function fetchGitInfo(taskId: number): Promise<GitInfo> {
  return json(`/api/task/${taskId}/git`);
}

export async function fetchCommitDiff(taskId: number, hash: string): Promise<{ diff: string }> {
  return json(`/api/task/${taskId}/git/commit/${hash}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add plugins/kanban/kanban-server/frontend/src/lib/types.ts plugins/kanban/kanban-server/frontend/src/lib/api.ts
git commit -m "feat(kanban): add git types and API client functions"
```

---

### Task 3: Diff Parser

**Files:**
- Create: `plugins/kanban/kanban-server/frontend/src/lib/diff-parser.ts`

- [ ] **Step 1: Create diff parser**

```typescript
export interface DiffHunk {
  header: string;
  lines: { type: "add" | "del" | "ctx"; content: string; oldNum: number | null; newNum: number | null }[];
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export function parseDiff(raw: string): DiffFile[] {
  if (!raw) return [];
  const files: DiffFile[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    // Extract file path from "a/path b/path"
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const path = headerMatch[2];
    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldNum = 0;
    let newNum = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        if (match) {
          oldNum = parseInt(match[1]);
          newNum = parseInt(match[2]);
          currentHunk = { header: line, lines: [] };
          hunks.push(currentHunk);
        }
        continue;
      }

      if (!currentHunk) continue;
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"

      if (line.startsWith("+")) {
        additions++;
        currentHunk.lines.push({ type: "add", content: line.slice(1), oldNum: null, newNum: newNum++ });
      } else if (line.startsWith("-")) {
        deletions++;
        currentHunk.lines.push({ type: "del", content: line.slice(1), oldNum: oldNum++, newNum: null });
      } else {
        currentHunk.lines.push({ type: "ctx", content: line.slice(1), oldNum: oldNum++, newNum: newNum++ });
      }
    }

    files.push({ path, additions, deletions, hunks });
  }

  return files;
}

/** Build a tree structure from flat file paths */
export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: DiffFile;
  additions: number;
  deletions: number;
}

export function buildFileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const existing = current.find((n) => n.name === name);

      if (existing) {
        if (isLast) {
          existing.file = file;
          existing.additions += file.additions;
          existing.deletions += file.deletions;
        } else {
          current = existing.children;
          existing.additions += file.additions;
          existing.deletions += file.deletions;
        }
      } else {
        const node: TreeNode = {
          name,
          path: parts.slice(0, i + 1).join("/"),
          isDir: !isLast,
          children: [],
          file: isLast ? file : undefined,
          additions: file.additions,
          deletions: file.deletions,
        };
        current.push(node);
        if (!isLast) current = node.children;
      }
    }
  }

  // Sort: dirs first, then alphabetical
  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children.length) sort(n.children);
  }
  sort(root);

  return root;
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/kanban/kanban-server/frontend/src/lib/diff-parser.ts
git commit -m "feat(kanban): add unified diff parser with file tree builder"
```

---

### Task 4: GitPanel Component

**Files:**
- Create: `plugins/kanban/kanban-server/frontend/src/components/GitPanel.svelte`

- [ ] **Step 1: Create the GitPanel component**

The component receives `taskId` as prop, fetches git info, and renders three sections:
- Header bar with branch name
- Split view: file tree (left) + diff viewer (right)
- Commit list (bottom, collapsible)

On commit click: fetch that commit's diff, replace tree and diff view. Click again or "All changes" button to reset.

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { ChevronRight, ChevronDown, GitBranch, GitCommit as GitCommitIcon, FileText, Loader2, X } from "lucide-svelte";
  import { cn } from "../lib/cn";
  import { fetchGitInfo, fetchCommitDiff } from "../lib/api";
  import { parseDiff, buildFileTree, type DiffFile, type TreeNode } from "../lib/diff-parser";
  import { formatDistanceToNow } from "../lib/time";
  import type { GitCommit } from "../lib/types";

  let { taskId, onclose }: { taskId: number; onclose: () => void } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let branch = $state("");
  let commits = $state<GitCommit[]>([]);
  let allFiles = $state<DiffFile[]>([]);
  let displayFiles = $state<DiffFile[]>([]);
  let selectedFile = $state<DiffFile | null>(null);
  let selectedCommit = $state<string | null>(null);
  let collapsedDirs = $state<Set<string>>(new Set());
  let commitsExpanded = $state(true);
  let loadingCommit = $state(false);

  let tree = $derived(buildFileTree(displayFiles));

  onMount(async () => {
    try {
      const info = await fetchGitInfo(taskId);
      if ((info as any).error) { error = (info as any).error; return; }
      branch = info.branch;
      commits = info.commits;
      allFiles = parseDiff(info.diff);
      displayFiles = allFiles;
      if (allFiles.length > 0) selectedFile = allFiles[0];
    } catch (e: any) {
      error = e.message || "Failed to load git info";
    } finally {
      loading = false;
    }
  });

  async function selectCommit(hash: string) {
    if (selectedCommit === hash) {
      // Deselect: back to all changes
      selectedCommit = null;
      displayFiles = allFiles;
      selectedFile = allFiles[0] ?? null;
      return;
    }
    selectedCommit = hash;
    loadingCommit = true;
    try {
      const res = await fetchCommitDiff(taskId, hash);
      displayFiles = parseDiff(res.diff);
      selectedFile = displayFiles[0] ?? null;
    } catch {
      displayFiles = [];
      selectedFile = null;
    } finally {
      loadingCommit = false;
    }
  }

  function toggleDir(path: string) {
    const next = new Set(collapsedDirs);
    if (next.has(path)) next.delete(path); else next.add(path);
    collapsedDirs = next;
  }

  function totalStats(files: DiffFile[]) {
    let a = 0, d = 0;
    for (const f of files) { a += f.additions; d += f.deletions; }
    return { a, d };
  }
</script>

<div class="flex flex-col h-full border-l bg-background">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b bg-card shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <GitBranch class="w-3.5 h-3.5 text-primary shrink-0" />
      <span class="text-xs font-mono font-medium truncate">{branch}</span>
      {@const stats = totalStats(displayFiles)}
      <span class="text-[10px] text-success">+{stats.a}</span>
      <span class="text-[10px] text-destructive">-{stats.d}</span>
      {#if selectedCommit}
        <button
          class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
          onclick={() => selectCommit(selectedCommit!)}
        >All changes</button>
      {/if}
    </div>
    <button class="w-6 h-6 rounded flex items-center justify-center hover:bg-secondary" onclick={onclose}>
      <X class="w-3.5 h-3.5" />
    </button>
  </div>

  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center p-4">
      <p class="text-sm text-muted-foreground">{error}</p>
    </div>
  {:else}
    <!-- Main: tree + diff -->
    <div class="flex-1 flex min-h-0">
      <!-- File tree -->
      <div class="w-56 shrink-0 border-r overflow-y-auto p-2">
        {#snippet renderTree(nodes: TreeNode[], depth: number)}
          {#each nodes as node}
            {#if node.isDir}
              <button
                class="w-full flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-secondary/50 rounded"
                style="padding-left: {depth * 12 + 4}px"
                onclick={() => toggleDir(node.path)}
              >
                {#if collapsedDirs.has(node.path)}
                  <ChevronRight class="w-3 h-3 text-muted-foreground shrink-0" />
                {:else}
                  <ChevronDown class="w-3 h-3 text-muted-foreground shrink-0" />
                {/if}
                <span class="truncate text-muted-foreground">{node.name}</span>
              </button>
              {#if !collapsedDirs.has(node.path)}
                {@render renderTree(node.children, depth + 1)}
              {/if}
            {:else}
              <button
                class={cn(
                  "w-full flex items-center gap-1.5 px-1 py-0.5 text-xs rounded",
                  selectedFile?.path === node.file?.path ? "bg-primary/10 text-primary" : "hover:bg-secondary/50"
                )}
                style="padding-left: {depth * 12 + 4}px"
                onclick={() => { if (node.file) selectedFile = node.file; }}
              >
                <FileText class="w-3 h-3 shrink-0" />
                <span class="truncate flex-1 text-left">{node.name}</span>
                <span class="text-[9px] text-success shrink-0">+{node.additions}</span>
                <span class="text-[9px] text-destructive shrink-0">-{node.deletions}</span>
              </button>
            {/if}
          {/each}
        {/snippet}
        {@render renderTree(tree, 0)}
      </div>

      <!-- Diff viewer -->
      <div class="flex-1 overflow-auto min-w-0">
        {#if loadingCommit}
          <div class="flex items-center justify-center h-full">
            <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        {:else if selectedFile}
          <div class="text-xs font-mono">
            <!-- File header -->
            <div class="sticky top-0 z-10 px-3 py-1.5 bg-card border-b text-muted-foreground font-medium flex items-center justify-between">
              <span>{selectedFile.path}</span>
              <span>
                <span class="text-success">+{selectedFile.additions}</span>
                <span class="text-destructive ml-1">-{selectedFile.deletions}</span>
              </span>
            </div>
            <!-- Hunks -->
            {#each selectedFile.hunks as hunk}
              <div class="px-3 py-1 bg-primary/5 text-primary/70 text-[10px] border-b border-border/50">{hunk.header}</div>
              {#each hunk.lines as line}
                <div class={cn(
                  "flex text-[11px] leading-5 border-b border-transparent",
                  line.type === "add" && "bg-success/10",
                  line.type === "del" && "bg-destructive/10"
                )}>
                  <span class="w-10 shrink-0 text-right pr-1 text-muted-foreground/50 select-none border-r border-border/30">
                    {line.oldNum ?? ""}
                  </span>
                  <span class="w-10 shrink-0 text-right pr-1 text-muted-foreground/50 select-none border-r border-border/30">
                    {line.newNum ?? ""}
                  </span>
                  <span class="w-4 shrink-0 text-center select-none {line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-destructive' : 'text-transparent'}">
                    {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                  </span>
                  <pre class="flex-1 whitespace-pre-wrap break-all pr-2">{line.content}</pre>
                </div>
              {/each}
            {/each}
          </div>
        {:else}
          <div class="flex items-center justify-center h-full text-sm text-muted-foreground">No file selected</div>
        {/if}
      </div>
    </div>

    <!-- Commits (bottom) -->
    <div class="border-t shrink-0">
      <button
        class="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-secondary/50"
        onclick={() => (commitsExpanded = !commitsExpanded)}
      >
        {#if commitsExpanded}
          <ChevronDown class="w-3 h-3" />
        {:else}
          <ChevronRight class="w-3 h-3" />
        {/if}
        Commits ({commits.length})
      </button>
      {#if commitsExpanded}
        <div class="max-h-40 overflow-y-auto">
          {#each commits as commit}
            <button
              class={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-secondary/50 border-t border-border/30",
                selectedCommit === commit.hash && "bg-primary/10"
              )}
              onclick={() => selectCommit(commit.hash)}
            >
              <GitCommitIcon class="w-3 h-3 text-muted-foreground shrink-0" />
              <code class="text-[10px] text-primary/70 shrink-0">{commit.short}</code>
              <span class="truncate flex-1">{commit.message}</span>
              <span class="text-[10px] text-muted-foreground shrink-0">{formatDistanceToNow(commit.date)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add plugins/kanban/kanban-server/frontend/src/components/GitPanel.svelte
git commit -m "feat(kanban): add GitPanel component with file tree, diff viewer, commits"
```

---

### Task 5: Integrate GitPanel into TicketSheet

**Files:**
- Modify: `plugins/kanban/kanban-server/frontend/src/components/TicketSheet.svelte`

- [ ] **Step 1: Add imports and state**

At the top of the `<script>` block, add the import:

```typescript
import GitPanel from "./GitPanel.svelte";
```

Add state variable after the existing state declarations (around line 26):

```typescript
let gitPanelOpen = $state(false);
```

- [ ] **Step 2: Add Git toggle button in the header actions area**

In the header actions section (around line 185, the `<div class="flex items-center gap-2 mt-4">` block), add a Git toggle button after the Run/Stop Pipeline buttons:

```svelte
<button
  class={cn(
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors",
    gitPanelOpen ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
  )}
  onclick={() => (gitPanelOpen = !gitPanelOpen)}
>
  Git
</button>
```

- [ ] **Step 3: Widen the sheet when git panel is open**

Update the sheet width classes (line 96-99). Replace the width logic:

```svelte
<div class={cn(
  "fixed inset-y-0 right-0 z-50 flex flex-col bg-background border-l shadow-xl animate-slide-in transition-[max-width] duration-200",
  gitPanelOpen ? "w-full max-w-[100vw]" : hasDetailOpen ? "w-full max-w-6xl" : "w-full sm:max-w-xl md:max-w-2xl"
)}>
```

- [ ] **Step 4: Wrap the main content area to include git panel**

The main content area (line 206, `<div class="flex-1 flex min-h-0">`) needs to be wrapped so GitPanel renders alongside it. Replace the outer structure:

Change the main content `div` at line 206 from:

```svelte
<div class="flex-1 flex min-h-0">
```

To wrap with a parent that includes the git panel:

```svelte
<div class="flex-1 flex min-h-0">
  <div class={cn("flex-1 flex min-h-0", gitPanelOpen && "w-1/2")}>
```

And after the closing `</div>` of the main content area (the `</div>` that closes the flex containing blocks list + detail panel, around line 495), add:

```svelte
  </div>
  {#if gitPanelOpen && task}
    <div class="w-1/2 min-h-0">
      <GitPanel taskId={task.id} onclose={() => (gitPanelOpen = false)} />
    </div>
  {/if}
</div>
```

Note: This means the original `<div class="flex-1 flex min-h-0">` becomes two nested divs — the outer one is the full width flex container, the inner one (blocks + detail) gets `w-1/2` when git is open, and the GitPanel takes the other half.

- [ ] **Step 5: Verify in browser**

Open http://localhost:5174, open a ticket with Resolver block, click "Git" button. Should see:
- Branch name + stats in header
- File tree on left, diff on right
- Commits list at bottom
- Clicking commit filters view, clicking again returns to all

- [ ] **Step 6: Commit**

```bash
git add plugins/kanban/kanban-server/frontend/src/components/TicketSheet.svelte
git commit -m "feat(kanban): integrate git panel toggle in ticket sheet"
```

---

### Task 6: Add Vite proxy for new endpoint

**Files:**
- Modify: `plugins/kanban/kanban-server/frontend/vite.config.ts`

- [ ] **Step 1: Verify proxy already covers `/api`**

The existing proxy config already proxies all `/api` routes to the backend. The new `/api/task/:id/git` endpoint is already covered. No changes needed.

Mark as done — this task exists only as a verification step.

---
