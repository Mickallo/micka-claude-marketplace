<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Loader2, RefreshCw } from "lucide-svelte";
  import { fetchGitHub } from "../lib/api";
  import type { GitHubData, GitHubPR } from "../lib/types";
  import { cn } from "../lib/cn";
  import { formatDistanceToNow } from "../lib/time";
  import { Eye } from "lucide-svelte";
  import { reviewPR } from "../lib/api";
  import type { ReviewResult } from "../lib/types";

  let data: GitHubData | null = $state(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let reviewAuthorTab: string | null = $state(null);
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  type ReviewState = { status: "idle" } | { status: "reviewing" } | { status: "done"; score: number; verdict: string } | { status: "error"; error: string };
  let reviewStates: Map<string, ReviewState> = $state(new Map());

  function prKey(pr: { repo: string; number: number }): string {
    return `${pr.repo}#${pr.number}`;
  }

  async function startReview(pr: { repo: string; number: number }) {
    const key = prKey(pr);
    reviewStates.set(key, { status: "reviewing" });
    reviewStates = new Map(reviewStates);
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
    reviewStates = new Map(reviewStates);
  }

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

  function groupByAuthor(prs: GitHubPR[]): { author: string; prs: GitHubPR[] }[] {
    const sorted = [...prs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const groups = new Map<string, GitHubPR[]>();
    for (const pr of sorted) {
      const list = groups.get(pr.author) ?? [];
      list.push(pr);
      groups.set(pr.author, list);
    }
    // Sort groups by most recent PR in each group (descending)
    return [...groups.entries()]
      .sort((a, b) => new Date(b[1][0].createdAt).getTime() - new Date(a[1][0].createdAt).getTime())
      .map(([author, prs]) => ({ author, prs }));
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
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#f0883e">{data.stats.reviewCount}</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">To Review</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#58a6ff">{allMyPrs.length}</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Mine</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-3.5 text-center">
        <div class="text-2xl font-bold font-mono" style="color:#3fb950">{Math.round(data.stats.ciPassRate * 100)}%</div>
        <div class="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">CI Pass</div>
      </div>
    </div>

    <!-- All PRs — single column with author tabs -->
    {@const allMyPrs = [...data.authored, ...data.assigned]}
    {@const meGroup = { author: "me", prs: [...allMyPrs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }}
    {@const reviewGroups = groupByAuthor(data.review)}
    {@const allGroups = [meGroup, ...reviewGroups]}
    {@const activeAuthor = reviewAuthorTab ?? allGroups[0]?.author ?? null}
    {@const allActivePrs = allGroups.find(g => g.author === activeAuthor)?.prs ?? []}
    {@const activePrs = allActivePrs.filter(pr => !pr.isDraft)}
    {@const activeDrafts = allActivePrs.filter(pr => pr.isDraft)}
    <div>
      <div>
        <div class="flex gap-0 mb-2 overflow-x-auto" style="border-bottom:2px solid #30363d">
          {#each allGroups as group}
            <button
              class="text-xs font-semibold px-2.5 py-1.5 transition-colors whitespace-nowrap"
              style={activeAuthor === group.author ? `color:${group.author === "me" ? "#58a6ff" : "#f0883e"};border-bottom:2px solid ${group.author === "me" ? "#58a6ff" : "#f0883e"};margin-bottom:-2px` : "color:#8b949e"}
              onclick={() => reviewAuthorTab = group.author}
            >
              @{group.author} ({group.prs.length})
            </button>
          {/each}
        </div>
        <div class="flex flex-col gap-1.5">
          {#each [
            { label: null, items: activePrs },
            { label: "Drafts", items: activeDrafts },
          ] as section}
            {#if section.items.length > 0}
              {#if section.label}
                <div class="text-[10px] text-muted-foreground uppercase tracking-wider mt-3 mb-1 px-1">{section.label}</div>
              {/if}
              {#each section.items as pr}
                {@const state = reviewStates.get(prKey(pr)) ?? { status: "idle" }}
                <div
                  class="bg-card border border-l-[3px] border-border rounded-lg p-3 hover:bg-secondary/50 transition-colors"
                  style="border-left-color: {overallCiColor(pr.checks)}"
                >
                  <a href={pr.url} target="_blank" rel="noopener noreferrer" class="block no-underline">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="text-sm" style="color:{overallCiColor(pr.checks)}">{"\u25CF"}</span>
                      <span class="text-xs text-muted-foreground">{pr.repo}</span>
                      <span class="text-xs" style="color:#58a6ff">#{pr.number}</span>
                      {#if pr.isDraft}
                        <span class="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">DRAFT</span>
                      {/if}
                      <span class="ml-auto text-[11px] text-muted-foreground">{shortAge(pr.createdAt)}</span>
                    </div>
                    <div class="text-sm font-medium text-foreground mb-1.5 leading-snug">{pr.title}</div>
                    <div class="flex items-center gap-1.5 flex-wrap mb-1.5">
                      {#each pr.labels as label}
                        <span class="text-[11px] px-2 py-0.5 rounded-full" style="background:#{label.color}22;color:#{label.color}">{label.name}</span>
                      {/each}
                      <span class="text-[11px]">
                        <span style="color:#3fb950">+{pr.additions}</span><span style="color:#f85149">-{pr.deletions}</span>
                      </span>
                      {#if pr.commentCount > 0}
                        <span class="text-[11px] text-muted-foreground">{pr.commentCount} msg</span>
                      {/if}
                    </div>
                    {#if pr.checks.length > 0}
                      <div class="flex items-center gap-1 flex-wrap">
                        {#each pr.checks as check}
                          <span class="text-[10px] px-1.5 py-0.5 rounded" style="background:{ciColor(check.status)}15;color:{ciColor(check.status)}">{check.name} {ciIcon(check.status)}</span>
                        {/each}
                      </div>
                    {/if}
                    {#if pr.reviews.length > 0}
                      <div class="flex items-center gap-1 flex-wrap mt-1">
                        {#each pr.reviews as review}
                          <span class="text-[10px] px-1.5 py-0.5 rounded" style="background:{reviewColor(review.state)}15;color:{reviewColor(review.state)}">@{review.author} {reviewIcon(review.state)}</span>
                        {/each}
                      </div>
                    {/if}
                  </a>
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
                        <span class="text-[11px] text-red-400">{"\u2717"} {state.error}</span>
                        <button
                          class="text-[11px] px-2 py-0.5 rounded border border-border text-foreground hover:bg-secondary/80"
                          onclick={() => startReview(pr)}
                        >Retry</button>
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          {/each}
          {#if allActivePrs.length === 0}
            <div class="text-xs text-muted-foreground text-center py-6">No PRs</div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
