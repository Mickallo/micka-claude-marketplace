<script lang="ts">
  import { Kanban, BarChart3, SlidersHorizontal } from "lucide-svelte";
  import { cn } from "../lib/cn";

  let { activePage = "board", onnavigate, onsettings }: {
    activePage?: string;
    onnavigate: (page: string) => void;
    onsettings: () => void;
  } = $props();
</script>

<aside class="fixed inset-y-0 left-0 z-40 w-12 flex flex-col items-center py-3 bg-card border-r">
  <div class="flex flex-col items-center gap-1">
    <button
      class={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
        activePage === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
      title="Board"
      onclick={() => onnavigate("board")}
    >
      <Kanban class="w-4 h-4" />
    </button>
    <button
      class={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
        activePage === "dashboard" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
      title="Dashboard"
      onclick={() => onnavigate("dashboard")}
    >
      <BarChart3 class="w-4 h-4" />
    </button>
  </div>

  <div class="flex-1"></div>

  <div class="flex flex-col items-center gap-1">
    <button
      class="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      onclick={onsettings}
      title="Settings"
    >
      <SlidersHorizontal class="w-4 h-4" />
    </button>
  </div>
</aside>
