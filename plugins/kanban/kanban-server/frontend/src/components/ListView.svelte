<script lang="ts">
  import type { BoardResponse, Task } from "../lib/types";
  import { patchTask } from "../lib/api";
  import { priorityClass, parseTags, isOlderThan3Days } from "../lib/utils";

  let { data, searchQuery, hideOldDone, maxLoops, onselect, onrefresh, ontoast }: {
    data: BoardResponse | null;
    searchQuery: string;
    hideOldDone: boolean;
    maxLoops: number;
    onselect: (id: number) => void;
    onrefresh: () => void;
    ontoast: (msg: string) => void;
  } = $props();

  let allTasks = $derived.by(() => {
    if (!data) return [];
    const tasks: Task[] = [];
    for (const col of data.column_order) {
      for (const t of data.columns[col] ?? []) tasks.push(t);
    }
    return tasks.sort((a, b) => b.id - a.id);
  });

  let filteredTasks = $derived.by(() => {
    const q = searchQuery.toLowerCase().replace(/^#/, "");
    return allTasks.filter((t) => {
      if (hideOldDone && t.status === "done" && isOlderThan3Days(t.completed_at || "")) return false;
      if (!q) return true;
      return String(t.id) === q || t.title.toLowerCase().includes(q);
    });
  });

  async function handleChange(id: number, field: string, value: string) {
    const res = await patchTask(id, { [field]: value });
    if (res.error) ontoast(res.error);
    onrefresh();
  }
</script>

{#if data}
  <main class="list-view">
    <table class="list-table">
      <thead>
        <tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Tags</th><th>Created</th><th>Completed</th></tr>
      </thead>
      <tbody>
        {#each filteredTasks as task (task.id)}
          <tr class="status-{task.status}" class:row-blocked={task.loop_count >= maxLoops}>
            <td class="col-id">#{task.id}</td>
            <td class="col-title" role="button" tabindex="0" onclick={() => onselect(task.id)} onkeydown={(e) => e.key === "Enter" && onselect(task.id)}>
              {task.title}
            </td>
            <td>
              <select value={task.status} onchange={(e) => handleChange(task.id, "status", (e.target as HTMLSelectElement).value)}>
                {#each data.column_order as col}
                  <option value={col}>{col}</option>
                {/each}
              </select>
            </td>
            <td>
              <select class={priorityClass(task.priority)} value={task.priority} onchange={(e) => handleChange(task.id, "priority", (e.target as HTMLSelectElement).value)}>
                {#each ["high", "medium", "low"] as p}
                  <option value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                {/each}
              </select>
            </td>
            <td>{#each parseTags(task.tags) as tag}<span class="tag">{tag}</span>{/each}</td>
            <td class="list-date">{task.created_at?.slice(0, 10) ?? ""}</td>
            <td class="list-date">{task.completed_at?.slice(0, 10) ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </main>
{/if}
