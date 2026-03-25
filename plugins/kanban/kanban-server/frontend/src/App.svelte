<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Header from "./components/Header.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import Board from "./components/Board.svelte";
  import ListView from "./components/ListView.svelte";
  import TaskModal from "./components/TaskModal.svelte";
  import AddCardModal from "./components/AddCardModal.svelte";
  import PipelineSettings from "./components/PipelineSettings.svelte";
  import Toast from "./components/Toast.svelte";
  import { fetchBoard, fetchPipelines } from "./lib/api";
  import { connectSSE, onSSE, disconnectSSE } from "./lib/sse";
  import type { BoardResponse, Task } from "./lib/types";

  let currentView: "board" | "list" = $state("board");
  let currentPipeline = $state(localStorage.getItem("kanban-pipeline") || "");
  let currentSort = $state(localStorage.getItem("kanban-sort") || "default");
  let hideOldDone = $state(localStorage.getItem("kanban-hide-old") === "true");
  let searchQuery = $state("");
  let maxLoops = $state(3);

  let boardData: BoardResponse | null = $state(null);
  let selectedTaskId: number | null = $state(null);
  let showAddCard = $state(false);
  let showPipelineSettings = $state(false);
  let toastMessage = $state("");

  let refreshTimer: ReturnType<typeof setInterval>;

  async function loadBoard() {
    try {
      boardData = await fetchBoard(currentPipeline || undefined);
      currentPipeline = boardData.pipeline;
    } catch {
      boardData = null;
    }
  }

  async function loadMaxLoops() {
    try {
      const p = await fetchPipelines();
      maxLoops = p.max_loops;
    } catch {}
  }

  function switchPipeline(p: string) {
    currentPipeline = p;
    localStorage.setItem("kanban-pipeline", p);
    loadBoard();
  }

  function switchView(v: "board" | "list") {
    currentView = v;
  }

  function showToast(msg: string) {
    toastMessage = msg;
    setTimeout(() => (toastMessage = ""), 3000);
  }

  onMount(() => {
    loadBoard();
    loadMaxLoops();
    connectSSE();
    const unsub = onSSE("*", () => loadBoard());
    refreshTimer = setInterval(loadBoard, 10000);
    return () => { unsub(); clearInterval(refreshTimer); disconnectSSE(); };
  });

  onDestroy(() => {
    clearInterval(refreshTimer);
    disconnectSSE();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      selectedTaskId = null;
      showAddCard = false;
      showPipelineSettings = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Header
  {currentView}
  pipelines={boardData?.pipelines ?? []}
  activePipeline={boardData?.pipeline ?? ""}
  doneCount={boardData ? (boardData.columns["done"]?.length ?? 0) : 0}
  totalCount={boardData ? Object.values(boardData.columns).reduce((s, c) => s + c.length, 0) : 0}
  onswitchview={switchView}
  onswitchpipeline={switchPipeline}
  onrefresh={loadBoard}
  onsettings={() => (showPipelineSettings = true)}
/>

<Toolbar
  bind:searchQuery
  bind:currentSort
  bind:hideOldDone
  onsortchange={() => { localStorage.setItem("kanban-sort", currentSort); loadBoard(); }}
  onhidedonechange={() => localStorage.setItem("kanban-hide-old", String(hideOldDone))}
/>

{#if currentView === "board"}
  <Board
    data={boardData}
    {searchQuery}
    {hideOldDone}
    {currentSort}
    {maxLoops}
    onselect={(id) => (selectedTaskId = id)}
    onadd={() => (showAddCard = true)}
    onreorder={loadBoard}
    ontoast={showToast}
  />
{:else}
  <ListView
    data={boardData}
    {searchQuery}
    {hideOldDone}
    {maxLoops}
    onselect={(id) => (selectedTaskId = id)}
    onrefresh={loadBoard}
    ontoast={showToast}
  />
{/if}

{#if selectedTaskId !== null}
  <TaskModal
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

{#if showPipelineSettings}
  <PipelineSettings
    activePipeline={currentPipeline}
    onclose={() => { showPipelineSettings = false; loadBoard(); }}
    onsave={(p) => switchPipeline(p)}
  />
{/if}

{#if toastMessage}
  <Toast message={toastMessage} />
{/if}
