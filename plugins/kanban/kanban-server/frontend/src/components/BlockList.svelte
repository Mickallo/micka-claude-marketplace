<script lang="ts">
  import type { Block } from "../lib/types";
  import { md } from "../lib/markdown";

  let { blocks, selectedBlockIdx = $bindable(null) }: {
    blocks: Block[];
    selectedBlockIdx: number | null;
  } = $props();
</script>

{#each blocks as block, idx}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="lifecycle-phase phase-block"
    class:block-ok={block.verdict === "ok"}
    class:block-nok={block.verdict !== "ok"}
    class:block-selected={selectedBlockIdx === idx}
    onclick={() => (selectedBlockIdx = selectedBlockIdx === idx ? null : idx)}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === "Enter" && (selectedBlockIdx = selectedBlockIdx === idx ? null : idx)}
  >
    <div class="phase-header">
      <span class="phase-icon">{block.verdict === "ok" ? "\u2705" : "\u274C"}</span>
      <span class="phase-label">{block.agent}</span>
      <span class="block-meta">{block.verdict.toUpperCase()} &middot; {block.timestamp?.slice(0, 16) ?? ""}</span>
      <span class="block-index">#{idx + 1}</span>
    </div>
    {#if selectedBlockIdx !== idx}
      <div class="phase-body phase-body-preview">
        {block.content.split("\n")[0]?.slice(0, 100) ?? ""}
      </div>
    {/if}
  </div>
{/each}
