<script lang="ts">
  import Column from "./Column.svelte";
  import type { BoardResponse } from "../lib/types";
  import { reorderTask } from "../lib/api";

  let { data, searchQuery, hideOldDone, currentSort, maxLoops, onselect, onadd, onreorder, ontoast }: {
    data: BoardResponse | null;
    searchQuery: string;
    hideOldDone: boolean;
    currentSort: string;
    maxLoops: number;
    onselect: (id: number) => void;
    onadd: () => void;
    onreorder: () => void;
    ontoast: (msg: string) => void;
  } = $props();

  let draggingId: number | null = $state(null);

  function handleDragStart(e: DragEvent, id: number) {
    draggingId = id;
    e.dataTransfer!.setData("text/plain", String(id));
    e.dataTransfer!.effectAllowed = "move";
  }

  async function handleDrop(e: DragEvent, column: string) {
    const id = parseInt(e.dataTransfer!.getData("text/plain"));
    if (isNaN(id)) return;

    // Find insertion point
    const colBody = (e.target as HTMLElement).closest(".column-body") as HTMLElement;
    if (!colBody) return;

    const cards = [...colBody.querySelectorAll<HTMLElement>(".card")].filter(
      (c) => parseInt(c.dataset.id!) !== id
    );
    let afterId: number | null = null;
    let beforeId: number | null = null;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        beforeId = parseInt(card.dataset.id!);
        break;
      }
      afterId = parseInt(card.dataset.id!);
    }

    const res = await reorderTask(id, { status: column, afterId, beforeId });
    if (res.error) ontoast(res.error);
    draggingId = null;
    onreorder();
  }
</script>

{#if data}
  <main class="board">
    {#each data.column_order as col}
      <Column
        columnKey={col}
        tasks={data.columns[col] ?? []}
        {maxLoops}
        {searchQuery}
        {hideOldDone}
        {currentSort}
        {onselect}
        onadd={col === "todo" ? onadd : undefined}
        ondragstart={handleDragStart}
        ondrop={handleDrop}
      />
    {/each}
  </main>
{/if}
