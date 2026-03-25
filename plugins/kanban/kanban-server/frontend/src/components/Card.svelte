<script lang="ts">
  import type { Task, Block } from "../lib/types";
  import { priorityClass, parseTags, parseJsonArray, timeAgo } from "../lib/utils";

  let { task, maxLoops, onclick }: {
    task: Task;
    maxLoops: number;
    onclick: () => void;
  } = $props();

  let blocks = $derived(parseJsonArray<Block>(task.blocks));
  let lastBlock = $derived(blocks.length > 0 ? blocks[blocks.length - 1] : null);
  let isBlocked = $derived(task.loop_count >= maxLoops);
  let isAwaiting = $derived(task.status.startsWith("awaiting:"));
  let tags = $derived(parseTags(task.tags));
  let noteCount = $derived(parseJsonArray(task.notes).length);
  let desc = $derived(task.description ? task.description.split("\n")[0].slice(0, 80) : "");
</script>

<div
  class="card"
  class:card-blocked={isBlocked}
  class:card-awaiting={isAwaiting}
  draggable="true"
  data-id={task.id}
  data-status={task.status}
  data-completed-at={task.completed_at ?? ""}
  role="button"
  tabindex="0"
  onclick={onclick}
  onkeydown={(e) => e.key === "Enter" && onclick()}
>
  <div class="card-header">
    <span class="card-id">#{task.id}</span>
    {#if priorityClass(task.priority)}
      <span class="badge {task.priority}">{task.priority}</span>
    {/if}
    {#if isBlocked}
      <span class="badge blocked">BLOCKED</span>
    {/if}
    {#if isAwaiting}
      <span class="badge awaiting">AWAITING</span>
    {/if}
    {#if lastBlock}
      <span class="badge" class:verdict-ok={lastBlock.verdict === "ok"} class:verdict-nok={lastBlock.verdict !== "ok"}>
        {lastBlock.agent}: {lastBlock.verdict}
      </span>
    {/if}
  </div>
  <div class="card-title">{task.title}</div>
  {#if desc}
    <div class="card-desc">{desc}</div>
  {/if}
  <div class="card-footer">
    {#if noteCount > 0}
      <span class="badge notes-count" title="{noteCount} note(s)">{noteCount}</span>
    {/if}
    {#if task.completed_at}
      <span class="badge date">{task.completed_at.slice(0, 10)}</span>
    {:else if task.created_at}
      <span class="badge created">{timeAgo(task.created_at)}</span>
    {/if}
  </div>
  {#if tags.length > 0}
    <div class="card-tags">
      {#each tags as tag}
        <span class="tag">{tag}</span>
      {/each}
    </div>
  {/if}
</div>
