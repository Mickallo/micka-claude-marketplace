<script lang="ts">
  import Card from "./Card.svelte";
  import { cn } from "../lib/cn";
  import { getAgentColor } from "../lib/agents";
  import type { Task } from "../lib/types";

  let { columnKey, tasks, maxLoops, description, onselect, onadd, ondragstart, ondrop }: {
    columnKey: string;
    tasks: Task[];
    maxLoops: number;
    description?: string;
    onselect: (id: number) => void;
    onadd?: () => void;
    ondragstart: (e: DragEvent, id: number) => void;
    ondrop: (e: DragEvent, column: string) => void;
  } = $props();

  let color = $derived(getAgentColor(columnKey));
  let awaitingCount = $derived(tasks.filter(t => t.status.startsWith("awaiting:")).length);
  let processingCount = $derived(tasks.filter(t => !t.status.startsWith("awaiting:") && t.status !== "todo" && t.status !== "done").length);
  let dragOver = $state(false);
  let label = $derived(columnKey === "todo" ? "Queue" : columnKey === "done" ? "Done" : columnKey);
</script>

<div class={cn("flex flex-col min-w-[320px] w-[320px] rounded-lg border bg-card", "transition-all duration-200")}>
  <!-- Column Header — v0 style -->
  <div
    class="flex items-center gap-3 px-4 py-5 border-b"
    style={color ? `background: linear-gradient(to right, transparent, color-mix(in oklch, ${color} 10%, transparent))` : ""}
  >
    <!-- Agent icon circle -->
    <div
      class="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
      style={color
        ? `background: color-mix(in oklch, ${color} 20%, transparent); color: ${color}`
        : "background: var(--color-muted); color: var(--color-muted-foreground)"
      }
    >
      <span class="text-base font-bold">{label.charAt(0)}</span>
    </div>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold text-sm truncate">{label}</h3>
        <span class="inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs rounded-full bg-secondary text-secondary-foreground">
          {tasks.length}
        </span>
      </div>
      <p class="text-xs text-muted-foreground truncate">
        {#if description}{description.slice(0, 50)}
        {:else if columnKey === "todo"}Tickets waiting to be processed
        {:else if columnKey === "done"}Completed tickets
        {:else}{columnKey} agent{/if}
      </p>
    </div>

    <!-- Status indicators -->
    <div class="flex items-center gap-1.5">
      {#if processingCount > 0}
        <div class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
          style="background: color-mix(in oklch, {color} 20%, transparent); color: {color}">
          <span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background: {color}"></span>
          {processingCount}
        </div>
      {/if}
      {#if awaitingCount > 0}
        <div class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
          style="background: color-mix(in oklch, oklch(0.7 0.15 45) 20%, transparent); color: oklch(0.7 0.15 45)">
          <span class="w-1.5 h-1.5 rounded-full" style="background: oklch(0.7 0.15 45)"></span>
          {awaitingCount}
        </div>
      {/if}
    </div>
  </div>

  <!-- Tickets -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={cn("flex-1 overflow-y-auto max-h-[calc(100vh-280px)]", dragOver && "bg-primary/5")}
    data-column={columnKey}
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragOver = false; }}
    ondrop={(e) => { e.preventDefault(); dragOver = false; ondrop(e, columnKey); }}
  >
    <div class="p-3 flex flex-col gap-3.5">
      {#if tasks.length === 0}
        <div class="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <div class="w-12 h-12 rounded-lg flex items-center justify-center mb-3 opacity-30"
            style={color ? `background: color-mix(in oklch, ${color} 15%, transparent); color: ${color}` : ""}>
            <span class="text-xl font-bold">{label.charAt(0)}</span>
          </div>
          <p class="text-sm">No tickets</p>
        </div>
      {:else}
        {#each tasks as task (task.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div ondragstart={(e) => ondragstart(e, task.id)}>
            <Card {task} {maxLoops} onclick={() => onselect(task.id)} />
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
