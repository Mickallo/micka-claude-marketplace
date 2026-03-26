<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { X, Clock, AlertCircle, CheckCircle, Loader2, Play, Trash2, Terminal as TerminalIcon, Copy, Check, Send } from "lucide-svelte";
  import { cn } from "../lib/cn";
  import { md } from "../lib/markdown";
  import type { Task, Block, Note, Attachment } from "../lib/types";
  import { fetchTask, patchTask, deleteTask, gateAction, addNote, deleteNote, addAttachment, deleteAttachment, runPipeline, stopPipeline } from "../lib/api";
  import { parseJsonArray } from "../lib/utils";
  import TerminalView from "./Terminal.svelte";
  import { formatDistanceToNow } from "../lib/time";
  import { getAgentColor } from "../lib/agents";
  import { onSSE } from "../lib/sse";

  let { taskId, columnOrder, maxLoops, onclose }: {
    taskId: number;
    columnOrder: string[];
    maxLoops: number;
    onclose: () => void;
  } = $props();

  let task: Task | null = $state(null);
  let noteText = $state("");
  let refuseComment = $state("");
  let selectedBlockIdx: number | null = $state(null);
  let terminalBlockIdx: number | null = $state(null);
  let copied = $state<number | null>(null);

  let blocks = $derived(task ? parseJsonArray<Block>(task.blocks) : []);
  let notes = $derived(task ? parseJsonArray<Note>(task.notes) : []);
  let attachments = $derived(task ? parseJsonArray<Attachment>(task.attachments) : []);
  let isBlocked = $derived(task ? task.loop_count >= maxLoops : false);
  let awaitingStage = $derived(task?.status.startsWith("awaiting:") ? task.status.slice("awaiting:".length) : null);
  let hasRunningBlock = $derived(blocks.some(b => b.verdict === "running"));
  let selectedBlock = $derived(selectedBlockIdx !== null ? blocks[selectedBlockIdx] ?? null : null);
  let detailTab: "content" | "terminal" = $state("content");
  let canResume = $derived(
    selectedBlock !== null &&
    selectedBlock.agent_id !== null &&
    selectedBlock.verdict !== "running" &&
    selectedBlock.verdict !== "info" &&
    !selectedBlock.agent_id?.startsWith("term_") &&
    !hasRunningBlock &&
    (task?.status === "done" || task?.status === "todo" || task?.status?.startsWith("awaiting:"))
  );

  async function load() {
    try { task = await fetchTask(taskId); } catch (e) { console.error("Load failed:", e); }
  }

  let unsub: (() => void) | null = null;
  onMount(() => {
    load();
    unsub = onSSE("*", (data) => {
      if (data.taskId === taskId) load();
    });
  });
  onDestroy(() => { unsub?.(); });

  async function handleApprove() { if (!task) return; await gateAction(task.id, "approve"); load(); }
  async function handleRefuse() {
    if (!task || !refuseComment.trim()) return;
    await gateAction(task.id, "refuse", refuseComment);
    refuseComment = "";
    load();
  }
  async function handleAddNote() {
    if (!task || !noteText.trim()) return;
    await addNote(task.id, noteText);
    noteText = "";
    load();
  }
  async function handleDelete() {
    if (!task || !confirm(`Delete ticket #${task.id}?`)) return;
    await deleteTask(task.id);
    onclose();
  }
  function selectBlock(idx: number) {
    if (blocks[idx]?.verdict === "running") return;
    if (selectedBlockIdx === idx) {
      selectedBlockIdx = null;
    } else {
      selectedBlockIdx = idx;
      detailTab = "content";
    }
  }
  function handleCopy(content: string) {
    navigator.clipboard.writeText(content);
    copied = selectedBlockIdx;
    setTimeout(() => (copied = null), 2000);
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onclick={onclose}></div>

<!-- Sheet from right — widens when a block is selected -->
<div class={cn(
  "fixed inset-y-0 right-0 z-50 flex flex-col bg-background border-l shadow-xl animate-slide-in transition-[max-width] duration-200",
  selectedBlock ? "w-full max-w-6xl" : "w-full sm:max-w-xl md:max-w-2xl"
)}>
  {#if !task}
    <div class="flex-1 flex items-center justify-center text-muted-foreground">
      <Loader2 class="w-6 h-6 animate-spin" />
    </div>
  {:else}
    <!-- Header -->
    <div class="p-4 border-b bg-card shrink-0">
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-semibold">#{task.id} {task.title}</h2>
          {#if task.description}
            <p class="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description.split("\n")[0]?.slice(0, 120)}</p>
          {/if}
        </div>
        <button class="w-8 h-8 rounded-md flex items-center justify-center hover:bg-secondary transition-colors shrink-0" onclick={onclose}>
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Status badges -->
      <div class="flex items-center gap-2 mt-3 flex-wrap">
        {#if isBlocked}
          <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-destructive/20 text-destructive">
            <AlertCircle class="w-3 h-3" /> Blocked ({task.loop_count}/{maxLoops})
          </span>
        {:else if awaitingStage}
          <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-warning/20 text-warning">
            <AlertCircle class="w-3 h-3" /> Awaiting: {awaitingStage}
          </span>
        {:else if task.status === "done"}
          <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-success/20 text-success">
            <CheckCircle class="w-3 h-3" /> Completed
          </span>
        {:else if hasRunningBlock}
          <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            <Loader2 class="w-3 h-3 animate-spin" /> Processing
          </span>
        {:else if task.status !== "todo"}
          <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-secondary text-muted-foreground">
            {task.status}
          </span>
        {/if}

        <span class="text-xs px-2 py-1 rounded-full border border-border text-muted-foreground">
          <Clock class="w-3 h-3 inline mr-1" />
          {formatDistanceToNow(task.created_at)}
        </span>

        <span class={cn(
          "text-xs px-2 py-1 rounded-full border",
          task.priority === "high" && "border-destructive/50 text-destructive",
          task.priority === "medium" && "border-warning/50 text-warning",
          task.priority === "low" && "border-muted-foreground/50 text-muted-foreground"
        )}>
          {task.priority}
        </span>
      </div>

      <!-- Pipeline progress -->
      <div class="flex items-center gap-1 mt-4">
        <span class="text-xs text-muted-foreground mr-2">Pipeline:</span>
        {#each columnOrder as col, i}
          {@const hasBlock = blocks.some(b => b.agent === col)}
          {@const isCurrent = task.status === col || awaitingStage === col}
          {@const pcolor = getAgentColor(col)}
          <div class="flex items-center">
            <div
              class={cn(
                "w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold transition-all",
                !hasBlock && "bg-secondary text-muted-foreground",
                isCurrent && "ring-2 ring-ring ring-offset-1 ring-offset-background"
              )}
              style={hasBlock ? `background: ${pcolor || (col === "done" ? "oklch(0.75 0.15 145)" : "")}; color: white` : col === "done" && task.status === "done" ? "background: oklch(0.75 0.15 145); color: white" : ""}
              title={col}
            >
              {col === "todo" ? "Q" : col === "done" ? "D" : col.charAt(0)}
            </div>
            {#if i < columnOrder.length - 1}
              <div class={cn("w-3 h-0.5 mx-0.5", hasBlock ? "bg-primary" : "bg-border")}></div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Gate actions -->
      {#if awaitingStage}
        <div class="flex items-center gap-2 mt-4">
          <button class="px-3 py-1.5 text-sm font-medium rounded-md bg-success text-success-foreground hover:bg-success/90" onclick={handleApprove}>
            Approve
          </button>
          <input
            class="flex-1 px-3 py-1.5 text-sm rounded-md bg-secondary border border-border"
            placeholder="Reason for refusal..."
            bind:value={refuseComment}
          />
          <button class="px-3 py-1.5 text-sm font-medium rounded-md bg-destructive/15 text-destructive hover:bg-destructive/25" onclick={handleRefuse}>
            Refuse
          </button>
        </div>
      {/if}

      <!-- Actions -->
      <div class="flex items-center gap-2 mt-4">
        {#if hasRunningBlock}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-destructive/15 text-destructive hover:bg-destructive/25"
            onclick={async () => { if (task) { await stopPipeline(task.id); load(); } }}
          >
            <X class="w-3.5 h-3.5" /> Stop Pipeline
          </button>
        {:else}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={task.status === "done"}
            onclick={async () => { if (task) { await runPipeline(task.id); load(); } }}
          >
            <Play class="w-3.5 h-3.5" /> Run Pipeline
          </button>
        {/if}
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md text-destructive hover:bg-destructive/10" onclick={handleDelete}>
          <Trash2 class="w-3.5 h-3.5" /> Delete
        </button>
      </div>
    </div>

    <!-- Main content: split blocks list / detail -->
    <div class="flex-1 flex min-h-0">
      <!-- Left: Blocks list -->
      <div class={cn(
        "flex flex-col border-r shrink-0 overflow-hidden transition-[width] duration-200",
        selectedBlock ? "w-72" : "w-full"
      )}>
        <div class="flex-1 overflow-y-auto p-3">
          {#if blocks.length === 0}
            <div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Clock class="w-12 h-12 mb-4 opacity-50" />
              <p class="text-sm font-medium">No blocks yet</p>
              <p class="text-xs mt-1">Run the pipeline to see agent activity</p>
            </div>
          {:else}
            <div class="text-xs text-muted-foreground mb-2 px-1">
              {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
            </div>

            <div class="flex flex-col gap-1.5">
              {#each blocks as block, idx}
                {@const bcolor = getAgentColor(block.agent)}
                {@const isRunning = block.verdict === "running"}
                {@const isUser = block.verdict === "info"}
                {@const isSelected = selectedBlockIdx === idx}
                <button
                  class={cn(
                    "w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-l-[3px] text-left transition-all",
                    isRunning && "border-primary/50 animate-pulse cursor-default",
                    isSelected && !isRunning && "bg-secondary shadow-sm",
                    !isSelected && !isRunning && "border-transparent hover:bg-secondary/50",
                    isUser && "opacity-70 border-l-muted-foreground/30"
                  )}
                  style={!isUser ? `border-left-color: ${bcolor}` : ""}
                  onclick={() => selectBlock(idx)}
                >
                  {#if isUser}
                    <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-muted text-muted-foreground text-xs font-bold">
                      {block.agent === "user" ? "U" : block.agent.charAt(0).toUpperCase()}
                    </div>
                  {:else}
                    <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white text-xs font-bold" style="background: {bcolor}">
                      {#if isRunning}
                        <Loader2 class="w-3.5 h-3.5 animate-spin" />
                      {:else}
                        {block.agent.charAt(0)}
                      {/if}
                    </div>
                  {/if}

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="font-medium text-xs truncate">
                        {isUser ? (block.agent === "user" ? "User" : block.agent) : block.agent}
                      </span>
                      {#if isRunning}
                        <span class="text-[9px] px-1 py-0.5 rounded bg-primary/20 text-primary leading-none">running</span>
                      {:else if !isUser}
                        <span class={cn(
                          "text-[9px] px-1 py-0.5 rounded leading-none",
                          block.verdict === "ok" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"
                        )}>{block.verdict}</span>
                      {/if}
                    </div>
                    <span class="text-[10px] text-muted-foreground">{formatDistanceToNow(block.timestamp)}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Note input -->
        <div class="p-3 border-t bg-card shrink-0">
          <div class="flex gap-1.5">
            <input
              class={cn(
                "flex-1 px-2.5 py-1.5 text-sm rounded-md bg-secondary border border-border",
                selectedBlock && "text-xs"
              )}
              placeholder={isBlocked ? "Comment to unblock..." : "Add a note..."}
              bind:value={noteText}
              onkeydown={(e) => e.key === "Enter" && handleAddNote()}
            />
            <button
              class="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              onclick={handleAddNote}
            >
              <Send class="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Block detail -->
      {#if selectedBlock}
        <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
          <!-- Detail header with tabs -->
          <div class="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white text-xs font-bold" style="background: {getAgentColor(selectedBlock.agent)}">
                {selectedBlock.agent.charAt(0)}
              </div>
              <span class="font-medium text-sm">{selectedBlock.agent}</span>
              {#if selectedBlock.verdict !== "info"}
                <span class={cn(
                  "text-[10px] px-1.5 py-0.5 rounded",
                  selectedBlock.verdict === "ok" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"
                )}>{selectedBlock.verdict}</span>
              {/if}

              <!-- Tabs -->
              <div class="flex items-center gap-0.5 ml-3 bg-secondary rounded-md p-0.5">
                <button
                  class={cn(
                    "px-3 py-1 text-xs rounded transition-all",
                    detailTab === "content" ? "bg-card text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                  )}
                  onclick={() => (detailTab = "content")}
                >Content</button>
                {#if canResume}
                  <button
                    class={cn(
                      "px-3 py-1 text-xs rounded transition-all flex items-center gap-1",
                      detailTab === "terminal" ? "bg-card text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                    )}
                    onclick={() => { detailTab = "terminal"; terminalBlockIdx = selectedBlockIdx; }}
                  >
                    <TerminalIcon class="w-3 h-3" /> Terminal
                  </button>
                {/if}
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              {#if detailTab === "content"}
                <button
                  class="inline-flex items-center gap-1 h-7 px-2.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 border border-border"
                  onclick={() => handleCopy(selectedBlock!.content)}
                >
                  {#if copied === selectedBlockIdx}
                    <Check class="w-3 h-3 text-success" /> Copied
                  {:else}
                    <Copy class="w-3 h-3" /> Copy
                  {/if}
                </button>
              {/if}
              <button
                class="w-7 h-7 rounded-md flex items-center justify-center hover:bg-secondary"
                onclick={() => (selectedBlockIdx = null)}
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <!-- Tab content -->
          {#if detailTab === "content"}
            <div class="flex-1 overflow-y-auto p-5">
              <div class="prose prose-sm max-w-none">{@html md(selectedBlock.content)}</div>

              {#if selectedBlock.decision_log}
                <div class="mt-6 pt-4 border-t">
                  <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Decision Log</h4>
                  <div class="prose prose-sm max-w-none text-muted-foreground">{@html md(selectedBlock.decision_log)}</div>
                </div>
              {/if}
            </div>
          {:else if detailTab === "terminal" && terminalBlockIdx !== null && blocks[terminalBlockIdx]?.agent_id}
            <div class="flex-1 min-h-0 relative">
              <div class="absolute inset-0">
                <TerminalView id={blocks[terminalBlockIdx].agent_id!} />
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .animate-slide-in {
    animation: slide-in 0.2s ease-out;
  }
</style>
