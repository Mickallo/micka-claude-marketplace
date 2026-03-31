<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Loader2, RefreshCw } from "lucide-svelte";
  import { fetchGitHub } from "../lib/api";
  import type { GitHubData, GitHubPR } from "../lib/types";
  import { cn } from "../lib/cn";
  import { formatDistanceToNow } from "../lib/time";

  let data: GitHubData | null = $state(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function ciColor(status: string | null | undefined): string {
    if (!status) return "#d29922";
    const s = status.toUpperCase();
    if (s === "SUCCESS") return "#3fb950";
    if (s === "FAILURE" || s === "ERROR") return "#f85149";
    return "#d29922";
  }

  function ciIcon(status: string | null | undefined): string {
    if (!status) return "\u231B";
    const s = status.toUpperCase();
    if (s === "SUCCESS") return "\u2713";
    if (s === "FAILURE" || s === "ERROR") return "\u2717";
    return "\u231B";
  }

  function reviewColor(state: string): string {
    const s = state.toUpperCase();
    if (s === "APPROVED") return "#3fb950";
    if (s === "CHANGES_REQUESTED") return "#f85149";
    return "#d29922";
  }

  function reviewIcon(state: string): string {
    const s = state.toUpperCase();
    if (s === "APPROVED") return "\u2713";
    if (s === "CHANGES_REQUESTED") return "changes";
    return "\u25CB";
  }

  function overallCiColor(checks: { name: string; status: string }[]): string {
    if (checks.length === 0) return "#d29922";
    const hasFailure = checks.some(c => {
      const s = (c.status || "").toUpperCase();
      return s === "FAILURE" || s === "ERROR";
    });
    if (hasFailure) return "#f85149";
    const allPass = checks.every(c => (c.status || "").toUpperCase() === "SUCCESS");
    if (allPass) return "#3fb950";
    return "#d29922";
  }

  function shortAge(dateStr: string): string {
    const ms = Date.now() - new Date(dateStr.includes("T") ? dateStr : dateStr + "Z").getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "<1m";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  async function loadData(force = false) {
    if (force) refreshing = true;
    else loading = true;
    try {
      data = await fetchGitHub(force || undefined);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  onMount(() => {
    loadData();
    pollInterval = setInterval(() => loadData(), 120_000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="p-6 space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" class="text-foreground">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      <span class="text-base font-semibold text-foreground">GitHub</span>
      {#if data}
        <span class="text-xs text-muted-foreground ml-2">Last sync: {formatDistanceToNow(data.lastSync)}</span>
      {/if}
    </div>
    <button
      class={cn(
        "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-secondary text-foreground hover:bg-secondary/80 transition-colors",
        refreshing && "opacity-70 pointer-events-none"
      )}
      onclick={() => loadData(true)}
    >
      <RefreshCw class={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
      Refresh
    </button>
  </div>

  {#if loading && !data}
    <div class="flex items-center justify-center py-24">
      <Loader2 class="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  {:else if data}
    <!-- KPI Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#f0883e">{data.stats.reviewCount}</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">To Review</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#a371f7">{data.stats.assignedCount}</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Assigned</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#58a6ff">{data.stats.authoredCount}</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">My PRs</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#3fb950">{Math.round(data.stats.ciPassRate * 100)}%</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">CI Pass</div>
      </div>
    </div>

    <!-- 3-Column Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      {#each [
        { title: "Needs Review", color: "#f0883e", prs: data.review, showAuthor: true },
        { title: "Assigned", color: "#a371f7", prs: data.assigned, showAuthor: true },
        { title: "My PRs", color: "#58a6ff", prs: data.authored, showAuthor: false },
      ] as column}
        <div>
          <div
            class="text-xs font-semibold mb-2 px-2.5 py-1.5"
            style="color:{column.color};border-bottom:2px solid {column.color}"
          >
            {column.title} ({column.prs.length})
          </div>
          <div class="flex flex-col gap-1.5">
            {#each column.prs as pr}
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                class="block bg-card border border-border rounded-lg p-2.5 hover:bg-secondary/50 transition-colors no-underline"
              >
                <!-- Row 1: CI dot + repo + PR number + draft badge + age -->
                <div class="flex items-center gap-1.5 mb-1">
                  <span class="text-xs" style="color:{overallCiColor(pr.checks)}">{"\u25CF"}</span>
                  <span class="text-[9px] text-muted-foreground">{pr.repo}</span>
                  <span class="text-[9px]" style="color:#58a6ff">#{pr.number}</span>
                  {#if pr.isDraft}
                    <span class="text-[7px] bg-secondary text-muted-foreground px-1.5 py-px rounded-full">DRAFT</span>
                  {/if}
                  <span class="ml-auto text-[8px] text-muted-foreground">{shortAge(pr.createdAt)}</span>
                </div>
                <!-- Row 2: Title -->
                <div class="text-[11px] font-medium text-foreground mb-1 leading-tight">{pr.title}</div>
                <!-- Row 3: Labels + author + diff + comments -->
                <div class="flex items-center gap-1 flex-wrap mb-1">
                  {#each pr.labels as label}
                    <span
                      class="text-[8px] px-1.5 py-px rounded-full"
                      style="background:#{label.color}22;color:#{label.color}"
                    >{label.name}</span>
                  {/each}
                  {#if column.showAuthor}
                    <span class="text-[8px] text-muted-foreground">@{pr.author}</span>
                  {/if}
                  <span class="text-[8px]">
                    <span style="color:#3fb950">+{pr.additions}</span><span style="color:#f85149">-{pr.deletions}</span>
                  </span>
                  {#if pr.commentCount > 0}
                    <span class="text-[8px] text-muted-foreground">{pr.commentCount} msg</span>
                  {/if}
                </div>
                <!-- Row 4: CI checks -->
                {#if pr.checks.length > 0}
                  <div class="flex items-center gap-1 flex-wrap">
                    {#each pr.checks as check}
                      <span
                        class="text-[7px] px-1 py-px rounded"
                        style="background:{ciColor(check.status)}15;color:{ciColor(check.status)}"
                      >{check.name} {ciIcon(check.status)}</span>
                    {/each}
                  </div>
                {/if}
                <!-- Row 5: Reviewers -->
                {#if pr.reviews.length > 0}
                  <div class="flex items-center gap-1 flex-wrap mt-0.5">
                    {#each pr.reviews as review}
                      <span
                        class="text-[7px] px-1 py-px rounded"
                        style="background:{reviewColor(review.state)}15;color:{reviewColor(review.state)}"
                      >@{review.author} {reviewIcon(review.state)}</span>
                    {/each}
                  </div>
                {/if}
              </a>
            {/each}
            {#if column.prs.length === 0}
              <div class="text-xs text-muted-foreground text-center py-6">No PRs</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
