<script lang="ts">
  import { onMount } from "svelte";
  import { X, GripVertical, Trash2, Plus, Pencil } from "lucide-svelte";
  import { cn } from "../lib/cn";
  import type { PipelinesFile, AgentInfo } from "../lib/types";
  import { fetchPipelines, savePipelines, fetchAgents } from "../lib/api";

  let { activePipeline, onclose, onsave }: {
    activePipeline: string;
    onclose: () => void;
    onsave: (pipeline: string) => void;
  } = $props();

  let pipelinesData: PipelinesFile | null = $state(null);
  let agents: AgentInfo[] = $state([]);
  let editingName = $state("");
  let selectedAgent: string | null = $state(null);
  let addSelect = $state("");

  let pipeline = $derived(pipelinesData?.pipelines[editingName] ?? { stages: [], gates: [] });

  function toggleGate(stage: string) {
    if (!pipelinesData) return;
    const p = pipelinesData.pipelines[editingName];
    const gates = p.gates ?? [];
    p.gates = gates.includes(stage) ? gates.filter(g => g !== stage) : [...gates, stage];
    pipelinesData = { ...pipelinesData };
  }
  let pipelineNames = $derived(pipelinesData ? Object.keys(pipelinesData.pipelines) : []);
  let unusedAgents = $derived(agents.filter(a => !pipeline.stages.includes(a.name)));
  let agentMap = $derived(new Map(agents.map(a => [a.name, a])));
  let detail = $derived(selectedAgent ? agentMap.get(selectedAgent) : null);

  onMount(async () => {
    pipelinesData = await fetchPipelines();
    agents = await fetchAgents();
    editingName = activePipeline || pipelinesData?.default || "";
  });

  function removeStage(idx: number) {
    if (!pipelinesData) return;
    const p = pipelinesData.pipelines[editingName];
    const [removed] = p.stages.splice(idx, 1);
    if (p.gates) p.gates = p.gates.filter(g => g !== removed);
    if (selectedAgent === removed) selectedAgent = null;
    pipelinesData = { ...pipelinesData };
  }
  function addStage() {
    if (!pipelinesData || !addSelect) return;
    pipelinesData.pipelines[editingName].stages.push(addSelect);
    selectedAgent = addSelect;
    addSelect = "";
    pipelinesData = { ...pipelinesData };
  }
  let dragIdx: number | null = $state(null);
  let renamingName: string | null = $state(null);
  let renameValue = $state("");

  function addPipeline() {
    if (!pipelinesData) return;
    let base = "new-pipeline";
    let name = base;
    let i = 1;
    while (pipelinesData.pipelines[name]) name = `${base}-${i++}`;
    pipelinesData.pipelines[name] = { stages: [] };
    pipelinesData = { ...pipelinesData };
    editingName = name;
    selectedAgent = null;
    startRename(name);
  }

  function deletePipeline(name: string) {
    if (!pipelinesData) return;
    if (pipelineNames.length <= 1) return;
    if (!confirm(`Delete pipeline "${name}"?`)) return;
    delete pipelinesData.pipelines[name];
    if (pipelinesData.default === name) pipelinesData.default = Object.keys(pipelinesData.pipelines)[0];
    if (editingName === name) editingName = Object.keys(pipelinesData.pipelines)[0];
    pipelinesData = { ...pipelinesData };
  }

  function startRename(name: string) {
    renamingName = name;
    renameValue = name;
  }

  function commitRename() {
    if (!pipelinesData || !renamingName) return;
    const oldName = renamingName;
    const newName = renameValue.trim();
    renamingName = null;
    if (!newName || newName === oldName) return;
    if (pipelinesData.pipelines[newName]) { alert(`Pipeline "${newName}" already exists`); return; }
    const entries = Object.entries(pipelinesData.pipelines);
    const renamed = Object.fromEntries(entries.map(([k, v]) => [k === oldName ? newName : k, v]));
    pipelinesData.pipelines = renamed;
    if (pipelinesData.default === oldName) pipelinesData.default = newName;
    if (editingName === oldName) editingName = newName;
    pipelinesData = { ...pipelinesData };
  }

  function handleStageDrop(e: DragEvent, dropIdx: number) {
    e.preventDefault();
    if (!pipelinesData || dragIdx === null || dragIdx === dropIdx) return;
    const [moved] = pipelinesData.pipelines[editingName].stages.splice(dragIdx, 1);
    pipelinesData.pipelines[editingName].stages.splice(dropIdx, 0, moved);
    dragIdx = null;
    pipelinesData = { ...pipelinesData };
  }

  async function handleSave() {
    if (!pipelinesData) return;
    await savePipelines(pipelinesData);
    onsave(editingName);
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[10vh]" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="bg-card border rounded-xl shadow-xl w-full max-w-4xl p-6 relative max-h-[80vh] overflow-y-auto">
    <button class="absolute top-4 right-4 w-8 h-8 rounded-md flex items-center justify-center hover:bg-secondary" onclick={onclose}>
      <X class="w-4 h-4" />
    </button>
    <h2 class="text-lg font-semibold mb-4">Pipeline Settings</h2>

    {#if pipelinesData}
      <!-- Tabs -->
      <div class="flex gap-1 bg-secondary rounded-lg p-1 w-fit mb-6 items-center">
        {#each pipelineNames as name}
          {#if renamingName === name}
            <input
              class="px-3 py-1.5 text-sm rounded-md bg-card border border-border w-40"
              bind:value={renameValue}
              autofocus
              onblur={commitRename}
              onkeydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renamingName = null; }}
            />
          {:else}
            <div class={cn("flex items-center gap-1 rounded-md transition-all group", name === editingName ? "bg-card shadow-sm" : "hover:bg-card/50")}>
              <button class={cn("pl-3 pr-1 py-1.5 text-sm", name === editingName ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                ondblclick={() => startRename(name)}
                onclick={() => { editingName = name; selectedAgent = null; }}>{name}</button>
              <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-primary" title="Rename" onclick={() => startRename(name)}>
                <Pencil class="w-3 h-3" />
              </button>
              {#if pipelineNames.length > 1}
                <button class="opacity-0 group-hover:opacity-100 pr-2 py-1 hover:text-destructive" title="Delete" onclick={() => deletePipeline(name)}>
                  <Trash2 class="w-3 h-3" />
                </button>
              {/if}
            </div>
          {/if}
        {/each}
        <button class="px-2 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-card/50" title="Add pipeline" onclick={addPipeline}>
          <Plus class="w-4 h-4" />
        </button>
      </div>

      <div class="flex gap-6">
        <!-- Left: stages -->
        <div class="w-64 shrink-0 flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <label class="text-sm text-muted-foreground">Max loops</label>
            <input type="number" class="w-14 px-2 py-1 text-sm rounded-md bg-secondary border border-border text-center" min="1" max="10" bind:value={pipelinesData.max_loops} />
          </div>

          <div class="flex flex-col gap-1">
            {#each pipeline.stages as stage, i}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class={cn(
                  "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-all border border-transparent hover:bg-secondary",
                  selectedAgent === stage && "bg-primary/10 border-primary/30",
                  dragIdx === i && "opacity-40"
                )}
                draggable="true"
                onclick={() => (selectedAgent = stage)}
                ondragstart={(e) => { dragIdx = i; e.dataTransfer!.effectAllowed = "move"; }}
                ondragend={() => (dragIdx = null)}
                ondragover={(e) => e.preventDefault()}
                ondrop={(e) => { e.preventDefault(); handleStageDrop(e, i); }}
              >
                <GripVertical class="w-3.5 h-3.5 text-muted-foreground cursor-grab" />
                <label class="flex items-center gap-1" title="Gate" onclick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    class="w-3.5 h-3.5 accent-primary cursor-pointer"
                    checked={(pipeline.gates ?? []).includes(stage)}
                    onchange={() => toggleGate(stage)}
                  />
                </label>
                <span class="text-sm font-medium flex-1">{stage}</span>
                {#if (pipeline.gates ?? []).includes(stage)}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">gate</span>
                {/if}
                {#if agentMap.get(stage)?.model}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{agentMap.get(stage)?.model}</span>
                {/if}
                <button class="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity" title="Remove" onclick={(e) => { e.stopPropagation(); removeStage(i); }}>
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            {/each}
          </div>

          {#if unusedAgents.length > 0}
            <div class="flex gap-2">
              <select class="flex-1 px-2 py-1.5 text-sm rounded-md bg-secondary border border-border" bind:value={addSelect}>
                <option value="">Add agent...</option>
                {#each unusedAgents as a}<option value={a.name}>{a.name}</option>{/each}
              </select>
              <button class="px-3 py-1.5 text-sm rounded-md border border-border text-primary hover:bg-secondary" onclick={addStage}>Add</button>
            </div>
          {/if}
        </div>

        <!-- Right: agent detail -->
        <div class="flex-1 min-w-0">
          {#if detail}
            <div class="bg-secondary/30 rounded-lg p-5">
              <h3 class="text-base font-semibold">{detail.name}</h3>
              <div class="flex gap-2 mt-2">
                {#if detail.model}<span class="text-[11px] px-2 py-0.5 rounded-full bg-agent-writer/20 text-agent-writer">{detail.model}</span>{/if}
                <span class="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{detail.source}</span>
              </div>
              {#if detail.description}<p class="text-sm text-muted-foreground mt-3 leading-relaxed">{detail.description}</p>{/if}
              {#if detail.tools?.length}
                <div class="mt-4">
                  <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tools</span>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    {#each detail.tools as tool}<span class="text-xs font-mono px-2 py-1 rounded bg-secondary">{tool}</span>{/each}
                  </div>
                </div>
              {/if}
              {#if detail.prompt}
                <div class="mt-4">
                  <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prompt</span>
                  <pre class="mt-2 text-xs font-mono bg-card border rounded-md p-3 max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-muted-foreground">{detail.prompt}</pre>
                </div>
              {/if}
            </div>
          {:else}
            <div class="flex items-center justify-center h-full text-muted-foreground text-sm">Select a stage to view details</div>
          {/if}
        </div>
      </div>

      <div class="flex justify-end gap-2 mt-6 pt-4 border-t">
        <button class="px-5 py-2 text-sm rounded-md border border-border hover:bg-secondary" onclick={onclose}>Cancel</button>
        <button class="px-5 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90" onclick={handleSave}>Save</button>
      </div>
    {/if}
  </div>
</div>
