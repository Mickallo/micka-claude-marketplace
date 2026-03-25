<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import Card from "./Card.svelte";
  import type { Task } from "../lib/types";
  import { isOlderThan3Days } from "../lib/utils";

  let { columnKey, tasks, maxLoops, searchQuery, hideOldDone, currentSort, onselect, onadd, ondragstart, ondrop }: {
    columnKey: string;
    tasks: Task[];
    maxLoops: number;
    searchQuery: string;
    hideOldDone: boolean;
    currentSort: string;
    onselect: (id: number) => void;
    onadd?: () => void;
    ondragstart: (e: DragEvent, id: number) => void;
    ondrop: (e: DragEvent, column: string) => void;
  } = $props();

  let label = $derived(
    columnKey === "todo" ? "Todo" : columnKey === "done" ? "Done" : columnKey
  );

  let sortedTasks = $derived.by(() => {
    if (currentSort === "default") return tasks;
    return [...tasks].sort((a, b) => {
      if (currentSort === "created_asc") return a.created_at.localeCompare(b.created_at);
      if (currentSort === "created_desc") return b.created_at.localeCompare(a.created_at);
      if (currentSort === "completed_desc") return (b.completed_at || "").localeCompare(a.completed_at || "");
      return 0;
    });
  });

  let filteredTasks = $derived.by(() => {
    const q = searchQuery.toLowerCase().replace(/^#/, "");
    return sortedTasks.filter((t) => {
      if (hideOldDone && t.status === "done" && isOlderThan3Days(t.completed_at || "")) return false;
      if (!q) return true;
      const id = String(t.id);
      return id === q || t.title.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q);
    });
  });

  let dragOver = $state(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      dragOver = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    ondrop(e, columnKey);
  }
</script>

<div class="column {columnKey}">
  <div class="column-header">
    <span>{label}</span>
    <div class="column-header-right">
      {#if onadd}
        <button class="add-card-btn" title="Add card" onclick={onadd}>+</button>
      {/if}
      <span class="count">
        {#if filteredTasks.length !== tasks.length}
          {filteredTasks.length}/{tasks.length}
        {:else}
          {tasks.length}
        {/if}
      </span>
    </div>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="column-body"
    class:drag-over={dragOver}
    data-column={columnKey}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#each filteredTasks as task (task.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        animate:flip={{ duration: 250 }}
        transition:fly={{ y: 20, duration: 200 }}
        ondragstart={(e) => ondragstart(e, task.id)}
      >
        <Card {task} {maxLoops} onclick={() => onselect(task.id)} />
      </div>
    {:else}
      <div class="empty">No items</div>
    {/each}
  </div>
</div>
