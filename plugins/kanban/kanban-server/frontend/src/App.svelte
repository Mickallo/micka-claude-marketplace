<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Header from "./components/Header.svelte";
  import PipelineBar from "./components/PipelineBar.svelte";
  import Board from "./components/Board.svelte";
  import TicketSheet from "./components/TicketSheet.svelte";
  import AddCardModal from "./components/AddCardModal.svelte";
  import PipelineSettings from "./components/PipelineSettings.svelte";
  import { fetchBoard, fetchPipelines, fetchAgents } from "./lib/api";
  import { connectSSE, onSSE, disconnectSSE } from "./lib/sse";
  import type { BoardResponse, AgentInfo } from "./lib/types";

  let currentPipeline = $state(localStorage.getItem("kanban-pipeline") || "");
  let maxLoops = $state(3);
  let boardData: BoardResponse | null = $state(null);
  let selectedTaskId: number | null = $state(null);
  let showAddCard = $state(false);
  let showSettings = $state(false);
  let agentMap = $state(new Map<string, AgentInfo>());
  let refreshTimer: ReturnType<typeof setInterval>;

  async function loadBoard() {
    try {
      boardData = await fetchBoard(currentPipeline || undefined);
      currentPipeline = boardData.pipeline;
    } catch { boardData = null; }
  }

  async function loadMaxLoops() {
    try { const p = await fetchPipelines(); maxLoops = p.max_loops; } catch {}
  }

  function switchPipeline(p: string) {
    currentPipeline = p;
    localStorage.setItem("kanban-pipeline", p);
    loadBoard();
  }

  function stats() {
    if (!boardData) return { total: 0, processing: 0, needsInput: 0, completed: 0 };
    let total = 0, processing = 0, needsInput = 0, completed = 0;
    for (const [col, tasks] of Object.entries(boardData.columns)) {
      for (const t of tasks) {
        total++;
        if (col === "done") completed++;
        else if (t.status.startsWith("awaiting:")) needsInput++;
        else if (col !== "todo") processing++;
      }
    }
    return { total, processing, needsInput, completed };
  }

  async function loadAgents() {
    try {
      const agents = await fetchAgents();
      agentMap = new Map(agents.map(a => [a.name, a]));
    } catch {}
  }

  onMount(() => {
    loadBoard();
    loadMaxLoops();
    loadAgents();
    connectSSE();
    const unsub = onSSE("*", () => loadBoard());
    refreshTimer = setInterval(loadBoard, 10000);
    return () => { unsub(); clearInterval(refreshTimer); disconnectSSE(); };
  });

  onDestroy(() => { clearInterval(refreshTimer); disconnectSSE(); });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") { selectedTaskId = null; showAddCard = false; showSettings = false; }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="min-h-screen bg-background">
  <Header
    pipelines={boardData?.pipelines ?? []}
    activePipeline={boardData?.pipeline ?? ""}
    totalTickets={stats().total}
    processingCount={stats().processing}
    onswitchpipeline={switchPipeline}
    onadd={() => (showAddCard = true)}
    onsettings={() => (showSettings = true)}
  />

  <PipelineBar
    columnOrder={boardData?.column_order ?? []}
    stats={stats()}
  />

  <main class="py-6">
    <Board
      data={boardData}
      {maxLoops}
      {agentMap}
      onselect={(id) => (selectedTaskId = id)}
      onadd={() => (showAddCard = true)}
      onreorder={loadBoard}
    />
  </main>

  {#if selectedTaskId !== null}
    <TicketSheet
      taskId={selectedTaskId}
      columnOrder={boardData?.column_order ?? []}
      {maxLoops}
      onclose={() => { selectedTaskId = null; loadBoard(); }}
    />
  {/if}

  {#if showAddCard}
    <AddCardModal
      pipeline={currentPipeline}
      onclose={() => { showAddCard = false; loadBoard(); }}
    />
  {/if}

  {#if showSettings}
    <PipelineSettings
      activePipeline={currentPipeline}
      onclose={() => { showSettings = false; loadBoard(); }}
      onsave={switchPipeline}
    />
  {/if}
</div>
