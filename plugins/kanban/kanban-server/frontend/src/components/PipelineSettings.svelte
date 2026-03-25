<script lang="ts">
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import type { PipelinesFile, AgentInfo } from "../lib/types";
  import { fetchPipelines, savePipelines, fetchAgents } from "../lib/api";

  let { activePipeline, onclose, onsave }: {
    activePipeline: string;
    onclose: () => void;
    onsave: (pipeline: string) => void;
  } = $props();

  let pipelinesData: PipelinesFile | null = $state(null);
  let agents: AgentInfo[] = $state([]);
  let editingName = $state(activePipeline);
  let selectedAgent: string | null = $state(null);

  let pipeline = $derived(pipelinesData?.pipelines[editingName] ?? { stages: [] });
  let pipelineNames = $derived(pipelinesData ? Object.keys(pipelinesData.pipelines) : []);
  let unusedAgents = $derived(agents.filter((a) => !pipeline.stages.includes(a.name)));
  let agentMap = $derived(new Map(agents.map((a) => [a.name, a])));
  let selectedAgentInfo = $derived(selectedAgent ? agentMap.get(selectedAgent) ?? null : null);

  let addSelect = $state("");

  onMount(async () => {
    pipelinesData = await fetchPipelines();
    agents = await fetchAgents();
    editingName = activePipeline || pipelinesData?.default || "";
  });

  function removeStage(idx: number) {
    if (!pipelinesData) return;
    if (pipeline.stages[idx] === selectedAgent) selectedAgent = null;
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

  function addPipeline() {
    const name = prompt("Pipeline name:");
    if (!name || !pipelinesData || pipelinesData.pipelines[name]) return;
    pipelinesData.pipelines[name] = { stages: [] };
    editingName = name;
    selectedAgent = null;
    pipelinesData = { ...pipelinesData };
  }

  function deletePipeline() {
    if (!pipelinesData || pipelineNames.length <= 1) return;
    delete pipelinesData.pipelines[editingName];
    if (pipelinesData.default === editingName) pipelinesData.default = Object.keys(pipelinesData.pipelines)[0];
    editingName = pipelinesData.default;
    selectedAgent = null;
    pipelinesData = { ...pipelinesData };
  }

  async function handleSave() {
    if (!pipelinesData) return;
    await savePipelines(pipelinesData);
    onsave(editingName);
    onclose();
  }

  // Drag reorder stages
  let dragIdx: number | null = $state(null);

  function handleStageDragStart(e: DragEvent, idx: number) {
    dragIdx = idx;
    e.dataTransfer!.effectAllowed = "move";
  }

  function handleStageDrop(e: DragEvent, dropIdx: number) {
    e.preventDefault();
    if (!pipelinesData || dragIdx === null || dragIdx === dropIdx) return;
    const [moved] = pipelinesData.pipelines[editingName].stages.splice(dragIdx, 1);
    pipelinesData.pipelines[editingName].stages.splice(dropIdx, 0, moved);
    dragIdx = null;
    pipelinesData = { ...pipelinesData };
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && onclose()} transition:fly={{ duration: 150 }}>
  <div class="modal pipeline-modal" transition:fly={{ y: 30, duration: 200 }}>
    <button class="modal-close" onclick={onclose}>&times;</button>
    <h1 class="modal-title-sm">Pipeline Settings</h1>

    {#if pipelinesData}
      <div class="pipeline-settings">
        <div class="pipeline-tabs">
          {#each pipelineNames as name}
            <button class="pipeline-tab" class:active={name === editingName} onclick={() => { editingName = name; selectedAgent = null; }}>
              {name}
            </button>
          {/each}
          <button class="pipeline-tab pipeline-add-tab" onclick={addPipeline}>+</button>
        </div>

        <div class="pipeline-settings-body">
          <div class="pipeline-settings-left">
            <div class="pipeline-config-row">
              <label class="pipeline-config-label">Max loops</label>
              <input type="number" class="pipeline-config-input" min="1" max="10" bind:value={pipelinesData.max_loops} />
            </div>

            <div class="pipeline-section">
              <label class="pipeline-section-title">Stages</label>
              <div class="pipeline-stages-list">
                {#each pipeline.stages as stage, i}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="pipeline-stage"
                    class:selected={stage === selectedAgent}
                    draggable="true"
                    ondragstart={(e) => handleStageDragStart(e, i)}
                    ondragover={(e) => e.preventDefault()}
                    ondrop={(e) => handleStageDrop(e, i)}
                    onclick={() => (selectedAgent = stage)}
                  >
                    <span class="pipeline-drag-handle">{'\u2630'}</span>
                    <span class="pipeline-stage-name">{stage}</span>
                    {#if agentMap.get(stage)?.model}
                      <span class="pipeline-stage-model">{agentMap.get(stage)?.model}</span>
                    {/if}
                    <button class="pipeline-remove-btn" onclick={(e) => { e.stopPropagation(); removeStage(i); }}>&times;</button>
                  </div>
                {/each}
              </div>
            </div>

            {#if unusedAgents.length > 0}
              <div class="pipeline-add-row">
                <select class="pipeline-add-select" bind:value={addSelect}>
                  <option value="">Add agent...</option>
                  {#each unusedAgents as a}
                    <option value={a.name}>{a.name} ({a.source})</option>
                  {/each}
                </select>
                <button type="button" class="pipeline-add-btn" onclick={addStage}>Add</button>
              </div>
            {/if}

            <div class="pipeline-footer-row">
              <label class="pipeline-default-label">
                <input type="radio" checked={editingName === pipelinesData.default} onchange={() => (pipelinesData!.default = editingName)} />
                Default pipeline
              </label>
              <button type="button" class="pipeline-delete-btn" disabled={pipelineNames.length <= 1} onclick={deletePipeline}>
                Delete "{editingName}"
              </button>
            </div>
          </div>

          <div class="pipeline-settings-right">
            {#if selectedAgentInfo}
              <div class="agent-detail">
                <div class="agent-detail-header">
                  <span class="agent-detail-name">{selectedAgentInfo.name}</span>
                  <div class="agent-detail-badges">
                    {#if selectedAgentInfo.model}<span class="agent-badge agent-badge--model">{selectedAgentInfo.model}</span>{/if}
                    <span class="agent-badge agent-badge--source">{selectedAgentInfo.source}</span>
                  </div>
                </div>
                {#if selectedAgentInfo.description}
                  <p class="agent-detail-desc">{selectedAgentInfo.description}</p>
                {/if}
                {#if selectedAgentInfo.tools?.length}
                  <div class="agent-detail-section">
                    <span class="agent-detail-section-title">Tools</span>
                    <div class="agent-detail-tool-list">
                      {#each selectedAgentInfo.tools as tool}
                        <span class="agent-detail-tool">{tool}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if selectedAgentInfo.prompt}
                  <div class="agent-detail-section">
                    <span class="agent-detail-section-title">Prompt</span>
                    <pre class="agent-detail-prompt">{escapeHtml(selectedAgentInfo.prompt)}</pre>
                  </div>
                {/if}
              </div>
            {:else}
              <div class="agent-detail-empty">Select a stage to view details</div>
            {/if}
          </div>
        </div>

        <div class="pipeline-actions">
          <button type="button" class="pipeline-btn-secondary" onclick={onclose}>Cancel</button>
          <button type="button" class="pipeline-btn-primary" onclick={handleSave}>Save</button>
        </div>
      </div>
    {/if}
  </div>
</div>
