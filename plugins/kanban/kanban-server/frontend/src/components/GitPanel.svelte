<script lang="ts">
  import { GitBranch, GitCommit as GitCommitIcon, ChevronRight, ChevronDown, FileText, Loader2, X, GripVertical } from "lucide-svelte";
  import { cn } from "../lib/cn";
  import { fetchGitInfo, fetchCommitDiff } from "../lib/api";
  import { parseDiff, buildFileTree } from "../lib/diff-parser";
  import { formatDistanceToNow } from "../lib/time";
  import type { GitInfo, GitCommit } from "../lib/types";
  import type { DiffFile, TreeNode } from "../lib/diff-parser";

  let { taskId, onclose }: {
    taskId: number;
    onclose: () => void;
  } = $props();

  let gitInfo: GitInfo | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);
  let selectedFilePath: string | null = $state(null);
  let expandedDirs = $state(new Set<string>());
  let commitsOpen = $state(true);
  let selectedCommitHash: string | null = $state(null);
  let commitLoading = $state(false);
  let commitDiffFiles: DiffFile[] | null = $state(null);
  let commitDiffTree: TreeNode[] | null = $state(null);

  // Resizable tree width
  let treeWidth = $state(260);
  let dragging = $state(false);

  let allFiles = $derived(gitInfo ? parseDiff(gitInfo.diff) : []);
  let allTree = $derived(buildFileTree(allFiles));
  let totalAdditions = $derived(allFiles.reduce((s, f) => s + f.additions, 0));
  let totalDeletions = $derived(allFiles.reduce((s, f) => s + f.deletions, 0));

  let activeFiles = $derived(commitDiffFiles ?? allFiles);
  let activeTree = $derived(commitDiffTree ?? allTree);

  let selectedFile = $derived(
    selectedFilePath ? activeFiles.find(f => f.path === selectedFilePath) ?? null : null
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const info = await fetchGitInfo(taskId);
      if ((info as any).error) { error = (info as any).error; return; }
      gitInfo = info;
    } catch (e) {
      error = "Git info unavailable";
    } finally {
      loading = false;
    }
  }

  async function selectCommit(hash: string) {
    if (selectedCommitHash === hash) {
      selectedCommitHash = null;
      commitDiffFiles = null;
      commitDiffTree = null;
      selectedFilePath = null;
      return;
    }
    selectedCommitHash = hash;
    commitLoading = true;
    selectedFilePath = null;
    try {
      const res = await fetchCommitDiff(taskId, hash);
      commitDiffFiles = parseDiff(res.diff);
      commitDiffTree = buildFileTree(commitDiffFiles);
    } catch {
      commitDiffFiles = [];
      commitDiffTree = [];
    } finally {
      commitLoading = false;
    }
  }

  function showAllChanges() {
    selectedCommitHash = null;
    commitDiffFiles = null;
    commitDiffTree = null;
    selectedFilePath = null;
  }

  function toggleDir(path: string) {
    const next = new Set(expandedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedDirs = next;
  }

  function selectFile(file: DiffFile) {
    selectedFilePath = selectedFilePath === file.path ? null : file.path;
  }

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startW = treeWidth;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      treeWidth = Math.max(120, Math.min(400, startW + delta));
    }
    function onUp() {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  $effect(() => {
    load();
  });

  $effect(() => {
    if (activeTree.length > 0) {
      const next = new Set<string>();
      function walk(nodes: TreeNode[]) {
        for (const n of nodes) {
          if (n.isDir) { next.add(n.path); walk(n.children); }
        }
      }
      walk(activeTree);
      expandedDirs = next;
    }
  });
</script>

{#snippet treeNodes(nodes: TreeNode[], depth: number)}
  {#each nodes as node}
    {#if node.isDir}
      <button
        class="flex items-center gap-1.5 w-full px-2 py-1 text-sm text-foreground hover:bg-secondary transition-colors rounded-sm"
        style="padding-left: {depth * 14 + 8}px"
        onclick={() => toggleDir(node.path)}
      >
        {#if expandedDirs.has(node.path)}
          <ChevronDown class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {:else}
          <ChevronRight class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {/if}
        <span class="truncate">{node.name}</span>
        <span class="ml-auto flex gap-1.5 text-xs">
          {#if node.additions > 0}<span class="text-success">+{node.additions}</span>{/if}
          {#if node.deletions > 0}<span class="text-destructive">-{node.deletions}</span>{/if}
        </span>
      </button>
      {#if expandedDirs.has(node.path)}
        {@render treeNodes(node.children, depth + 1)}
      {/if}
    {:else if node.file}
      <button
        class={cn(
          "flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded-sm transition-colors",
          selectedFilePath === node.file.path ? "bg-primary/15 text-primary" : "text-foreground hover:bg-secondary"
        )}
        style="padding-left: {depth * 14 + 8}px"
        onclick={() => selectFile(node.file!)}
      >
        <FileText class="w-3.5 h-3.5 shrink-0" />
        <span class="truncate">{node.name}</span>
        <span class="ml-auto flex gap-1.5 text-xs">
          {#if node.additions > 0}<span class="text-success">+{node.additions}</span>{/if}
          {#if node.deletions > 0}<span class="text-destructive">-{node.deletions}</span>{/if}
        </span>
      </button>
    {/if}
  {/each}
{/snippet}

<div class="flex flex-col h-full border-l border-border bg-background">
  <!-- Header -->
  <div class="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-card">
    <GitBranch class="w-4 h-4 text-primary shrink-0" />
    {#if gitInfo}
      <span class="text-sm font-mono font-medium text-foreground truncate">{gitInfo.branch}</span>
      <span class="text-xs text-muted-foreground">·</span>
      <span class="text-xs">
        <span class="text-success">+{totalAdditions}</span>
        {" "}
        <span class="text-destructive">-{totalDeletions}</span>
      </span>
    {:else}
      <span class="text-sm text-muted-foreground">Git</span>
    {/if}
    <div class="flex-1"></div>
    {#if selectedCommitHash}
      <button
        class="text-xs px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        onclick={showAllChanges}
      >
        All changes
      </button>
    {/if}
    <button
      class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-secondary transition-colors text-muted-foreground"
      onclick={onclose}
    >
      <X class="w-4 h-4" />
    </button>
  </div>

  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      {error}
    </div>
  {:else}
    <!-- File tree + Diff -->
    <div class="flex-1 flex min-h-0">
      <!-- File tree -->
      <div class="shrink-0 overflow-y-auto bg-background" style="width: {treeWidth}px">
        <div class="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Files
        </div>
        {#if commitLoading}
          <div class="flex items-center justify-center py-4">
            <Loader2 class="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          </div>
        {:else}
          {@render treeNodes(activeTree, 0)}
        {/if}
      </div>

      <!-- Resize handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={cn(
          "w-1 shrink-0 cursor-col-resize group relative hover:bg-primary/30 transition-colors",
          dragging && "bg-primary/40"
        )}
        onmousedown={startDrag}
      >
        <div class="absolute inset-y-0 -left-1 -right-1"></div>
      </div>

      <!-- Diff viewer -->
      <div class="flex-1 overflow-auto min-w-0 bg-background">
        {#if selectedFile}
          <div class="sticky top-0 z-10 px-4 py-2 border-b border-border bg-card flex items-center justify-between">
            <span class="text-sm font-mono text-foreground truncate">{selectedFile.path}</span>
            <span class="text-xs shrink-0 ml-2">
              <span class="text-success">+{selectedFile.additions}</span>
              {" "}
              <span class="text-destructive">-{selectedFile.deletions}</span>
            </span>
          </div>
          <div class="font-mono text-xs leading-5">
            {#each selectedFile.hunks as hunk}
              <div class="px-4 py-1 bg-secondary/50 text-muted-foreground text-xs border-b border-border/50">
                {hunk.header}
              </div>
              {#each hunk.lines as line}
                <div class={cn(
                  "flex",
                  line.type === "add" && "bg-success/8",
                  line.type === "del" && "bg-destructive/8"
                )}>
                  <span class="w-12 shrink-0 text-right pr-1.5 text-xs text-muted-foreground/40 select-none leading-5 border-r border-border/20">
                    {line.oldNum ?? ""}
                  </span>
                  <span class="w-12 shrink-0 text-right pr-1.5 text-xs text-muted-foreground/40 select-none leading-5 border-r border-border/20">
                    {line.newNum ?? ""}
                  </span>
                  <span class={cn(
                    "w-5 shrink-0 text-center select-none leading-5",
                    line.type === "add" ? "text-success/70" : line.type === "del" ? "text-destructive/70" : "text-transparent"
                  )}>
                    {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                  </span>
                  <pre class="flex-1 whitespace-pre-wrap break-all pr-3 leading-5 text-foreground/90">{line.content}</pre>
                </div>
              {/each}
            {/each}
          </div>
        {:else}
          <div class="flex items-center justify-center h-full text-xs text-muted-foreground">
            Select a file to view diff
          </div>
        {/if}
      </div>
    </div>

    <!-- Commits -->
    {#if gitInfo && gitInfo.commits.length > 0}
      <div class="border-t border-border">
        <button
          class="flex items-center gap-2 w-full px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
          onclick={() => commitsOpen = !commitsOpen}
        >
          {#if commitsOpen}
            <ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
          {:else}
            <ChevronRight class="w-3.5 h-3.5 text-muted-foreground" />
          {/if}
          Commits
          <span class="text-xs text-muted-foreground">({gitInfo.commits.length})</span>
        </button>
        {#if commitsOpen}
          <div class="max-h-48 overflow-y-auto border-t border-border/50">
            {#each gitInfo.commits as commit}
              <button
                class={cn(
                  "flex items-center gap-2.5 w-full px-4 py-2 text-sm text-foreground hover:bg-secondary/50 transition-colors",
                  selectedCommitHash === commit.hash && "bg-primary/10 text-primary"
                )}
                onclick={() => selectCommit(commit.hash)}
              >
                <GitCommitIcon class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <code class="text-xs text-primary/70 shrink-0">{commit.short}</code>
                <span class="truncate">{commit.message}</span>
                <span class="ml-auto text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(commit.date)}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
