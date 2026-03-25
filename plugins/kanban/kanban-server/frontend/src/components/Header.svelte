<script lang="ts">
  let {
    currentView, pipelines, activePipeline, doneCount, totalCount,
    onswitchview, onswitchpipeline, onrefresh, onsettings,
  }: {
    currentView: "board" | "list";
    pipelines: string[];
    activePipeline: string;
    doneCount: number;
    totalCount: number;
    onswitchview: (v: "board" | "list") => void;
    onswitchpipeline: (p: string) => void;
    onrefresh: () => void;
    onsettings: () => void;
  } = $props();

  let theme = $state(getTheme());

  function getTheme(): "light" | "dark" {
    const saved = localStorage.getItem("kanban-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kanban-theme", theme);
  }

  $effect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  });
</script>

<header>
  <div class="header-left">
    <h1>Kanban Board</h1>
    <div class="pipeline-filter">
      {#if pipelines.length <= 1}
        <span class="pipeline-label">{activePipeline}</span>
      {:else}
        <select
          value={activePipeline}
          onchange={(e) => onswitchpipeline((e.target as HTMLSelectElement).value)}
        >
          {#each pipelines as p}
            <option value={p}>{p}</option>
          {/each}
        </select>
      {/if}
    </div>
  </div>
  <div class="header-tabs">
    <button class="tab-btn" class:active={currentView === "board"} onclick={() => onswitchview("board")}>Board</button>
    <button class="tab-btn" class:active={currentView === "list"} onclick={() => onswitchview("list")}>List</button>
  </div>
  <div class="header-meta">
    <span>{doneCount}/{totalCount} completed</span>
    <button class="icon-btn" title="Toggle theme" onclick={toggleTheme}>
      {#if theme === "dark"}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.6 3.6l.7.7M11.7 11.7l.7.7M3.6 12.4l.7-.7M11.7 4.3l.7-.7"/></svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 9.2A5.5 5.5 0 0 1 6.8 2.5 5.5 5.5 0 1 0 13.5 9.2z"/></svg>
      {/if}
    </button>
    <button class="icon-btn" title="Pipeline Settings" onclick={onsettings}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="10" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>
    </button>
    <button class="icon-btn" title="Refresh" onclick={onrefresh}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.3-4M13.5 8a5.5 5.5 0 0 1-9.3 4"/><path d="M11.8 1.5V4h-2.5M4.2 14.5V12h2.5"/></svg>
    </button>
  </div>
</header>
