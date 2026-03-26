<script lang="ts">
  import { Clock, AlertCircle, CheckCircle2, Loader2, Layers, ChevronRight } from "lucide-svelte";
  import { cn } from "../lib/cn";
  import { getAgentColor } from "../lib/agents";
  import type { Task, Block } from "../lib/types";
  import { parseJsonArray, parseTags } from "../lib/utils";
  import { formatDistanceToNow } from "../lib/time";

  let { task, maxLoops, onclick }: {
    task: Task;
    maxLoops: number;
    onclick: () => void;
  } = $props();

  let blocks = $derived(parseJsonArray<Block>(task.blocks));
  let isBlocked = $derived(task.loop_count >= maxLoops);
  let isAwaiting = $derived(task.status.startsWith("awaiting:"));
  let tags = $derived(parseTags(task.tags));
  let runningBlock = $derived(blocks.length > 0 && blocks[blocks.length - 1].verdict === "running" ? blocks[blocks.length - 1] : null);

  // Progress: which stages have been completed
  const defaultStages = ["Resolver", "Planner", "Critic", "Builder", "Inspector", "Ranger"];
  let completedStages = $derived(new Set(blocks.map(b => b.agent)));

  // Last 3 blocks for preview
  let previewBlocks = $derived(blocks.slice(-3));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn(
    "rounded-lg border bg-card cursor-pointer transition-all duration-200 hover:shadow-md relative",
    "hover:border-primary/50 group",
    isAwaiting && "border-warning/50 shadow-[0_0_15px_-3px] shadow-warning/10",
    isBlocked && "border-destructive/50"
  )}
  onclick={onclick}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === "Enter" && onclick()}
  draggable="true"
  data-id={task.id}
>
  <!-- Priority indicator -->
  <div
    class="absolute top-0 left-0 w-1 h-full rounded-l-lg"
    style={
      task.priority === "high" ? "background: oklch(0.6 0.2 25)" :
      task.priority === "medium" ? "background: oklch(0.7 0.15 45)" :
      "background: color-mix(in oklch, var(--color-muted-foreground) 30%, transparent)"
    }
  ></div>

  <!-- Header -->
  <div class="p-4 pb-2">
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <h4 class="font-medium text-sm leading-snug line-clamp-1">{task.title}</h4>
        {#if task.description}
          <p class="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
            {task.description.split("\n").find(l => l.trim() && !l.startsWith("#"))?.slice(0, 100) || task.description.split("\n")[0]?.slice(0, 100)}
          </p>
        {/if}
      </div>

      <!-- Status badge -->
      {#if isBlocked}
        <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0" style="background: color-mix(in oklch, oklch(0.6 0.2 25) 20%, transparent); color: oklch(0.6 0.2 25)">
          <AlertCircle class="w-3 h-3" /> Blocked
        </span>
      {:else if isAwaiting}
        <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0" style="background: color-mix(in oklch, oklch(0.7 0.15 45) 20%, transparent); color: oklch(0.7 0.15 45)">
          <AlertCircle class="w-3 h-3" /> Awaiting
        </span>
      {:else if task.status === "done"}
        <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0" style="background: color-mix(in oklch, oklch(0.75 0.15 145) 20%, transparent); color: oklch(0.75 0.15 145)">
          <CheckCircle2 class="w-3 h-3" /> Completed
        </span>
      {:else if runningBlock}
        <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0" style="background: color-mix(in oklch, oklch(0.65 0.18 200) 20%, transparent); color: oklch(0.65 0.18 200)">
          <Loader2 class="w-3 h-3 animate-spin" /> Processing
        </span>
      {/if}
    </div>
  </div>

  <div class="px-4 pb-4">
    <!-- Agent progress dots + block count -->
    <div class="flex items-center gap-2 mb-3 mt-1">
      <div class="flex items-center gap-1">
        {#each defaultStages as stage}
          {@const color = getAgentColor(stage)}
          {@const done = completedStages.has(stage)}
          {@const isCurrent = task.status === stage}
          <div
            class={cn(
              "w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-semibold transition-all",
              !done && "bg-secondary text-muted-foreground",
              isCurrent && "ring-2 ring-ring ring-offset-1 ring-offset-background"
            )}
            style={done ? `background: ${color}; color: var(--color-background)` : ""}
            title={stage}
          >
            {stage.charAt(0)}
          </div>
        {/each}
      </div>
      <span class="text-xs text-muted-foreground">
        <Layers class="w-3 h-3 inline mr-1" />
        {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
      </span>
    </div>

      <!-- Block previews (last 3) — v0 style compact cards -->
    {#if previewBlocks.length > 0}
      <div class="flex flex-col gap-2 mb-3">
        {#each previewBlocks as block}
          {@const bcolor = getAgentColor(block.agent)}
          {@const btitle = block.content.split("\n").find(l => l.trim().startsWith("#"))?.replace(/^#+\s*/, "").slice(0, 45) || block.agent}
          <button
            class={cn(
              "w-full text-left rounded-md border border-border bg-card/50 p-2.5",
              "hover:bg-secondary/50 hover:border-primary/30 transition-all",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            )}
          >
            <div class="flex items-center gap-2.5">
              <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background: {bcolor}">
                <span class="text-[10px] font-bold" style="color: var(--color-background)">{block.agent.charAt(0)}</span>
              </div>
              <span class="text-xs font-medium truncate flex-1">{btitle}</span>
              {#if block.verdict !== "ok"}
                <span class="text-[10px] px-1.5 py-0.5 rounded-full" style="background: color-mix(in oklch, oklch(0.7 0.15 45) 20%, transparent); color: oklch(0.7 0.15 45)">
                  {block.verdict}
                </span>
              {/if}
            </div>
          </button>
        {/each}
        {#if blocks.length > 3}
          <div class="text-xs text-muted-foreground text-center py-1">
            +{blocks.length - 3} more blocks
          </div>
        {/if}
      </div>
    {/if}

    <!-- Running block indicator -->
    {#if runningBlock}
      {@const rcolor = getAgentColor(runningBlock.agent)}
      <div class="rounded-md border border-primary/30 bg-primary/5 p-2.5 mb-3 animate-pulse">
        <div class="flex items-center gap-2.5">
          <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style="background: {rcolor}">
            <Loader2 class="w-3.5 h-3.5 text-white animate-spin" />
          </div>
          <span class="text-xs font-medium flex-1">{runningBlock.agent} running...</span>
          {#if runningBlock.agent_id}
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">Terminal</span>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Footer -->
    <div class="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
      <div class="flex items-center gap-1">
        <Clock class="w-3 h-3" />
        <span>{formatDistanceToNow(task.created_at)}</span>
      </div>

      <button class="inline-flex items-center gap-0.5 h-6 px-2 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-secondary text-xs">
        View All
        <ChevronRight class="w-3 h-3" />
      </button>
    </div>
  </div>
</div>
