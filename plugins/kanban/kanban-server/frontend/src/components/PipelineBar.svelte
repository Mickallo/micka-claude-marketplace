<script lang="ts">
  import { ArrowRight, Sparkles, CheckCircle } from "lucide-svelte";
  import { getAgentColor } from "../lib/agents";

  let { columnOrder, stats }: {
    columnOrder: string[];
    stats: { total: number; processing: number; needsInput: number; completed: number };
  } = $props();
</script>

<!-- Exact v0 structure: border-b bg-card/50 -->
<div class="border-b bg-card/50">
  <!-- Pipeline vis: gap-2 py-4 px-6 — exact v0 -->
  <div class="flex items-center justify-center gap-2 py-4 px-6 overflow-x-auto">
    <!-- Queue icon: w-10 h-10 rounded-lg bg-muted — exact v0 -->
    <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground">
      <Sparkles class="w-5 h-5" />
    </div>
    <span class="text-sm text-muted-foreground mx-2">Queue</span>

    {#each columnOrder as col}
      {#if col !== "todo" && col !== "done"}
        {@const color = getAgentColor(col)}
        <div class="flex items-center">
          <!-- ArrowRight mx-2 — exact v0 -->
          <ArrowRight class="w-4 h-4 text-muted-foreground mx-2" />
          <!-- w-10 h-10 rounded-lg text-white — exact v0 -->
          <div class="flex items-center justify-center w-10 h-10 rounded-lg text-white" style="background: {color}" title={col}>
            <span class="text-sm font-bold">{col.charAt(0)}</span>
          </div>
        </div>
      {/if}
    {/each}

    <!-- Done: exact v0 -->
    <ArrowRight class="w-4 h-4 text-muted-foreground mx-2" />
    <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-success text-success-foreground">
      <CheckCircle class="w-5 h-5" />
    </div>
    <span class="text-sm text-muted-foreground mx-2">Done</span>
  </div>

  <!-- Stats bar: gap-6 py-3 border-t bg-muted/30 — exact v0 -->
  <div class="flex items-center justify-center gap-6 py-3 px-6 border-t bg-muted/30 text-sm">
    <div class="flex items-center gap-2">
      <span class="text-muted-foreground">Total:</span>
      <span class="font-medium">{stats.total}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
      <span class="text-muted-foreground">Processing:</span>
      <span class="font-medium text-primary">{stats.processing}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-warning"></span>
      <span class="text-muted-foreground">Needs Input:</span>
      <span class="font-medium text-warning">{stats.needsInput}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-success"></span>
      <span class="text-muted-foreground">Completed:</span>
      <span class="font-medium text-success">{stats.completed}</span>
    </div>
  </div>
</div>
