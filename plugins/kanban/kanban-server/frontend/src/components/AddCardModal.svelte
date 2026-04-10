<script lang="ts">
  import { X } from "lucide-svelte";
  import { createTask } from "../lib/api";

  let { pipeline, onclose }: { pipeline: string; onclose: () => void } = $props();

  let title = $state("");
  let priority = $state("medium");
  let description = $state("");
  let tagsRaw = $state("");
  let submitting = $state(false);

  async function handleSubmit() {
    if (!title.trim()) return;
    submitting = true;
    const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : undefined;
    await createTask({ title, priority, description: description || undefined, tags, pipeline: pipeline || undefined });
    submitting = false;
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[15vh]" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="bg-card border rounded-xl shadow-xl w-full max-w-md p-6 relative">
    <button class="absolute top-4 right-4 w-8 h-8 rounded-md flex items-center justify-center hover:bg-secondary" onclick={onclose}>
      <X class="w-4 h-4" />
    </button>
    <h2 class="text-lg font-semibold mb-4">New Ticket</h2>
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} autocomplete="off" class="flex flex-col gap-4">
      <div>
        <label for="t" class="text-sm font-medium text-muted-foreground block mb-1.5">Title *</label>
        <input id="t" type="text" required placeholder="Task title" bind:value={title}
          class="w-full px-3 py-2 text-sm rounded-md bg-secondary border border-border focus:border-primary focus:outline-none" />
      </div>
      <div>
        <label for="p" class="text-sm font-medium text-muted-foreground block mb-1.5">Priority</label>
        <select id="p" bind:value={priority} class="w-full px-3 py-2 text-sm rounded-md bg-secondary border border-border">
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div>
        <label for="d" class="text-sm font-medium text-muted-foreground block mb-1.5">Description</label>
        <textarea id="d" rows="4" placeholder="Requirements in markdown" bind:value={description}
          class="w-full px-3 py-2 text-sm rounded-md bg-secondary border border-border font-mono focus:border-primary focus:outline-none resize-y" />
      </div>
      <div>
        <label for="tg" class="text-sm font-medium text-muted-foreground block mb-1.5">Tags <span class="text-muted-foreground/50 font-normal">(comma separated)</span></label>
        <input id="tg" type="text" placeholder="e.g. feature, api, ui" bind:value={tagsRaw}
          class="w-full px-3 py-2 text-sm rounded-md bg-secondary border border-border focus:border-primary focus:outline-none" />
      </div>
      <button type="submit" disabled={submitting}
        class="w-full py-2.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {submitting ? "Adding..." : "Add Ticket"}
      </button>
    </form>
  </div>
</div>
