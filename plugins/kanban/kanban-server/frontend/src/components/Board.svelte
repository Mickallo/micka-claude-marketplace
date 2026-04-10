<script lang="ts">
  import Column from "./Column.svelte";
  import type { BoardResponse, AgentInfo } from "../lib/types";
  import { reorderTask } from "../lib/api";

  let { data, maxLoops, agentMap, onselect, onadd, onreorder }: {
    data: BoardResponse | null;
    maxLoops: number;
    agentMap: Map<string, AgentInfo>;
    onselect: (id: number) => void;
    onadd: () => void;
    onreorder: () => void;
  } = $props();

  function handleDragStart(e: DragEvent, id: number) {
    e.dataTransfer!.setData("text/plain", String(id));
    e.dataTransfer!.effectAllowed = "move";
  }

  async function handleDrop(e: DragEvent, column: string) {
    const id = parseInt(e.dataTransfer!.getData("text/plain"));
    if (isNaN(id)) return;
    const colBody = (e.target as HTMLElement).closest("[data-column]") as HTMLElement;
    if (!colBody) return;
    const cards = [...colBody.querySelectorAll<HTMLElement>("[data-id]")].filter(c => parseInt(c.dataset.id!) !== id);
    let afterId: number | null = null, beforeId: number | null = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { beforeId = parseInt(card.dataset.id!); break; }
      afterId = parseInt(card.dataset.id!);
    }
    await reorderTask(id, { status: column, afterId, beforeId });
    onreorder();
  }
</script>

{#if data}
  <div class="flex gap-5 overflow-x-auto pb-4 px-6">
    {#each data.column_order as col}
      <Column
        columnKey={col}
        tasks={data.columns[col] ?? []}
        {maxLoops}
        description={agentMap.get(col)?.description}
        {onselect}
        onadd={col === "todo" ? onadd : undefined}
        ondragstart={handleDragStart}
        ondrop={handleDrop}
      />
    {/each}
  </div>
{/if}
