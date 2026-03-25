<script lang="ts">
  import { fly } from "svelte/transition";
  import { createTask, addAttachment } from "../lib/api";

  let { pipeline, onclose }: {
    pipeline: string;
    onclose: () => void;
  } = $props();

  let title = $state("");
  let priority = $state("medium");
  let description = $state("");
  let tagsRaw = $state("");
  let submitting = $state(false);
  let pendingFiles: File[] = $state([]);

  async function handleSubmit() {
    if (!title.trim()) return;
    submitting = true;
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const res = await createTask({ title, priority, description: description || undefined, tags, pipeline: pipeline || undefined });
    if (pendingFiles.length > 0 && res.id) {
      for (const file of pendingFiles) {
        if (!file.type.startsWith("image/")) continue;
        const data: string = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(file); });
        await addAttachment(res.id, file.name, data);
      }
    }
    submitting = false;
    onclose();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files) for (const f of Array.from(files)) if (f.type.startsWith("image/")) pendingFiles = [...pendingFiles, f];
  }

  function removeFile(idx: number) {
    pendingFiles = pendingFiles.filter((_, i) => i !== idx);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && onclose()} transition:fly={{ duration: 150 }}>
  <div class="modal modal-sm" transition:fly={{ y: 30, duration: 200 }}>
    <button class="modal-close" onclick={onclose}>&times;</button>
    <h1 class="modal-title-sm">New Card</h1>
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} autocomplete="off">
      <div class="form-group">
        <label for="add-title">Title *</label>
        <input id="add-title" type="text" required placeholder="Task title" bind:value={title} />
      </div>
      <div class="form-group form-row">
        <div class="form-col">
          <label for="add-priority">Priority</label>
          <select id="add-priority" bind:value={priority}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label for="add-description">Description</label>
        <textarea id="add-description" rows="4" placeholder="Requirements in markdown" bind:value={description}></textarea>
      </div>
      <div class="form-group">
        <label for="add-tags">Tags <span class="hint">(comma separated)</span></label>
        <input id="add-tags" type="text" placeholder="e.g. feature, api, ui" bind:value={tagsRaw} />
      </div>
      <div class="form-group">
        <label>Attachments</label>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="attachment-drop-zone"
          ondragover={(e) => e.preventDefault()}
          ondrop={handleDrop}
          onclick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.onchange = () => { if (inp.files) for (const f of Array.from(inp.files)) if (f.type.startsWith("image/")) pendingFiles = [...pendingFiles, f]; }; inp.click(); }}
        >
          <span>Drop images here or click to attach</span>
        </div>
        {#if pendingFiles.length > 0}
          <div class="attachments-grid">
            {#each pendingFiles as file, i}
              <div class="attachment-thumb">
                <img src={URL.createObjectURL(file)} alt={file.name} />
                <button type="button" class="attachment-remove" onclick={() => removeFile(i)}>&times;</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <button type="submit" class="form-submit" disabled={submitting}>
        {submitting ? "Adding..." : "Add Card"}
      </button>
    </form>
  </div>
</div>
