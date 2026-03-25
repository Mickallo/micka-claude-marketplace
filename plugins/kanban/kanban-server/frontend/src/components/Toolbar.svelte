<script lang="ts">
  let {
    searchQuery = $bindable(""),
    currentSort = $bindable("default"),
    hideOldDone = $bindable(false),
    onsortchange,
    onhidedonechange,
  }: {
    searchQuery: string;
    currentSort: string;
    hideOldDone: boolean;
    onsortchange: () => void;
    onhidedonechange: () => void;
  } = $props();
</script>

<div class="toolbar">
  <input
    type="search"
    placeholder="Search tasks..."
    autocomplete="off"
    bind:value={searchQuery}
  />
  <select
    bind:value={currentSort}
    onchange={onsortchange}
  >
    <option value="default">Sort: Default</option>
    <option value="created_desc">Created (Newest)</option>
    <option value="created_asc">Created (Oldest)</option>
    <option value="completed_desc">Completed</option>
  </select>
  <button
    class="toolbar-toggle-btn"
    class:active={hideOldDone}
    title="Hide Done items completed more than 3 days ago"
    onclick={() => { hideOldDone = !hideOldDone; onhidedonechange(); }}
  >
    Hide old done (3d+)
  </button>
</div>
