<script lang="ts">
  import { onMount } from "svelte";
  import { X, GripVertical, Trash2 } from "lucide-svelte";
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

  let pipeline = $derived(pipelinesData?.pipelines[editingName] ?? { stages: [] });
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
    pipelinesData.pipelines[editingName].stages.splice(idx, 1);
    pipelinesData = { ...pipelinesData };
  }
  function addStage() {
    if (!pipelinesData || !addSelect) return;
    pipelinesData.pipelines[editingName].stages.push(addSelect);
    selectedAgent = addSelect;
    addSelect = "";
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
      <div class="flex gap-1 bg-secondary rounded-lg p-1 w-fit mb-6">
        {#each pipelineNames as name}
          <button class={cn("px-4 py-1.5 text-sm rounded-md transition-all", name === editingName ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onclick={() => { editingName = name; selectedAgent = null; }}>{name}</button>
        {/each}
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
              <div class={cn("flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-all border border-transparent hover:bg-secondary", selectedAgent === stage && "bg-primary/10 border-primary/30")}
                onclick={() => (selectedAgent = stage)}>
                <GripVertical class="w-3.5 h-3.5 text-muted-foreground cursor-grab" />
                <span class="text-sm font-medium flex-1">{stage}</span>
                {#if agentMap.get(stage)?.model}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{agentMap.get(stage)?.model}</span>
                {/if}
                <button class="opacity-0 group-hover:opacity-100 hover:text-destructive" onclick={(e) => { e.stopPropagation(); removeStage(i); }}>
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
