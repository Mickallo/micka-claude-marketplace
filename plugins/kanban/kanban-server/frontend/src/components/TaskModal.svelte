<script lang="ts">
  import { onMount } from "svelte";
  import type { Task, Block, Note, Attachment } from "../lib/types";
  import { fetchTask, patchTask, deleteTask, gateAction, addNote, deleteNote, addAttachment, deleteAttachment } from "../lib/api";
  import { md } from "../lib/markdown";
  import { parseJsonArray } from "../lib/utils";
  import Terminal from "./Terminal.svelte";

  let { taskId, columnOrder, maxLoops, onclose }: {
    taskId: number;
    columnOrder: string[];
    maxLoops: number;
    onclose: () => void;
  } = $props();

  let task: Task | null = $state(null);
  let editingDesc = $state(false);
  let descText = $state("");
  let noteText = $state("");
  let refuseComment = $state("");
  let selectedIdx: number | null = $state(null);
  let showTerminal = $state(false);

  let blocks = $derived(task ? parseJsonArray<Block>(task.blocks) : []);
  let notes = $derived(task ? parseJsonArray<Note>(task.notes) : []);
  let attachments = $derived(task ? parseJsonArray<Attachment>(task.attachments) : []);
  let isBlocked = $derived(task ? task.loop_count >= maxLoops : false);
  let awaitingStage = $derived(task?.status.startsWith("awaiting:") ? task.status.slice("awaiting:".length) : null);
  let currentIdx = $derived.by(() => {
    if (!task) return 0;
    if (awaitingStage) return Math.max(0, columnOrder.indexOf(awaitingStage));
    return Math.max(0, columnOrder.indexOf(task.status));
  });

  type TimelineItem = {
    kind: "requirement" | "block" | "note";
    timestamp: string;
    agent?: string;
    agent_id?: string | null;
    content?: string;
    decision_log?: string;
    verdict?: string;
    noteId?: number;
    author?: string;
    text?: string;
  };

  let timeline: TimelineItem[] = $derived.by(() => {
    if (!task) return [];
    const items: TimelineItem[] = [];

    // Requirements as first item
    items.push({
      kind: "requirement",
      timestamp: task.created_at || "",
      content: task.description || "",
    });

    // Blocks
    for (const b of blocks) {
      items.push({
        kind: "block",
        timestamp: b.timestamp || "",
        agent: b.agent,
        agent_id: b.agent_id,
        content: b.content,
        decision_log: b.decision_log,
        verdict: b.verdict,
      });
    }

    // Notes
    for (const n of notes) {
      items.push({
        kind: "note",
        timestamp: n.timestamp || "",
        noteId: n.id,
        author: n.author || "user",
        text: n.text,
      });
    }

    // Sort by timestamp (requirements first since created_at is earliest)
    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return items;
  });

  let selectedItem = $derived(selectedIdx !== null ? timeline[selectedIdx] ?? null : null);
  let selectedSessionId = $derived(selectedItem?.agent_id ?? null);


  async function load() {
    try {
      const result = await fetchTask(taskId);
      task = result;
      descText = task?.description || "";
    } catch (err) {
      console.error("Failed to load task:", err);
    }
  }

  onMount(() => { load(); });

  async function saveDesc() {
    if (!task) return;
    await patchTask(task.id, { description: descText });
    editingDesc = false;
    load();
  }
  async function handleDelete() {
    if (!task || !confirm(`Delete card #${task.id}?`)) return;
    await deleteTask(task.id);
    onclose();
  }
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
  async function handleDeleteNote(noteId: number) { if (!task) return; await deleteNote(task.id, noteId); load(); }
  async function handleFiles(files: FileList | File[]) {
    if (!task) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const data: string = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(file); });
      await addAttachment(task.id, file.name, data);
    }
    load();
  }
  async function handleDeleteAttachment(storedName: string) { if (!task) return; await deleteAttachment(task.id, storedName); load(); }

  function itemLabel(item: TimelineItem): string {
    if (item.kind === "requirement") return "Requirements";
    if (item.kind === "note") return item.author || "user";
    return item.agent || "Agent";
  }
  function itemIcon(item: TimelineItem): string {
    if (item.kind === "requirement") return "\u{1F4CB}";
    if (item.kind === "note") return "\u{1F4AC}";
    if (item.verdict === "ok") return "\u2705";
    if (item.verdict === "nok") return "\u274C";
    return "\u{1F504}";
  }
  function itemPreview(item: TimelineItem): string {
    const raw = item.content || item.text || "";
    const line = raw.split("\n").find(l => l.trim() && !l.startsWith("#")) || raw.split("\n")[0] || "";
    return line.replace(/[#*`]/g, "").trim().slice(0, 80);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal">
    <button class="modal-close" onclick={onclose}>&times;</button>

    {#if !task}
      <div class="loading">Loading...</div>
    {:else}
      <h1>#{task.id} {task.title}</h1>

      <div class="modal-meta">
        <strong>Pipeline:</strong> {task.pipeline} |
        <strong>Status:</strong> {task.status} |
        <strong>Priority:</strong> {task.priority} |
        <strong>Created:</strong> {task.created_at?.slice(0, 10) ?? "-"}
        {#if task.started_at} | <strong>Started:</strong> {task.started_at.slice(0, 10)}{/if}
        {#if task.completed_at} | <strong>Completed:</strong> {task.completed_at.slice(0, 10)}{/if}
      </div>

      <!-- Progress bar -->
      <div class="lifecycle-progress">
        {#each columnOrder as col, i}
          {#if i > 0}<div class="progress-line"></div>{/if}
          <div class="progress-step" class:completed={i < currentIdx} class:current={i === currentIdx}>
            <div class="step-dot"></div>
            <span class="step-label">{col === "todo" ? "Todo" : col === "done" ? "Done" : col}</span>
          </div>
        {/each}
      </div>

      {#if isBlocked}
        <div class="blocked-banner">
          <strong>BLOCKED</strong> — {task.loop_count} failed loops (max: {maxLoops}). Add a comment to unblock.
        </div>
      {/if}

      {#if awaitingStage}
        <div class="awaiting-banner">
          <div class="awaiting-text"><strong>AWAITING VALIDATION</strong> — Stage <strong>{awaitingStage}</strong> completed.</div>
          <div class="awaiting-actions">
            <button class="gate-btn gate-approve" onclick={handleApprove}>Approve</button>
            <div class="gate-refuse-group">
              <textarea rows="2" placeholder="Reason for refusal (required)..." bind:value={refuseComment}></textarea>
              <button class="gate-btn gate-refuse" onclick={handleRefuse}>Refuse</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Two column layout: timeline | detail -->
      <div class="modal-body-columns">
        <!-- Left: unified timeline -->
        <div class="modal-body-left">
          {#each timeline as item, idx}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="timeline-item"
              class:timeline-requirement={item.kind === "requirement"}
              class:timeline-block={item.kind === "block"}
              class:timeline-note={item.kind === "note"}
              class:timeline-ok={item.verdict === "ok"}
              class:timeline-nok={item.verdict === "nok" || item.verdict === "relay"}
              class:timeline-selected={selectedIdx === idx}
              onclick={() => (selectedIdx = selectedIdx === idx ? null : idx)}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === "Enter" && (selectedIdx = selectedIdx === idx ? null : idx)}
            >
              <div class="timeline-item-header">
                <span class="timeline-icon">{itemIcon(item)}</span>
                <span class="timeline-label">{itemLabel(item)}</span>
                {#if item.kind === "block" && item.verdict}
                  <span class="badge" class:verdict-ok={item.verdict === "ok"} class:verdict-nok={item.verdict !== "ok"}>{item.verdict}</span>
                {/if}
                <span class="timeline-time">{item.timestamp?.slice(11, 16) ?? ""}</span>
              </div>
              <div class="timeline-preview">{itemPreview(item)}</div>
            </div>
          {/each}

          <!-- Add note input at the bottom of timeline -->
          <form class="timeline-note-form" onsubmit={(e) => { e.preventDefault(); handleAddNote(); }}>
            <input type="text" placeholder={isBlocked ? "Comment to unblock..." : "Add a note..."} bind:value={noteText} />
            <button type="submit">{isBlocked ? "Unblock" : "Add"}</button>
          </form>
        </div>

        <!-- Right: detail panel -->
        <div class="modal-body-right">
          {#if selectedItem}
            <div class="block-detail-panel">
              <div class="block-detail-header">
                <div class="block-detail-title">
                  <span class="timeline-icon">{itemIcon(selectedItem)}</span>
                  <span class="block-detail-agent">{itemLabel(selectedItem)}</span>
                  {#if selectedItem.kind === "block" && selectedItem.verdict}
                    <span class="badge" class:verdict-ok={selectedItem.verdict === "ok"} class:verdict-nok={selectedItem.verdict !== "ok"}>{selectedItem.verdict}</span>
                  {/if}
                  <span class="block-detail-time">{selectedItem.timestamp?.slice(0, 16) ?? ""}</span>
                </div>
                <div class="block-detail-actions">
                  {#if selectedItem.kind === "requirement"}
                    <button class="block-terminal-btn" onclick={() => { editingDesc = !editingDesc; descText = task?.description || ""; }}>
                      {editingDesc ? "Cancel" : "Edit"}
                    </button>
                  {/if}
                  {#if selectedSessionId}
                    <button class="block-terminal-btn" class:active={showTerminal} onclick={() => (showTerminal = !showTerminal)}>
                      {showTerminal ? "Content" : "Terminal"}
                    </button>
                  {/if}
                  {#if selectedItem.kind === "note" && selectedItem.noteId}
                    <button class="block-terminal-btn" onclick={() => handleDeleteNote(selectedItem!.noteId!)}>Delete</button>
                  {/if}
                </div>
              </div>

              {#if showTerminal && selectedSessionId}
                <Terminal sessionId={selectedSessionId} />
              {:else if selectedItem.kind === "requirement" && editingDesc}
                <div class="block-detail-body">
                  <textarea rows="12" bind:value={descText} class="detail-edit-textarea"></textarea>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="attachment-drop-zone"
                    ondragover={(e) => e.preventDefault()}
                    ondrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files; if (f) handleFiles(f); }}
                    onclick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.onchange = () => { if (inp.files) handleFiles(inp.files); }; inp.click(); }}
                  >
                    <span>Drop images here or click</span>
                  </div>
                  <div class="phase-edit-actions">
                    <button class="phase-save-btn" onclick={saveDesc}>Save</button>
                    <button class="phase-cancel-btn" onclick={() => (editingDesc = false)}>Cancel</button>
                  </div>
                </div>
              {:else}
                <div class="block-detail-body">
                  <div class="block-detail-content">
                    {@html md(selectedItem.content || selectedItem.text || "")}
                  </div>
                  {#if selectedItem.kind === "requirement" && attachments.length > 0}
                    <div class="attachments-grid">
                      {#each attachments as a}
                        <div class="attachment-thumb">
                          <img src={a.url} alt={a.filename} loading="lazy" />
                          <button class="attachment-remove" onclick={() => handleDeleteAttachment(a.storedName)}>&times;</button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if selectedItem.decision_log}
                    <details class="block-decision-log" open>
                      <summary>Decision Log</summary>
                      <div class="block-detail-content">{@html md(selectedItem.decision_log)}</div>
                    </details>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="block-detail-panel block-detail-empty">
              <p>Select an item to view details</p>
            </div>
          {/if}
        </div>
      </div>

      <div class="modal-danger-zone">
        <button class="delete-task-btn" onclick={handleDelete}>Delete Card</button>
      </div>
    {/if}
  </div>
</div>
