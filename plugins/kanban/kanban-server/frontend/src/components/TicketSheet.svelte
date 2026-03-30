<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { X, Clock, AlertCircle, CheckCircle, Loader2, Play, Trash2, Terminal as TerminalIcon, Copy, Check, ChevronRight } from "lucide-svelte";
  import { cn } from "../lib/cn";
  import { md } from "../lib/markdown";
  import type { Task, Block, Attachment } from "../lib/types";
  import { fetchTask, patchTask, deleteTask, gateAction, runPipeline, stopPipeline } from "../lib/api";
  import { parseJsonArray } from "../lib/utils";
  import TerminalView from "./Terminal.svelte";
  import GitPanel from "./GitPanel.svelte";
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
  let refuseComment = $state("");
  let showRefuseInput = $state(false);
  let selectedBlockIdx: number | null = $state(null);
  let terminalBlockIdx: number | null = $state(null);
  let copied = $state<number | null>(null);
  let gitPanelOpen = $state(false);
  let gitPanelWidth = $state(50); // percentage
  let draggingGit = $state(false);

  function startGitDrag(e: MouseEvent) {
    e.preventDefault();
    draggingGit = true;
    const container = (e.target as HTMLElement).closest(".flex-1.flex.min-h-0") as HTMLElement;
    if (!container) return;

    function onMove(ev: MouseEvent) {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      gitPanelWidth = Math.max(20, Math.min(80, 100 - pct));
    }
    function onUp() {
      draggingGit = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  let blocks = $derived(task ? parseJsonArray<Block>(task.blocks) : []);
  let attachments = $derived(task ? parseJsonArray<Attachment>(task.attachments) : []);
  let isBlocked = $derived(task ? task.loop_count >= maxLoops : false);
  let awaitingStage = $derived(task?.status.startsWith("awaiting:") ? task.status.slice("awaiting:".length) : null);
  let hasRunningBlock = $derived(blocks.some(b => b.verdict === "running"));
  let selectedBlock = $derived(selectedBlockIdx !== null && selectedBlockIdx >= 0 ? blocks[selectedBlockIdx] ?? null : null);
  let isActionSelected = $derived(selectedBlockIdx === -1);
  let needsAction = $derived(!!awaitingStage || isBlocked);
  let hasDetailOpen = $derived(selectedBlock !== null || isActionSelected);
  let detailTab: "content" | "decision_log" | "terminal" = $state("content");
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
      showRefuseInput = false;
      refuseComment = "";
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
  gitPanelOpen ? "w-full max-w-[100vw]" : hasDetailOpen ? "w-full max-w-6xl" : "w-full sm:max-w-xl md:max-w-2xl"
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
        <button
          class={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors",
            gitPanelOpen ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
          )}
          onclick={() => (gitPanelOpen = !gitPanelOpen)}
        >
          Git
        </button>
      </div>
    </div>

    <!-- Main content: split blocks list / detail / git -->
    <div class="flex-1 flex min-h-0">
    <div class="flex min-h-0 min-w-0 overflow-hidden" style={gitPanelOpen ? `width: ${100 - gitPanelWidth}%` : "flex: 1"}>
      <!-- Left: Blocks list -->
      <div class={cn(
        "flex flex-col border-r shrink-0 overflow-hidden transition-[width] duration-200",
        hasDetailOpen ? "w-72" : "w-full"
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
                {@const isUser = block.agent === "user"}
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
                      {:else if block.verdict !== "info"}
                        <span class={cn(
                          "text-[9px] px-1 py-0.5 rounded leading-none",
                          block.verdict === "ok" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"
                        )}>{block.verdict}</span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{formatDistanceToNow(block.timestamp)}</span>
                      {#if block.model}
                        <span class="text-muted-foreground/50">·</span>
                        <span class="truncate">{block.model.replace("claude-", "")}</span>
                      {/if}
                      {#if block.input_tokens || block.output_tokens}
                        <span class="text-muted-foreground/50">·</span>
                        <span>{Math.round(((block.input_tokens || 0) + (block.output_tokens || 0)) / 1000)}k</span>
                      {/if}
                    </div>
                  </div>
                </button>
              {/each}

              <!-- Action required block (gate or blocked) -->
              {#if needsAction}
                <button
                  class={cn(
                    "w-full flex items-center gap-2.5 p-3 rounded-lg border-2 text-left transition-all animate-gate-pulse",
                    isBlocked ? "border-destructive/50 bg-destructive/5 hover:bg-destructive/10" : "border-warning/50 bg-warning/10 hover:bg-warning/15",
                    isActionSelected && isBlocked && "bg-destructive/15 border-destructive shadow-md shadow-destructive/10",
                    isActionSelected && !isBlocked && "bg-warning/20 border-warning shadow-md shadow-warning/10"
                  )}
                  onclick={() => { selectedBlockIdx = selectedBlockIdx === -1 ? null : -1; detailTab = "content"; }}
                >
                  <div class={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold shadow-sm",
                    isBlocked ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"
                  )}>
                    !
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class={cn("font-medium text-sm", isBlocked ? "text-destructive" : "text-warning")}>
                        {isBlocked ? "Blocked" : awaitingStage}
                      </span>
                      <span class={cn(
                        "text-[9px] px-1.5 py-0.5 rounded-full font-semibold leading-none",
                        isBlocked ? "bg-destructive/20 text-destructive" : "bg-warning/30 text-warning"
                      )}>action required</span>
                    </div>
                    <span class="text-[10px] text-muted-foreground">
                      {isBlocked ? `Looped ${task?.loop_count}/${maxLoops} times — give feedback` : "Click to review & validate"}
                    </span>
                  </div>
                  <div class="shrink-0">
                    <ChevronRight class={cn("w-4 h-4", isBlocked ? "text-destructive" : "text-warning")} />
                  </div>
                </button>
              {/if}
            </div>
          {/if}
        </div>

        <div class="p-3 border-t shrink-0 flex justify-end">
          <button class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-destructive hover:bg-destructive/10" onclick={handleDelete}>
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Right: Detail panel -->
      {#if isActionSelected && needsAction}
        <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
          <!-- Action header -->
          <div class="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
            <div class="flex items-center gap-3 min-w-0">
              <div class={cn(
                "w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white text-xs font-bold",
                isBlocked ? "bg-destructive" : ""
              )} style={!isBlocked && awaitingStage ? `background: ${getAgentColor(awaitingStage)}` : ""}>
                {isBlocked ? "!" : awaitingStage?.charAt(0)}
              </div>
              <span class="font-medium text-sm">{isBlocked ? "Blocked" : awaitingStage}</span>
              <span class={cn(
                "text-[10px] px-1.5 py-0.5 rounded",
                isBlocked ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"
              )}>{isBlocked ? `${task?.loop_count}/${maxLoops} loops` : "awaiting"}</span>
            </div>
            <button
              class="w-7 h-7 rounded-md flex items-center justify-center hover:bg-secondary"
              onclick={() => (selectedBlockIdx = null)}
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- Action content -->
          <div class="flex-1 overflow-y-auto p-5">
            <div class="mb-6">
              <h3 class="text-base font-semibold mb-2">
                {isBlocked ? "Pipeline Blocked" : "Stage Validation Required"}
              </h3>
              <p class="text-sm text-muted-foreground">
                {#if isBlocked}
                  The pipeline has looped <strong>{task?.loop_count}</strong> times without resolution.
                {:else}
                  The <strong>{awaitingStage}</strong> stage has completed. Review the output and decide.
                {/if}
              </p>
            </div>

            {#if !showRefuseInput}
              <div class="flex items-center gap-2">
                <button
                  class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-success text-success-foreground hover:bg-success/90 transition-colors"
                  onclick={handleApprove}
                >
                  <CheckCircle class="w-4 h-4" /> Approve
                </button>
                <button
                  class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                  onclick={() => (showRefuseInput = true)}
                >
                  <X class="w-4 h-4" /> Refuse...
                </button>
              </div>
            {:else}
              <div class="flex flex-col gap-2">
                <textarea
                  class="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border resize-none"
                  rows="3"
                  placeholder="Explain what needs to be changed..."
                  bind:value={refuseComment}
                ></textarea>
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary transition-colors"
                    onclick={() => { showRefuseInput = false; refuseComment = ""; }}
                  >Cancel</button>
                  <button
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50"
                    disabled={!refuseComment.trim()}
                    onclick={handleRefuse}
                  >
                    <X class="w-3.5 h-3.5" /> Refuse — retry stage
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {:else if selectedBlock}
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
              {#if selectedBlock.model || selectedBlock.input_tokens}
                <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-1">
                  {#if selectedBlock.model}
                    <span class="px-1.5 py-0.5 rounded bg-secondary">{selectedBlock.model.replace("claude-", "")}</span>
                  {/if}
                  {#if selectedBlock.input_tokens || selectedBlock.output_tokens}
                    <span>{(selectedBlock.input_tokens || 0).toLocaleString()} in · {(selectedBlock.output_tokens || 0).toLocaleString()} out</span>
                  {/if}
                  {#if selectedBlock.cost_usd}
                    <span class="text-muted-foreground/50">·</span>
                    <span>${selectedBlock.cost_usd.toFixed(3)}</span>
                  {/if}
                  {#if selectedBlock.duration_ms}
                    <span class="text-muted-foreground/50">·</span>
                    <span>{Math.round(selectedBlock.duration_ms / 1000)}s</span>
                  {/if}
                </div>
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
                {#if selectedBlock.decision_log}
                  <button
                    class={cn(
                      "px-3 py-1 text-xs rounded transition-all",
                      detailTab === "decision_log" ? "bg-card text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                    )}
                    onclick={() => (detailTab = "decision_log")}
                  >Decision Log</button>
                {/if}
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
            <div class="flex-1 overflow-auto p-5 min-w-0">
              <div class="prose max-w-none">{@html md(selectedBlock.content)}</div>
            </div>
          {:else if detailTab === "decision_log" && selectedBlock.decision_log}
            <div class="flex-1 overflow-auto p-5 min-w-0">
              <div class="prose max-w-none text-muted-foreground">{@html md(selectedBlock.decision_log)}</div>
            </div>
          {:else if detailTab === "terminal" && terminalBlockIdx !== null && blocks[terminalBlockIdx]?.agent_id}
            <div class="flex-1 min-h-0 flex flex-col">
              <div class="px-4 py-1.5 border-b bg-secondary/50 flex items-center gap-2 shrink-0">
                <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Command</span>
                <code class="text-xs font-mono text-foreground/80 select-all">claude --resume {blocks[terminalBlockIdx].agent_id}</code>
              </div>
              <div class="flex-1 min-h-0 relative">
                <div class="absolute inset-0">
                  <TerminalView id={blocks[terminalBlockIdx].agent_id!} />
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {#if gitPanelOpen && task}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={cn(
          "w-1 shrink-0 cursor-col-resize hover:bg-primary/30 transition-colors relative",
          draggingGit && "bg-primary/40"
        )}
        onmousedown={startGitDrag}
      >
        <div class="absolute inset-y-0 -left-1.5 -right-1.5"></div>
      </div>
      <div class="min-h-0" style="width: {gitPanelWidth}%">
        <GitPanel taskId={task.id} onclose={() => (gitPanelOpen = false)} />
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
  @keyframes gate-pulse {
    0%, 100% { box-shadow: 0 0 0 0 oklch(0.75 0.15 85 / 0.4); }
    50% { box-shadow: 0 0 0 4px oklch(0.75 0.15 85 / 0); }
  }
  .animate-gate-pulse {
    animation: gate-pulse 2s ease-in-out infinite;
  }
</style>
